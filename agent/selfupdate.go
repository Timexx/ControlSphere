package main

// In-process self-update.
//
// The server sends an HMAC-protected update_agent message that contains only
// the target version, the SHA-256 and the size of the binary. The download
// URL is derived from the agent's own configured server URL, so a message can
// never point the agent at a foreign host.
//
// Flow:  verify HMAC → download <exe>.new → check size + SHA-256 →
//        run "<exe>.new -version" (must print the target version) →
//        write marker → rename exe→exe.bak, exe.new→exe → exit(restartExitCode)
//        → the service manager (systemd Restart=always / SCM recovery) starts
//        the new binary.
//
// The new binary confirms itself after the server answered "registered"
// (marker and .bak are removed). If it does not register within
// registerWatchdog it exits; after maxStartAttempts unconfirmed starts the
// .bak is restored and the old version is started again (rollback).
//
// Any failure before the swap leaves the running agent untouched.

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync/atomic"
	"time"
)

// Version is set at build time: -ldflags "-X main.Version=<version>".
var Version = "dev"

// selfTestSkipRegister is a build-time switch ONLY for rollback tests
// (-ldflags "-X main.selfTestSkipRegister=1"). A binary built with it never
// sends "register", so the update watchdog must roll it back.
var selfTestSkipRegister = ""

const (
	restartExitCode   = 3
	maxStartAttempts  = 3
	registerWatchdog  = 60 * time.Second
	versionCheckLimit = 10 * time.Second
	downloadTimeout   = 5 * time.Minute
	maxBinarySize     = 200 << 20 // 200 MiB
)

var (
	versionPattern = regexp.MustCompile(`^[A-Za-z0-9._+-]{1,64}$`)
	sha256Pattern  = regexp.MustCompile(`^[a-f0-9]{64}$`)
)

// UpdateAgentPayload is the HMAC-protected payload of an update_agent message.
type UpdateAgentPayload struct {
	CommandID string `json:"commandId"`
	Version   string `json:"version"`
	SHA256    string `json:"sha256"`
	Size      int64  `json:"size"`
}

func (p UpdateAgentPayload) validate() error {
	if !versionPattern.MatchString(p.Version) {
		return fmt.Errorf("invalid target version %q", p.Version)
	}
	if !sha256Pattern.MatchString(p.SHA256) {
		return errors.New("invalid sha256")
	}
	if p.Size <= 0 || p.Size > maxBinarySize {
		return fmt.Errorf("invalid size %d", p.Size)
	}
	return nil
}

// updateMarker is persisted between the old and the new binary.
type updateMarker struct {
	CommandID   string    `json:"commandId"`
	FromVersion string    `json:"fromVersion"`
	ToVersion   string    `json:"toVersion"`
	Attempts    int       `json:"attempts"`
	State       string    `json:"state"` // "pending" | "rolled_back"
	Error       string    `json:"error,omitempty"`
	StartedAt   time.Time `json:"startedAt"`
}

// updatePaths bundles every file the updater touches (overridable in tests).
type updatePaths struct {
	exe    string
	newExe string
	bak    string
	marker string
}

func defaultUpdatePaths() (updatePaths, error) {
	exe, err := os.Executable()
	if err != nil {
		return updatePaths{}, err
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	return pathsFor(exe, markerDir()), nil
}

func pathsFor(exe, dir string) updatePaths {
	newExe := exe + ".new"
	if runtime.GOOS == "windows" {
		// CreateProcess needs an .exe suffix to run the candidate for -version.
		newExe = strings.TrimSuffix(exe, ".exe") + ".new.exe"
	}
	return updatePaths{
		exe:    exe,
		newExe: newExe,
		bak:    exe + ".bak",
		marker: filepath.Join(dir, "update-pending"),
	}
}

func markerDir() string {
	if runtime.GOOS == "windows" {
		pd := os.Getenv("ProgramData")
		if pd == "" {
			pd = `C:\ProgramData`
		}
		return filepath.Join(pd, "maintainer-agent")
	}
	return "/var/lib/maintainer-agent"
}

func readMarker(path string) (*updateMarker, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var m updateMarker
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, err
	}
	return &m, nil
}

func writeMarker(path string, m *updateMarker) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	data, err := json.Marshal(m)
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// ---------------------------------------------------------------------------
// Old binary: perform the update
// ---------------------------------------------------------------------------

var updateInProgress atomic.Bool

func (a *Agent) handleUpdateAgent(payload UpdateAgentPayload) {
	sendOutput := func(output string, completed bool, exitCode int) {
		msg := CommandResponseMessage{
			Type:      "command_response",
			MachineID: a.machineId,
			CommandID: payload.CommandID,
			Output:    output,
			ExitCode:  exitCode,
			Completed: completed,
		}
		if err := a.writeJSON(msg); err != nil {
			log.Printf("Failed to send update output: %v", err)
		}
	}
	fail := func(format string, args ...interface{}) {
		msg := fmt.Sprintf(format, args...)
		log.Printf("❌ Agent update aborted: %s", msg)
		sendOutput("Update abgebrochen: "+msg+"\n", true, 1)
	}

	if err := payload.validate(); err != nil {
		fail("%v", err)
		return
	}
	if payload.Version == Version {
		sendOutput(fmt.Sprintf("Agent läuft bereits mit Version %s.\n", Version), true, 0)
		return
	}
	if !updateInProgress.CompareAndSwap(false, true) {
		fail("es läuft bereits ein Update")
		return
	}
	// Reset only on failure; on success the process exits.
	succeeded := false
	defer func() {
		if !succeeded {
			updateInProgress.Store(false)
		}
	}()

	paths, err := defaultUpdatePaths()
	if err != nil {
		fail("Pfad der laufenden Binary unbekannt: %v", err)
		return
	}
	base := a.httpBaseURL()
	if base == "" {
		fail("Server-URL aus der Konfiguration ist ungültig")
		return
	}
	downloadURL := fmt.Sprintf("%s/api/agent-download?os=%s&arch=%s", base, runtime.GOOS, runtime.GOARCH)

	sendOutput(fmt.Sprintf("Update %s → %s (%s/%s)\nDownload: %s\n", Version, payload.Version, runtime.GOOS, runtime.GOARCH, downloadURL), false, 0)

	if err := downloadVerified(downloadURL, paths.newExe, payload.SHA256, payload.Size); err != nil {
		os.Remove(paths.newExe)
		fail("%v", err)
		return
	}
	sendOutput("Download geprüft (Größe + SHA-256 stimmen).\n", false, 0)

	if err := checkBinaryVersion(paths.newExe, payload.Version); err != nil {
		os.Remove(paths.newExe)
		fail("%v", err)
		return
	}
	sendOutput(fmt.Sprintf("Neue Binary meldet Version %s.\n", payload.Version), false, 0)

	marker := &updateMarker{
		CommandID:   payload.CommandID,
		FromVersion: Version,
		ToVersion:   payload.Version,
		State:       "pending",
		StartedAt:   time.Now().UTC(),
	}
	if err := writeMarker(paths.marker, marker); err != nil {
		os.Remove(paths.newExe)
		fail("Marker konnte nicht geschrieben werden: %v", err)
		return
	}

	if err := swapBinaries(paths); err != nil {
		os.Remove(paths.marker)
		os.Remove(paths.newExe)
		fail("%v", err)
		return
	}

	succeeded = true
	sendOutput("Binary ersetzt, Agent startet neu …\n", false, 0)
	log.Printf("🔄 Agent update to %s installed, exiting with code %d for restart", payload.Version, restartExitCode)

	// Give the websocket a moment to flush, then exit. A non-zero code makes
	// both systemd (Restart=always/on-failure) and the Windows SCM recovery
	// actions restart the service with the new binary.
	time.Sleep(500 * time.Millisecond)
	if a.conn != nil {
		a.conn.Close()
	}
	os.Exit(restartExitCode)
}

// downloadVerified streams url into dest while hashing; dest is only left on
// disk if size and SHA-256 match.
func downloadVerified(url, dest, wantSHA string, wantSize int64) error {
	ctx, cancel := context.WithTimeout(context.Background(), downloadTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("Download-Request: %v", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("Download fehlgeschlagen: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("Download fehlgeschlagen: HTTP %d", resp.StatusCode)
	}

	os.Remove(dest)
	f, err := os.OpenFile(dest, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0755)
	if err != nil {
		return fmt.Errorf("Zieldatei: %v", err)
	}
	h := sha256.New()
	n, copyErr := io.Copy(io.MultiWriter(f, h), io.LimitReader(resp.Body, wantSize+1))
	syncErr := f.Sync()
	closeErr := f.Close()
	if copyErr != nil {
		return fmt.Errorf("Download abgebrochen: %v", copyErr)
	}
	if syncErr != nil || closeErr != nil {
		return fmt.Errorf("Schreiben fehlgeschlagen: %v %v", syncErr, closeErr)
	}
	if n != wantSize {
		return fmt.Errorf("Größe stimmt nicht: erwartet %d, erhalten %d", wantSize, n)
	}
	if got := hex.EncodeToString(h.Sum(nil)); got != wantSHA {
		return fmt.Errorf("SHA-256 stimmt nicht: erwartet %s…, erhalten %s…", wantSHA[:12], got[:12])
	}
	return nil
}

// checkBinaryVersion runs "<bin> -version" and compares the output.
func checkBinaryVersion(bin, want string) error {
	ctx, cancel := context.WithTimeout(context.Background(), versionCheckLimit)
	defer cancel()
	out, err := exec.CommandContext(ctx, bin, "-version").Output()
	if err != nil {
		return fmt.Errorf("neue Binary startet nicht (-version): %v", err)
	}
	got := strings.TrimSpace(string(out))
	if got != want {
		return fmt.Errorf("neue Binary meldet Version %q statt %q", got, want)
	}
	return nil
}

// swapBinaries moves exe→bak and newExe→exe; on failure it restores exe.
// Renaming a running executable is allowed on Linux and Windows.
func swapBinaries(p updatePaths) error {
	os.Remove(p.bak)
	if err := os.Rename(p.exe, p.bak); err != nil {
		return fmt.Errorf("Sicherung der alten Binary fehlgeschlagen: %v", err)
	}
	if err := os.Rename(p.newExe, p.exe); err != nil {
		if rbErr := os.Rename(p.bak, p.exe); rbErr != nil {
			return fmt.Errorf("Austausch fehlgeschlagen (%v) UND Wiederherstellung fehlgeschlagen (%v)", err, rbErr)
		}
		return fmt.Errorf("Austausch fehlgeschlagen: %v", err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// New binary: confirm or roll back
// ---------------------------------------------------------------------------

// startupAction is what the agent must do after evaluating the marker.
type startupAction int

const (
	startupNormal        startupAction = iota // no update pending
	startupAwaitConfirm                       // new version, wait for "registered"
	startupRolledBack                         // old binary restored → exit and restart
	startupReportFailure                      // old binary after rollback → report once registered
)

// evaluateUpdateMarker inspects the marker on startup. It is pure file logic so
// it can be unit-tested with temporary paths.
func evaluateUpdateMarker(p updatePaths, running string) (startupAction, *updateMarker) {
	m, err := readMarker(p.marker)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			log.Printf("⚠️ Unreadable update marker removed: %v", err)
			os.Remove(p.marker)
		}
		// No update in flight: clean leftovers of earlier attempts.
		os.Remove(p.newExe)
		os.Remove(p.bak)
		return startupNormal, nil
	}

	if m.State == "rolled_back" {
		return startupReportFailure, m
	}

	if m.ToVersion != running {
		// We are not the binary the update installed (swap did not happen or
		// someone replaced the binary manually) → nothing to confirm.
		log.Printf("⚠️ Update marker for %s, but running %s – discarding marker", m.ToVersion, running)
		os.Remove(p.marker)
		os.Remove(p.newExe)
		os.Remove(p.bak)
		return startupNormal, nil
	}

	m.Attempts++
	if m.Attempts > maxStartAttempts {
		reason := fmt.Sprintf("Version %s hat sich nach %d Starts nicht registriert", m.ToVersion, maxStartAttempts)
		if err := rollbackBinary(p); err != nil {
			// Nothing to roll back to – keep running the new binary.
			log.Printf("❌ Rollback impossible: %v", err)
			os.Remove(p.marker)
			return startupNormal, nil
		}
		m.State = "rolled_back"
		m.Error = reason
		if err := writeMarker(p.marker, m); err != nil {
			log.Printf("⚠️ Could not persist rollback marker: %v", err)
		}
		log.Printf("↩️ Rolled back to %s: %s", m.FromVersion, reason)
		return startupRolledBack, m
	}

	if err := writeMarker(p.marker, m); err != nil {
		log.Printf("⚠️ Could not update marker: %v", err)
	}
	log.Printf("🆕 Started updated agent %s (attempt %d/%d), waiting for registration", m.ToVersion, m.Attempts, maxStartAttempts)
	return startupAwaitConfirm, m
}

func rollbackBinary(p updatePaths) error {
	if _, err := os.Stat(p.bak); err != nil {
		return fmt.Errorf("no backup binary: %v", err)
	}
	failed := p.exe + ".failed"
	os.Remove(failed)
	if err := os.Rename(p.exe, failed); err != nil {
		return err
	}
	if err := os.Rename(p.bak, p.exe); err != nil {
		os.Rename(failed, p.exe)
		return err
	}
	os.Remove(failed)
	return nil
}

// pendingUpdate tracks the marker state of this process between startup and
// the first successful registration.
type pendingUpdate struct {
	paths  updatePaths
	action startupAction
	marker *updateMarker
	done   atomic.Bool
}

// initSelfUpdate is called at the very beginning of runAgent (before the
// config is loaded, so a broken config also counts as a failed start). It may
// exit the process (rollback / watchdog).
func initSelfUpdate() *pendingUpdate {
	paths, err := defaultUpdatePaths()
	if err != nil {
		log.Printf("⚠️ Self-update disabled: %v", err)
		return nil
	}
	action, marker := evaluateUpdateMarker(paths, Version)
	switch action {
	case startupRolledBack:
		os.Exit(restartExitCode)
	case startupAwaitConfirm:
		p := &pendingUpdate{paths: paths, action: action, marker: marker}
		go func() {
			time.Sleep(registerWatchdog)
			if !p.done.Load() {
				log.Printf("❌ Updated agent not registered within %v, restarting (attempt %d/%d)", registerWatchdog, p.marker.Attempts, maxStartAttempts)
				os.Exit(restartExitCode)
			}
		}()
		return p
	case startupReportFailure:
		return &pendingUpdate{paths: paths, action: action, marker: marker}
	}
	return nil
}

// onRegistered confirms a pending update (or reports a rollback) once the
// server accepted the registration.
func (a *Agent) onRegistered() {
	p := a.pending
	if p == nil || !p.done.CompareAndSwap(false, true) {
		return
	}
	os.Remove(p.paths.marker)
	os.Remove(p.paths.newExe)
	os.Remove(p.paths.bak)

	var output string
	exitCode := 0
	switch p.action {
	case startupAwaitConfirm:
		output = fmt.Sprintf("✅ Update erfolgreich: %s → %s\n", p.marker.FromVersion, p.marker.ToVersion)
		log.Printf("✅ Update to %s confirmed", Version)
	case startupReportFailure:
		output = fmt.Sprintf("↩️ Update fehlgeschlagen und zurückgerollt auf %s: %s\n", Version, p.marker.Error)
		exitCode = 1
	}
	if p.marker.CommandID == "" {
		return
	}
	msg := CommandResponseMessage{
		Type:      "command_response",
		MachineID: a.machineId,
		CommandID: p.marker.CommandID,
		Output:    output,
		ExitCode:  exitCode,
		Completed: true,
	}
	if err := a.writeJSON(msg); err != nil {
		log.Printf("Failed to report update result: %v", err)
	}
}
