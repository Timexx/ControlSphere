package main

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func sha(b []byte) string {
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

func testPaths(t *testing.T) updatePaths {
	t.Helper()
	dir := t.TempDir()
	return pathsFor(filepath.Join(dir, "maintainer-agent"), filepath.Join(dir, "state"))
}

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0755); err != nil {
		t.Fatal(err)
	}
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func TestPayloadValidate(t *testing.T) {
	good := UpdateAgentPayload{Version: "v1.2-3-gabc", SHA256: sha([]byte("x")), Size: 10}
	if err := good.validate(); err != nil {
		t.Fatalf("valid payload rejected: %v", err)
	}
	bad := []UpdateAgentPayload{
		{Version: "", SHA256: good.SHA256, Size: 10},
		{Version: "v1; rm -rf /", SHA256: good.SHA256, Size: 10},
		{Version: "v1", SHA256: "ABC", Size: 10},
		{Version: "v1", SHA256: good.SHA256, Size: 0},
		{Version: "v1", SHA256: good.SHA256, Size: maxBinarySize + 1},
	}
	for i, p := range bad {
		if err := p.validate(); err == nil {
			t.Errorf("case %d: invalid payload accepted", i)
		}
	}
}

func TestDownloadVerified(t *testing.T) {
	body := []byte("new-agent-binary")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/missing" {
			http.NotFound(w, r)
			return
		}
		w.Write(body)
	}))
	defer srv.Close()
	dest := filepath.Join(t.TempDir(), "agent.new")

	if err := downloadVerified(srv.URL+"/ok", dest, sha(body), int64(len(body))); err != nil {
		t.Fatalf("valid download rejected: %v", err)
	}
	if readFile(t, dest) != string(body) {
		t.Fatal("downloaded content differs")
	}

	if err := downloadVerified(srv.URL+"/ok", dest, sha([]byte("other")), int64(len(body))); err == nil {
		t.Fatal("wrong sha256 accepted")
	}
	if err := downloadVerified(srv.URL+"/ok", dest, sha(body), int64(len(body))-1); err == nil {
		t.Fatal("oversized body accepted")
	}
	if err := downloadVerified(srv.URL+"/ok", dest, sha(body), int64(len(body))+1); err == nil {
		t.Fatal("short body accepted")
	}
	if err := downloadVerified(srv.URL+"/missing", dest, sha(body), int64(len(body))); err == nil {
		t.Fatal("HTTP 404 accepted")
	}
}

func TestCheckBinaryVersion(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses a shell script as fake binary")
	}
	bin := filepath.Join(t.TempDir(), "fake")
	writeFile(t, bin, "#!/bin/sh\necho v2\n")
	if err := checkBinaryVersion(bin, "v2"); err != nil {
		t.Fatalf("matching version rejected: %v", err)
	}
	if err := checkBinaryVersion(bin, "v3"); err == nil {
		t.Fatal("mismatching version accepted")
	}
	broken := filepath.Join(t.TempDir(), "broken")
	writeFile(t, broken, "#!/bin/sh\nexit 1\n")
	if err := checkBinaryVersion(broken, "v2"); err == nil {
		t.Fatal("failing binary accepted")
	}
}

func TestSwapBinaries(t *testing.T) {
	p := testPaths(t)
	writeFile(t, p.exe, "old")
	writeFile(t, p.newExe, "new")
	if err := swapBinaries(p); err != nil {
		t.Fatal(err)
	}
	if readFile(t, p.exe) != "new" || readFile(t, p.bak) != "old" || exists(p.newExe) {
		t.Fatal("unexpected state after swap")
	}

	// Missing candidate: the running binary must be restored.
	p2 := testPaths(t)
	writeFile(t, p2.exe, "old")
	if err := swapBinaries(p2); err == nil {
		t.Fatal("swap without candidate succeeded")
	}
	if readFile(t, p2.exe) != "old" {
		t.Fatal("running binary not restored after failed swap")
	}
}

func TestNoMarkerCleansLeftovers(t *testing.T) {
	p := testPaths(t)
	writeFile(t, p.exe, "cur")
	writeFile(t, p.newExe, "stale")
	writeFile(t, p.bak, "stale")
	action, _ := evaluateUpdateMarker(p, "v1")
	if action != startupNormal || exists(p.newExe) || exists(p.bak) {
		t.Fatalf("action=%v, leftovers not cleaned", action)
	}
}

func TestMarkerForOtherVersionIsDiscarded(t *testing.T) {
	p := testPaths(t)
	writeFile(t, p.exe, "old")
	if err := writeMarker(p.marker, &updateMarker{FromVersion: "v1", ToVersion: "v2", State: "pending"}); err != nil {
		t.Fatal(err)
	}
	action, _ := evaluateUpdateMarker(p, "v1")
	if action != startupNormal || exists(p.marker) {
		t.Fatalf("action=%v, marker kept", action)
	}
}

func TestConfirmAndRollback(t *testing.T) {
	p := testPaths(t)
	writeFile(t, p.exe, "new")
	writeFile(t, p.bak, "old")
	if err := writeMarker(p.marker, &updateMarker{CommandID: "c1", FromVersion: "v1", ToVersion: "v2", State: "pending"}); err != nil {
		t.Fatal(err)
	}

	for attempt := 1; attempt <= maxStartAttempts; attempt++ {
		action, m := evaluateUpdateMarker(p, "v2")
		if action != startupAwaitConfirm || m.Attempts != attempt {
			t.Fatalf("attempt %d: action=%v attempts=%d", attempt, action, m.Attempts)
		}
	}

	// One start too many → old binary restored.
	action, m := evaluateUpdateMarker(p, "v2")
	if action != startupRolledBack || m.State != "rolled_back" {
		t.Fatalf("expected rollback, got action=%v state=%s", action, m.State)
	}
	if readFile(t, p.exe) != "old" || exists(p.bak) {
		t.Fatal("old binary not restored")
	}

	// The restored old binary reports the failure.
	action, m = evaluateUpdateMarker(p, "v1")
	if action != startupReportFailure || m.CommandID != "c1" || m.Error == "" {
		t.Fatalf("expected failure report, got action=%v", action)
	}

	// On Windows the rolled-back binary cannot be deleted while it still
	// runs and stays behind as .failed – simulate that leftover.
	writeFile(t, p.failed, "new")

	// onRegistered clears the marker and the leftover.
	a := &Agent{pending: &pendingUpdate{paths: p, action: action, marker: m}}
	a.onRegistered()
	if exists(p.marker) || exists(p.failed) {
		t.Fatal("marker or .failed not removed after report")
	}
}

func TestRollbackWithoutBackupKeepsNewBinary(t *testing.T) {
	p := testPaths(t)
	writeFile(t, p.exe, "new")
	if err := writeMarker(p.marker, &updateMarker{FromVersion: "v1", ToVersion: "v2", State: "pending", Attempts: maxStartAttempts}); err != nil {
		t.Fatal(err)
	}
	action, _ := evaluateUpdateMarker(p, "v2")
	if action != startupNormal || readFile(t, p.exe) != "new" || exists(p.marker) {
		t.Fatalf("action=%v: new binary must stay without backup", action)
	}
}

func TestConfirmRemovesBackup(t *testing.T) {
	p := testPaths(t)
	writeFile(t, p.exe, "new")
	writeFile(t, p.bak, "old")
	if err := writeMarker(p.marker, &updateMarker{FromVersion: "v1", ToVersion: "v2", State: "pending"}); err != nil {
		t.Fatal(err)
	}
	action, m := evaluateUpdateMarker(p, "v2")
	a := &Agent{pending: &pendingUpdate{paths: p, action: action, marker: m}}
	a.onRegistered()
	if exists(p.marker) || exists(p.bak) || readFile(t, p.exe) != "new" {
		t.Fatal("confirm did not clean up")
	}
}

func TestNonceReplay(t *testing.T) {
	a := &Agent{}
	if !a.rememberNonce("n1") {
		t.Fatal("first nonce rejected")
	}
	if a.rememberNonce("n1") {
		t.Fatal("replayed nonce accepted")
	}
}
