package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/maintainer/agent/platform"
	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/disk"
	"github.com/shirou/gopsutil/v3/host"
	"github.com/shirou/gopsutil/v3/mem"
)

var (
	serverURL      = flag.String("server", "ws://localhost:3000/ws/agent", "Maintainer server WebSocket URL")
	secretKey      = flag.String("key", "", "Secret key for authentication")
	configFile     = flag.String("config", "", "Path to config file (default: OS-specific)")
	svcInstall     = flag.Bool("install", false, "Install as Windows Service (Windows only)")
	svcUninstall   = flag.Bool("uninstall", false, "Uninstall Windows Service (Windows only)")
)

type Config struct {
	ServerURL string `json:"server_url"`
	SecretKey string `json:"secret_key"`
}

// RegisterMessage is sent during agent registration
type RegisterMessage struct {
	Type      string `json:"type"`
	Hostname  string `json:"hostname"`
	IP        string `json:"ip"`
	OSInfo    OSInfo `json:"osInfo"`
	SecretKey string `json:"secretKey"`
	Platform  string `json:"platform"`
}

// HeartbeatMessage is sent periodically with metrics and port data
type HeartbeatMessage struct {
	Type      string  `json:"type"`
	MachineID string  `json:"machineId"`
	Metrics   Metrics `json:"metrics"`
	Ports     []Port  `json:"ports"`
}

// TerminalOutputMessage is sent when terminal produces output
type TerminalOutputMessage struct {
	Type      string `json:"type"`
	SessionID string `json:"sessionId"`
	Output    string `json:"output"`
}

// CommandResponseMessage is sent when command execution completes
type CommandResponseMessage struct {
	Type      string `json:"type"`
	MachineID string `json:"machineId"`
	CommandID string `json:"commandId"`
	Output    string `json:"output"`
	ExitCode  int    `json:"exitCode"`
	Completed bool   `json:"completed"`
}

// Message is the generic incoming message from server
type Message struct {
	Type      string          `json:"type"`
	Data      json.RawMessage `json:"data,omitempty"`
	MachineID string          `json:"machineId,omitempty"`
}

// Type aliases — canonical definitions live in the platform package.
type OSInfo = platform.OSInfo

type DiskInfo struct {
	Path  string  `json:"path"`  // Mount point or drive letter (e.g., C:\, /dev/sda1, /home)
	Usage float64 `json:"usage"` // Percentage
	Total float64 `json:"total"` // GB
	Used  float64 `json:"used"`  // GB
}

type Metrics struct {
	CPUUsage  float64    `json:"cpuUsage"`
	RAMUsage  float64    `json:"ramUsage"`
	RAMTotal  float64    `json:"ramTotal"`
	RAMUsed   float64    `json:"ramUsed"`
	DiskUsage float64    `json:"diskUsage"` // Aggregate total for backward compat
	DiskTotal float64    `json:"diskTotal"` // Aggregate total
	DiskUsed  float64    `json:"diskUsed"`  // Aggregate total
	Disks     []DiskInfo `json:"disks"`     // Per-disk breakdown
	Uptime    uint64     `json:"uptime"`
}

type Port = platform.Port

type ExecuteCommandData struct {
	CommandID string `json:"commandId"`
	Command   string `json:"command"`
}

type SpawnShellData struct {
	SessionID string `json:"sessionId"`
}

type TerminalStdinData struct {
	SessionID string `json:"sessionId"`
	Data      string `json:"data"`
}

// SecureMessageData wraps terminal commands with HMAC for integrity verification
type SecureMessageData struct {
	SessionID string      `json:"sessionId"`
	MachineID string      `json:"machineId"`
	Payload   json.RawMessage `json:"payload"` // keep raw payload bytes for deterministic HMAC
	Nonce     string      `json:"nonce"`
	Timestamp string      `json:"timestamp"`
	HMAC      string      `json:"hmac"`
}

type TerminalResizeData struct {
	SessionID string `json:"sessionId"`
	Cols      int    `json:"cols"`
	Rows      int    `json:"rows"`
}

type CommandOutputData struct {
	CommandID string `json:"commandId"`
	Output    string `json:"output,omitempty"`
	ExitCode  int    `json:"exitCode,omitempty"`
	Completed bool   `json:"completed,omitempty"`
}

type CommandResponseData struct {
	CommandID string `json:"commandId"`
	Output    string `json:"output"`
	ExitCode  int    `json:"exitCode"`
}

// UpdateAgentData contains the update command details
type UpdateAgentData struct {
	CommandID  string `json:"commandId"`
	ServerURL  string `json:"serverUrl"`  // Base HTTP URL for downloading the source code
}

type AuditEvent struct {
	Action    string    `json:"action"`
	Message   string    `json:"message,omitempty"`
	Severity  string    `json:"severity,omitempty"`
	Command   string    `json:"command,omitempty"`
	ExitCode  *int      `json:"exitCode,omitempty"`
	Timestamp time.Time `json:"timestamp,omitempty"`
}

type PackageInfo = platform.PackageInfo
type ScanSummary = platform.PackageSummary
type SecurityFinding = platform.SecurityFinding
type SecurityEvent = platform.SecurityEvent

type ScanPayload struct {
	MachineID         string            `json:"machineId"`
	Packages          []PackageInfo     `json:"packages"`
	Summary           ScanSummary       `json:"summary"`
	ConfigFindings    []SecurityFinding `json:"configFindings,omitempty"`
	IntegrityFindings []SecurityFinding `json:"integrityFindings,omitempty"`
	Events            []SecurityEvent   `json:"events,omitempty"`
}

type Agent struct {
	conn      *websocket.Conn
	config    Config
	terminals map[string]platform.Terminal
	writeMu   sync.Mutex
	httpMu    sync.Mutex
	httpClient *http.Client
	machineId string
	shutdownCh chan struct{} // signals graceful shutdown (e.g. update)

	packageScanMu   sync.Mutex
	lastPackageScan time.Time

	scanProgressMu sync.Mutex
	scanStartedAt  time.Time
	
	// Security monitoring state
	fileHashes         map[string]string // Stores hashes for integrity monitoring
	fileHashesMu       sync.Mutex
	
	// Track reported events to avoid duplicates
	reportedEvents     map[string]time.Time // fingerprint -> last reported time
	reportedEventsMu   sync.Mutex
	
	// Track cumulative failed login counts per IP (persists across scans)
	failedLoginCounts  map[string]int // IP -> total count
	failedLoginsMu     sync.Mutex
}

// writeJSON serializes websocket writes to avoid concurrent writer errors.
func (a *Agent) writeJSON(v interface{}) error {
	a.writeMu.Lock()
	defer a.writeMu.Unlock()

	if a.conn == nil {
		return fmt.Errorf("no active websocket connection")
	}

	return a.conn.WriteJSON(v)
}

// verifyHMAC verifies the HMAC signature of a secure message
// Returns the unwrapped payload if valid, error otherwise
func (a *Agent) verifyHMAC(secureData SecureMessageData, messageType string) (interface{}, error) {
	// Reconstruct the message exactly like Node.js JSON.stringify on the server
	// Field order: type, sessionId, machineId, payload, nonce, timestamp
	// CRITICAL: payload is sent as a JSON string, so we embed it directly (already serialized)
	// Do NOT use %s with string() which would add quotes - use it as-is from the raw bytes
	
	// The payload field in secureData.Payload is already a JSON string like `{"data":"h"}`
	// We need to embed it as: "payload":{"data":"h"} (not "payload":"{\"data\":\"h\"}")
	msgToSignStr := fmt.Sprintf(
		"{\"type\":\"%s\",\"sessionId\":\"%s\",\"machineId\":\"%s\",\"payload\":%s,\"nonce\":\"%s\",\"timestamp\":\"%s\"}",
		messageType,
		secureData.SessionID,
		secureData.MachineID,
		string(secureData.Payload), // Already a JSON string, insert as-is without extra quotes
		secureData.Nonce,
		secureData.Timestamp,
	)
	msgBytes := []byte(msgToSignStr)

	// Compute expected HMAC using our secret key
	mac := hmac.New(sha256.New, []byte(a.config.SecretKey))
	mac.Write(msgBytes)
	expectedHMAC := hex.EncodeToString(mac.Sum(nil))

	// Compare HMACs (constant-time comparison to prevent timing attacks)
	if !hmac.Equal([]byte(expectedHMAC), []byte(secureData.HMAC)) {
		return nil, fmt.Errorf("HMAC verification failed: signature mismatch")
	}

	// Verify timestamp (prevent replay attacks with old messages)
	msgTime, err := time.Parse(time.RFC3339, secureData.Timestamp)
	if err != nil {
		return nil, fmt.Errorf("invalid timestamp format: %v", err)
	}

	// Allow reasonable clock skew (default +/-5 minutes); warn if beyond 60s
	age := time.Since(msgTime)
	const maxSkew = 5 * time.Minute
	if age < -maxSkew || age > maxSkew {
		return nil, fmt.Errorf("message timestamp out of acceptable range: %v", age)
	}
	if age < -60*time.Second || age > 60*time.Second {
		log.Printf("⚠️ clock skew detected for %s: %v (session %s)", messageType, age, secureData.SessionID[:8])
	}

	log.Printf("✅ HMAC verified for %s (session: %s, nonce: %s)", messageType, secureData.SessionID[:8], secureData.Nonce[:8])
	return secureData.Payload, nil
}

func (a *Agent) httpBaseURL() string {
	parsed, err := url.Parse(a.config.ServerURL)
	if err != nil {
		return ""
	}

	switch parsed.Scheme {
	case "ws":
		parsed.Scheme = "http"
	case "wss":
		parsed.Scheme = "https"
	}

	parsed.Path = ""
	parsed.RawQuery = ""
	parsed.Fragment = ""

	base := strings.TrimSuffix(parsed.String(), "/")
	return base
}

// sendScanProgress posts live scan progress to the server so the UI can render ETA and phase
func (a *Agent) sendScanProgress(phase string, percent int, etaSeconds int64) {
	if a.machineId == "" {
		return
	}
	base := a.httpBaseURL()
	if base == "" {
		return
	}

	payload := map[string]interface{}{
		"machineId":  a.machineId,
		"phase":      phase,
		"progress":   percent,
		"etaSeconds": etaSeconds,
		"startedAt":  a.scanStartedAt.Format(time.RFC3339),
	}

	data, err := json.Marshal(payload)
	if err != nil {
		return
	}

	req, err := http.NewRequest("POST", fmt.Sprintf("%s/api/agent/scan/progress", base), bytes.NewBuffer(data))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Agent-Secret", a.config.SecretKey)

	a.httpMu.Lock()
	client := a.httpClient
	a.httpMu.Unlock()

	resp, err := client.Do(req)
	if err != nil {
		return
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body)
}

func (a *Agent) emitAudit(event AuditEvent) {
	go a.sendAudit([]AuditEvent{event})
}

func (a *Agent) sendAudit(events []AuditEvent) {
	if len(events) == 0 {
		return
	}
	if a.machineId == "" {
		return
	}

	base := a.httpBaseURL()
	if base == "" {
		return
	}

	payload := map[string]interface{}{
		"machineId": a.machineId,
		"events":    events,
	}

	data, err := json.Marshal(payload)
	if err != nil {
		log.Printf("Failed to marshal audit events: %v", err)
		return
	}

	req, err := http.NewRequest("POST", fmt.Sprintf("%s/api/agent/audit", base), bytes.NewBuffer(data))
	if err != nil {
		log.Printf("Failed to build audit request: %v", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Agent-Secret", a.config.SecretKey)

	a.httpMu.Lock()
	client := a.httpClient
	a.httpMu.Unlock()

	resp, err := client.Do(req)
	if err != nil {
		log.Printf("Audit request failed: %v", err)
		return
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body)

	if resp.StatusCode >= 300 {
		log.Printf("Audit request returned status %d", resp.StatusCode)
	}
}

func (a *Agent) sendPackageScan(packages []PackageInfo, summary ScanSummary, configFindings []SecurityFinding, integrityFindings []SecurityFinding, events []SecurityEvent) {
	if a.machineId == "" {
		return
	}

	a.sendScanProgress("finalizing", 100, 0)

	base := a.httpBaseURL()
	if base == "" {
		return
	}

	payload := ScanPayload{
		MachineID:         a.machineId,
		Packages:          packages,
		Summary:           summary,
		ConfigFindings:    configFindings,
		IntegrityFindings: integrityFindings,
		Events:            events,
	}

	data, err := json.Marshal(payload)
	if err != nil {
		log.Printf("Failed to marshal package scan: %v", err)
		return
	}

	req, err := http.NewRequest("POST", fmt.Sprintf("%s/api/agent/scan", base), bytes.NewBuffer(data))
	if err != nil {
		log.Printf("Failed to build scan request: %v", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Agent-Secret", a.config.SecretKey)

	a.httpMu.Lock()
	client := a.httpClient
	a.httpMu.Unlock()

	resp, err := client.Do(req)
	if err != nil {
		log.Printf("Scan request failed: %v", err)
		return
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode >= 300 {
		log.Printf("Scan request returned status %d: %s", resp.StatusCode, string(body))
		return
	}

	// Log successful scan with event details
	log.Printf("✅ Scan sent successfully: %d packages, %d config findings, %d integrity findings, %d security events", 
		len(packages), len(configFindings), len(integrityFindings), len(events))

	if len(body) > 0 {
		log.Printf("Scan response: %s", string(body))
	}
}

// SecurityEventPayload for sending security events separately
type SecurityEventPayload struct {
	MachineID string          `json:"machineId"`
	Events    []SecurityEvent `json:"events"`
}

// checkAndReportSecurityEvents checks for new security events and reports them immediately
func (a *Agent) checkAndReportSecurityEvents() {
	if a.machineId == "" {
		return
	}

	// Check auth logs for new events
	events := a.checkAuthLogIncremental()
	
	if len(events) == 0 {
		return
	}

	log.Printf("🔍 Found %d potential security events to report", len(events))

	// Filter out already reported events (within last hour)
	a.reportedEventsMu.Lock()
	newEvents := []SecurityEvent{}
	now := time.Now()
	
	for _, evt := range events {
		lastReported, exists := a.reportedEvents[evt.Fingerprint]
		// Report if never reported or if more than 1 hour since last report
		if !exists || now.Sub(lastReported) > time.Hour {
			newEvents = append(newEvents, evt)
			a.reportedEvents[evt.Fingerprint] = now
			log.Printf("  → Will report: %s (fingerprint: %s)", evt.Message, evt.Fingerprint)
		} else {
			log.Printf("  → Skipping (already reported %v ago): %s", now.Sub(lastReported), evt.Fingerprint)
		}
	}
	
	// Cleanup old entries (older than 24 hours)
	for fp, t := range a.reportedEvents {
		if now.Sub(t) > 24*time.Hour {
			delete(a.reportedEvents, fp)
		}
	}
	a.reportedEventsMu.Unlock()

	if len(newEvents) == 0 {
		log.Printf("  → No new events to report (all already reported)")
		return
	}

	log.Printf("🔔 Reporting %d new security events", len(newEvents))
	a.sendSecurityEvents(newEvents)
}

// sendSecurityEvents sends security events to the server immediately
func (a *Agent) sendSecurityEvents(events []SecurityEvent) {
	base := a.httpBaseURL()
	if base == "" {
		return
	}

	payload := SecurityEventPayload{
		MachineID: a.machineId,
		Events:    events,
	}

	data, err := json.Marshal(payload)
	if err != nil {
		log.Printf("Failed to marshal security events: %v", err)
		return
	}

	req, err := http.NewRequest("POST", fmt.Sprintf("%s/api/agent/security-events", base), bytes.NewBuffer(data))
	if err != nil {
		log.Printf("Failed to build security events request: %v", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Agent-Secret", a.config.SecretKey)

	a.httpMu.Lock()
	client := a.httpClient
	a.httpMu.Unlock()

	resp, err := client.Do(req)
	if err != nil {
		log.Printf("Security events request failed: %v", err)
		return
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode >= 300 {
		log.Printf("Security events request returned status %d: %s", resp.StatusCode, string(body))
		return
	}

	log.Printf("✅ Security events sent: %d events", len(events))
}

// checkAuthLogIncremental delegates to the platform-specific implementation
// which reads new entries from the OS auth/security log and returns events
// with fingerprints. The platform tracks its own read position internally.
func (a *Agent) checkAuthLogIncremental() []SecurityEvent {
	a.failedLoginsMu.Lock()
	events := platform.Current.CheckAuthLogIncremental(a.failedLoginCounts)
	a.failedLoginsMu.Unlock()
	return events
}

func main() {
	flag.Parse()

	// Windows Service management commands
	if *svcInstall {
		if err := installService(); err != nil {
			log.Fatalf("Failed to install service: %v", err)
		}
		return
	}
	if *svcUninstall {
		if err := uninstallService(); err != nil {
			log.Fatalf("Failed to uninstall service: %v", err)
		}
		return
	}

	// If running as a Windows Service, dispatch to the SCM handler.
	// runAsService() returns false on non-Windows or when running interactively.
	if runAsService() {
		return
	}

	// Interactive / foreground mode
	runAgent()
}

// runAgent contains the main agent loop. It is called directly in foreground
// mode and from the Windows Service handler in service mode.
func runAgent() {
	// Use platform-specific default config path if not overridden
	if *configFile == "" {
		*configFile = platform.Current.ConfigPath()
	}

	log.Printf("runAgent: platform=%s, configFile=%s", runtime.GOOS, *configFile)

	config, err := loadConfig()
	if err != nil {
		log.Printf("FATAL: Failed to load config: %v", err)
		return
	}

	log.Printf("runAgent: serverURL=%s, secretKey=%s..., platform=%s",
		config.ServerURL,
		func() string {
			if len(config.SecretKey) >= 8 {
				return config.SecretKey[:8]
			}
			return "(empty)"
		}(),
		runtime.GOOS,
	)

	agent := &Agent{
		config:            config,
		terminals:         make(map[string]platform.Terminal),
		httpClient:        &http.Client{Timeout: 30 * time.Second},
		fileHashes:        make(map[string]string),
		reportedEvents:    make(map[string]time.Time),
		failedLoginCounts: make(map[string]int),
		shutdownCh:        make(chan struct{}),
	}

	// Handle graceful shutdown with platform-appropriate signals
	sigChan := make(chan os.Signal, 1)
	shutdownCh := agent.shutdownCh
	signal.Notify(sigChan, platform.Current.ShutdownSignals()...)

	go func() {
		<-sigChan
		log.Println("Shutting down gracefully...")
		close(shutdownCh)
		if agent.conn != nil {
			agent.conn.Close()
		}
		// Do NOT call os.Exit here — it bypasses the Windows Service
		// handler's proper shutdown sequence. runAgent() returns
		// once shutdownCh is closed, letting the SCM handler clean up.
	}()

	// Connect and run
	for {
		select {
		case <-shutdownCh:
			log.Println("runAgent: shutdown signal received, exiting connect loop")
			return
		default:
		}

		err := agent.connect()
		if err != nil {
			log.Printf("Connection error: %v. Retrying in 5 seconds...", err)
			select {
			case <-shutdownCh:
				return
			case <-time.After(5 * time.Second):
			}
			continue
		}

		err = agent.run()
		if err != nil {
			log.Printf("Runtime error: %v. Reconnecting in 5 seconds...", err)
		}

		select {
		case <-shutdownCh:
			return
		case <-time.After(5 * time.Second):
		}
	}
}

func loadConfig() (Config, error) {
	config := Config{}

	// Try loading from config file
	if data, err := os.ReadFile(*configFile); err == nil {
		// Strip UTF-8 BOM if present (PowerShell 5.1 writes BOM with -Encoding UTF8)
		if len(data) >= 3 && data[0] == 0xEF && data[1] == 0xBB && data[2] == 0xBF {
			log.Printf("Stripping UTF-8 BOM from config file %s", *configFile)
			data = data[3:]
		}
		if err := json.Unmarshal(data, &config); err != nil {
			log.Printf("⚠️  Failed to parse config file %s: %v", *configFile, err)
		} else {
			log.Printf("✓ Config loaded from %s", *configFile)
		}
	} else {
		log.Printf("⚠️  Config file not found at %s: %v", *configFile, err)
	}

	// Override with flags if provided
	if *serverURL != "" && *serverURL != "ws://localhost:3000/ws/agent" {
		config.ServerURL = *serverURL
	}
	if *secretKey != "" {
		config.SecretKey = *secretKey
	}

	// Defaults
	if config.ServerURL == "" {
		config.ServerURL = "ws://localhost:3000/ws/agent"
	}

	if config.SecretKey == "" {
		return config, fmt.Errorf("secret key is required - use -key flag or set in config file (config: %s)", *configFile)
	}

	// AUTO-MIGRATION: Normalize secret key to 64 hex chars
	config.SecretKey = normalizeSecretKey(config.SecretKey)

	// Save normalized config back to file if it was loaded from file
	if _, err := os.Stat(*configFile); err == nil {
		saveConfig(config)
	}

	return config, nil
}

// normalizeSecretKey ensures the secret key is exactly 64 hex characters
// If the key is shorter or in wrong format, it generates a SHA-256 hash
func normalizeSecretKey(key string) string {
	// Remove any whitespace
	key = strings.TrimSpace(key)
	
	// Check if already valid (64 hex chars)
	matched, _ := regexp.MatchString("^[a-fA-F0-9]{64}$", key)
	if matched {
		return strings.ToLower(key)
	}

	// Legacy migration: Hash the old key to create valid 64-char hex
	log.Printf("⚠️  Secret key format invalid (length: %d). Auto-migrating to SHA-256 hash...", len(key))
	
	hash := sha256.Sum256([]byte(key))
	normalized := fmt.Sprintf("%x", hash)
	
	log.Printf("✓ Secret key normalized: %s... (64 hex chars)", normalized[:16])
	return normalized
}

// saveConfig writes the config back to the config file
func saveConfig(config Config) {
	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		log.Printf("Warning: Failed to marshal config: %v", err)
		return
	}

	// Ensure directory exists
	dir := filepath.Dir(*configFile)
	if err := os.MkdirAll(dir, 0755); err != nil {
		log.Printf("Warning: Failed to create config directory: %v", err)
		return
	}

	// Write with secure permissions (only root can read)
	if err := os.WriteFile(*configFile, data, 0600); err != nil {
		log.Printf("Warning: Failed to save config: %v", err)
		return
	}

	log.Printf("✓ Config saved to %s", *configFile)
}

func (a *Agent) connect() error {
	log.Printf("Connecting to %s...", a.config.ServerURL)

	// Add connection timeout to prevent hanging on unreachable servers
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	dialer := *websocket.DefaultDialer
	dialer.HandshakeTimeout = 10 * time.Second

	conn, _, err := dialer.DialContext(ctx, a.config.ServerURL, nil)
	if err != nil {
		return fmt.Errorf("dial error: %w", err)
	}

	a.conn = conn
	log.Println("Connected successfully")

	// Send registration
	return a.register()
}

func (a *Agent) register() error {
	hostname, _ := os.Hostname()
	ip := platform.Current.GetOutboundIP()
	osInfo := platform.Current.GetOSInfo()

	msg := RegisterMessage{
		Type:      "register",
		Hostname:  hostname,
		IP:        ip,
		OSInfo:    OSInfo{Distro: osInfo.Distro, Release: osInfo.Release, Kernel: osInfo.Kernel},
		SecretKey: a.config.SecretKey,
		Platform:  runtime.GOOS,
	}

	return a.writeJSON(msg)
}

func (a *Agent) run() error {
	// Start heartbeat
	heartbeatTicker := time.NewTicker(5 * time.Second)
	defer heartbeatTicker.Stop()

	// Start security monitoring (every 10 seconds)
	securityTicker := time.NewTicker(10 * time.Second)
	defer securityTicker.Stop()

	go func() {
		for range heartbeatTicker.C {
			a.sendHeartbeat()
		}
	}()

	go func() {
		for range securityTicker.C {
			a.checkAndReportSecurityEvents()
		}
	}()

	// Listen for messages
	for {
		var msg Message
		err := a.conn.ReadJSON(&msg)
		if err != nil {
			return fmt.Errorf("read error: %w", err)
		}

		go a.handleMessage(msg)
	}
}

func (a *Agent) sendHeartbeat() {
	if a.machineId == "" {
		// Cannot send heartbeat without machine ID
		return
	}

	metrics := collectMetrics()
	ports := platform.Current.CollectPorts()

	msg := HeartbeatMessage{
		Type:      "heartbeat",
		MachineID: a.machineId,
		Metrics:   metrics,
		Ports:     ports,
	}

	err := a.writeJSON(msg)
	if err != nil {
		log.Printf("Failed to send heartbeat: %v", err)
	}

	a.maybeRunPackageScan()
}

func (a *Agent) handleMessage(msg Message) {
	switch msg.Type {
	case "registered":
		if msg.MachineID != "" {
			a.machineId = msg.MachineID
		} else if len(msg.Data) > 0 {
			var payload struct {
				MachineID string `json:"machineId"`
			}
			if err := json.Unmarshal(msg.Data, &payload); err == nil && payload.MachineID != "" {
				a.machineId = payload.MachineID
			}
		}
		if a.machineId != "" {
			log.Printf("Registered with machine ID: %s", a.machineId)
		}

	case "execute_command":
		// NEW: Secure execute_command with HMAC verification
		var secureData SecureMessageData
		if err := json.Unmarshal(msg.Data, &secureData); err != nil {
			log.Printf("Failed to unmarshal execute_command secure envelope: %v", err)
			return
		}

		// DEBUG: Log what we received
		log.Printf("🔍 DEBUG execute_command: sessionId=%s, payload=%s, nonce=%s",
			secureData.SessionID[:8], string(secureData.Payload), secureData.Nonce[:8])

		// Verify HMAC signature
		payload, err := a.verifyHMAC(secureData, "execute_command")
		if err != nil {
			log.Printf("⚠️ HMAC verification failed for execute_command: %v", err)
			log.Printf("🔍 DEBUG: Expected to reconstruct: type=execute_command, sessionId=%s, machineId=%s, payload=%s, nonce=%s, timestamp=%s",
				secureData.SessionID, secureData.MachineID, string(secureData.Payload), secureData.Nonce, secureData.Timestamp)
			return
		}

		// Extract the actual command data from payload
		payloadBytes, ok := payload.(json.RawMessage)
		if !ok {
			log.Printf("Failed to parse execute_command payload: unexpected type %T", payload)
			return
		}

		// The payload is a JSON string, so we need to unmarshal it twice:
		// First to get the string value, then to parse that string as JSON
		var payloadStr string
		if err := json.Unmarshal(payloadBytes, &payloadStr); err != nil {
			log.Printf("Failed to unmarshal execute_command payload string: %v", err)
			return
		}

		var cmdData ExecuteCommandData
		if err := json.Unmarshal([]byte(payloadStr), &cmdData); err != nil {
			log.Printf("Failed to unmarshal execute_command payload: %v", err)
			return
		}

		log.Printf("✅ HMAC verified for execute_command (commandId: %s, nonce: %s)", cmdData.CommandID[:8], secureData.Nonce[:8])
		a.executeCommand(cmdData)

	case "update_agent":
		var data UpdateAgentData
		if err := json.Unmarshal(msg.Data, &data); err != nil {
			log.Printf("Failed to unmarshal update_agent: %v", err)
			return
		}
		a.updateAgent(data)

	case "spawn_shell":
		var data SpawnShellData
		if err := json.Unmarshal(msg.Data, &data); err != nil {
			log.Printf("Failed to unmarshal spawn_shell: %v", err)
			return
		}
		a.spawnShell(data)

	case "terminal_stdin":
		// First, try to unmarshal as secure message with HMAC
		var secureData SecureMessageData
		if err := json.Unmarshal(msg.Data, &secureData); err != nil {
			log.Printf("Failed to unmarshal terminal_stdin secure envelope: %v", err)
			return
		}

		// DEBUG: Log what we received
		log.Printf("🔍 DEBUG terminal_stdin: sessionId=%s, payload=%s, nonce=%s", 
			secureData.SessionID[:8], string(secureData.Payload), secureData.Nonce[:8])

		// Server signs stdin envelopes with the logical type "terminal_input"
		payload, err := a.verifyHMAC(secureData, "terminal_input")
		if err != nil {
			log.Printf("⚠️ HMAC verification failed for terminal_input: %v", err)
			log.Printf("🔍 DEBUG: Expected to reconstruct: type=terminal_input, sessionId=%s, machineId=%s, payload=%s, nonce=%s, timestamp=%s",
				secureData.SessionID, secureData.MachineID, string(secureData.Payload), secureData.Nonce, secureData.Timestamp)
			return
		}

		// Extract the actual terminal data from payload
		payloadBytes, ok := payload.(json.RawMessage)
		if !ok {
			log.Printf("Failed to parse terminal_stdin payload: unexpected type %T", payload)
			return
		}

		// The payload is a JSON string, so we need to unmarshal it twice:
		// First to get the string value, then to parse that string as JSON
		var payloadStr string
		if err := json.Unmarshal(payloadBytes, &payloadStr); err != nil {
			log.Printf("Failed to unmarshal terminal_stdin payload string: %v", err)
			return
		}

		var termData TerminalStdinData
		if err := json.Unmarshal([]byte(payloadStr), &termData); err != nil {
			log.Printf("Failed to unmarshal terminal_stdin payload: %v", err)
			return
		}

		// Use the sessionId from the secure envelope (not the payload)
		termData.SessionID = secureData.SessionID
		a.terminalStdin(termData)

	case "terminal_resize":
		// First, try to unmarshal as secure message with HMAC
		var secureData SecureMessageData
		if err := json.Unmarshal(msg.Data, &secureData); err != nil {
			log.Printf("Failed to unmarshal terminal_resize secure envelope: %v", err)
			return
		}

		// DEBUG: Log what we received
		log.Printf("🔍 DEBUG terminal_resize: sessionId=%s, payload=%s, nonce=%s", 
			secureData.SessionID[:8], string(secureData.Payload), secureData.Nonce[:8])

		// Verify HMAC signature
		payload, err := a.verifyHMAC(secureData, "terminal_resize")
		if err != nil {
			log.Printf("⚠️ HMAC verification failed for terminal_resize: %v", err)
			log.Printf("🔍 DEBUG: Expected to reconstruct: type=terminal_resize, sessionId=%s, machineId=%s, payload=%s, nonce=%s, timestamp=%s",
				secureData.SessionID, secureData.MachineID, string(secureData.Payload), secureData.Nonce, secureData.Timestamp)
			return
		}

		// Extract the actual resize data from payload
		payloadBytes, ok := payload.(json.RawMessage)
		if !ok {
			log.Printf("Failed to parse terminal_resize payload: unexpected type %T", payload)
			return
		}

		// The payload is a JSON string, so we need to unmarshal it twice:
		// First to get the string value, then to parse that string as JSON
		var payloadStr string
		if err := json.Unmarshal(payloadBytes, &payloadStr); err != nil {
			log.Printf("Failed to unmarshal terminal_resize payload string: %v", err)
			return
		}

		var resizeData TerminalResizeData
		if err := json.Unmarshal([]byte(payloadStr), &resizeData); err != nil {
			log.Printf("Failed to unmarshal terminal_resize payload: %v", err)
			return
		}

		// Use the sessionId from the secure envelope
		resizeData.SessionID = secureData.SessionID
		a.terminalResize(resizeData)

	case "trigger_scan":
		// Immediate security scan triggered by server
		log.Printf("Security scan triggered by server")
		// Don't reset auth log position - server handles deduplication
		// This prevents re-sending old events that are already tracked
		go a.runPackageScan()

	default:
		log.Printf("Unknown message type: %s", msg.Type)
	}
}

func (a *Agent) maybeRunPackageScan() {
	a.packageScanMu.Lock()
	defer a.packageScanMu.Unlock()

	if time.Since(a.lastPackageScan) < 30*time.Minute {
		return
	}
	a.lastPackageScan = time.Now()

	go a.runPackageScan()
}

func (a *Agent) runPackageScan() {
	a.scanProgressMu.Lock()
	a.scanStartedAt = time.Now()
	a.scanProgressMu.Unlock()

	a.sendScanProgress("inventory", 5, 0)

	pkgs, summary, err := platform.Current.CollectPackages()
	if err != nil {
		log.Printf("Package collection failed (continuing with security checks): %v", err)
		pkgs = []platform.PackageInfo{}
		summary = platform.PackageSummary{}
	}

	eta := func(completedSteps int) int64 {
		a.scanProgressMu.Lock()
		defer a.scanProgressMu.Unlock()
		if completedSteps == 0 {
			return 20
		}
		elapsed := time.Since(a.scanStartedAt)
		avg := elapsed / time.Duration(completedSteps)
		remaining := avg * time.Duration(4-completedSteps)
		if remaining < 2*time.Second {
			remaining = 2 * time.Second
		}
		return int64(remaining.Seconds())
	}

	a.sendScanProgress("inventory", 25, eta(1))

	// Collect security findings
	integrityFindings := a.checkFileIntegrity()
	a.sendScanProgress("integrity", 50, eta(2))

	configFindings := a.checkConfigDrift()
	a.sendScanProgress("config", 75, eta(3))

	authEvents := a.checkAuthLog()

	log.Printf("Security scan: %d packages, %d integrity findings, %d config findings, %d auth events",
		len(pkgs), len(integrityFindings), len(configFindings), len(authEvents))

	a.sendPackageScan(pkgs, summary, configFindings, integrityFindings, authEvents)
}

func (a *Agent) executeCommand(data ExecuteCommandData) {
	log.Printf("Executing command: %s (id: %s)", data.Command, data.CommandID)

	a.emitAudit(AuditEvent{
		Action:    "COMMAND_START",
		Message:   fmt.Sprintf("Command requested: %s", data.Command),
		Severity:  "info",
		Command:   data.Command,
		Timestamp: time.Now(),
	})

	// Cross-platform command translation
	// Translate common Linux commands to Windows equivalents and vice versa
	actualCommand := data.Command
	if runtime.GOOS == "windows" {
		cmdMapping := map[string]string{
			"reboot":            "shutdown /r /t 0",
			"shutdown -r now":   "shutdown /r /t 0",
			"shutdown -h now":   "shutdown /s /t 0",
			"shutdown now":      "shutdown /s /t 0",
			"poweroff":          "shutdown /s /t 0",
			"systemctl reboot":  "shutdown /r /t 0",
			"systemctl poweroff": "shutdown /s /t 0",
			"init 6":            "shutdown /r /t 0",
			"init 0":            "shutdown /s /t 0",
		}
		if mapped, ok := cmdMapping[strings.TrimSpace(actualCommand)]; ok {
			log.Printf("Translated Linux command '%s' -> Windows command '%s'", actualCommand, mapped)
			actualCommand = mapped
		}
	}

	// Check if this is a system command (reboot, shutdown, etc.)
	isSystemCommand := false
	lowerCmd := strings.ToLower(strings.TrimSpace(actualCommand))

	for _, dangerous := range platform.Current.DangerousCommands() {
		if lowerCmd == strings.ToLower(dangerous) || strings.Contains(lowerCmd, strings.ToLower(dangerous)) {
			isSystemCommand = true
			log.Printf("Detected system command, will execute in background")
			break
		}
	}

	sendOutput := func(output string, completed bool, exitCode int) {
		payload := CommandResponseMessage{
			Type:      "command_response",
			MachineID: a.machineId,
			CommandID: data.CommandID,
			Output:    output,
			ExitCode:  exitCode,
			Completed: completed,
		}
		if err := a.writeJSON(payload); err != nil {
			log.Printf("Failed to send command output: %v", err)
		}
	}

	// For system commands, send immediate response and kick off in background
	if isSystemCommand {
		outputMsg := fmt.Sprintf("System command initiated: %s\nThe system will reboot shortly.\n", actualCommand)

		sendOutput(outputMsg, false, 0)
		sendOutput("", true, -1)

		go func() {
			time.Sleep(1 * time.Second)
			shellArgs := platform.Current.ShellCommand()
			cmd := exec.Command(shellArgs[0], append(shellArgs[1:], actualCommand)...)
			cmd.Run()
		}()
		return
	}

	// Execute command via platform shell and capture output via pipes
	shellArgs := platform.Current.ShellCommand()
	cmd := exec.Command(shellArgs[0], append(shellArgs[1:], actualCommand)...)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		log.Printf("Failed to create stdout pipe: %v", err)
		sendOutput(fmt.Sprintf("Failed to start command: %v\n", err), true, 1)
		return
	}
	cmd.Stderr = cmd.Stdout // merge stderr into stdout

	if err := cmd.Start(); err != nil {
		log.Printf("Failed to start command: %v", err)
		sendOutput(fmt.Sprintf("Failed to start command: %v\n", err), true, 1)
		return
	}

	// Use a channel to signal when reading is done
	readerDone := make(chan struct{})

	// Stream output
	go func() {
		defer close(readerDone)
		buf := make([]byte, 8192)
		for {
			n, err := stdout.Read(buf)
			if n > 0 {
				sendOutput(string(buf[:n]), false, 0)
			}
			if err != nil {
				if err != io.EOF {
					if !strings.Contains(err.Error(), "input/output error") {
						log.Printf("Command read error: %v", err)
					}
				}
				return
			}
		}
	}()

	go func() {
		err := cmd.Wait()

		// Wait for the reader to finish sending all output
		<-readerDone

		// Small delay to ensure all output messages are processed before completion signal
		time.Sleep(100 * time.Millisecond)

		exitCode := 0
		if err != nil {
			if exitErr, ok := err.(*exec.ExitError); ok {
				exitCode = exitErr.ExitCode()
			} else {
				exitCode = 1
			}
		}

		exit := exitCode
		severity := "warn"
		if exitCode == 0 {
			severity = "info"
		}
		a.emitAudit(AuditEvent{
			Action:    "COMMAND_END",
			Message:   fmt.Sprintf("Command finished: %s", data.Command),
			Severity:  severity,
			Command:   data.Command,
			ExitCode:  &exit,
			Timestamp: time.Now(),
		})

		sendOutput("", true, exitCode)
	}()
}

// updateAgent handles agent self-update in a robust way
// It creates an external update script that runs independently of the agent process
// Security: Uses RSA-SHA256 signature verification and SHA-256 hash validation
func (a *Agent) updateAgent(data UpdateAgentData) {
	log.Printf("Agent update requested (commandId: %s)", data.CommandID)

	sendOutput := func(output string, completed bool, exitCode int) {
		payload := CommandResponseMessage{
			Type:      "command_response",
			MachineID: a.machineId,
			CommandID: data.CommandID,
			Output:    output,
			ExitCode:  exitCode,
			Completed: completed,
		}
		if err := a.writeJSON(payload); err != nil {
			log.Printf("Failed to send update output: %v", err)
		}
	}

	// Determine the server URL
	serverURL := data.ServerURL
	if serverURL == "" {
		sendOutput("Error: No server URL provided for update\n", true, 1)
		return
	}
	
	// Remove trailing slash
	serverURL = strings.TrimSuffix(serverURL, "/")
	
	// Determine binary filename based on OS and architecture
	var binaryName string
	switch runtime.GOOS {
	case "windows":
		switch runtime.GOARCH {
		case "amd64":
			binaryName = "maintainer-agent-windows-amd64.exe"
		case "arm64":
			binaryName = "maintainer-agent-windows-arm64.exe"
		default:
			sendOutput(fmt.Sprintf("Error: Unsupported Windows architecture: %s\n", runtime.GOARCH), true, 1)
			return
		}
	case "linux":
		switch runtime.GOARCH {
		case "amd64":
			binaryName = "maintainer-agent-linux-amd64"
		case "arm64":
			binaryName = "maintainer-agent-linux-arm64"
		default:
			sendOutput(fmt.Sprintf("Error: Unsupported Linux architecture: %s\n", runtime.GOARCH), true, 1)
			return
		}
	default:
		sendOutput(fmt.Sprintf("Error: Unsupported OS: %s\n", runtime.GOOS), true, 1)
		return
	}
	
	// Construct binary download URL
	binaryURL := serverURL + "/downloads/" + binaryName

	sendOutput(fmt.Sprintf("🔄 Starting agent update...\n"), false, 0)
	sendOutput(fmt.Sprintf("Platform: %s/%s\n", runtime.GOOS, runtime.GOARCH), false, 0)
	sendOutput(fmt.Sprintf("Binary URL: %s\n", binaryURL), false, 0)

	// Get current agent binary path
	currentBinary, err := os.Executable()
	if err != nil {
		sendOutput(fmt.Sprintf("Error: Could not determine current binary path: %v\n", err), true, 1)
		return
	}
	sendOutput(fmt.Sprintf("Current binary: %s\n", currentBinary), false, 0)
	
	// Create the update script using the platform-specific generator
	updateScript := platform.Current.GenerateUpdateScript(binaryURL, currentBinary)

	// Write the update script to a temporary file
	var scriptPath string
	if runtime.GOOS == "windows" {
		scriptPath = filepath.Join(os.TempDir(), "maintainer-agent-update.ps1")
	} else {
		scriptPath = "/tmp/maintainer-agent-update.sh"
	}
	err = os.WriteFile(scriptPath, []byte(updateScript), 0755)
	if err != nil {
		sendOutput(fmt.Sprintf("Error: Could not create update script: %v\n", err), true, 1)
		return
	}

	sendOutput(fmt.Sprintf("Update script created at %s\n", scriptPath), false, 0)
	sendOutput("Launching update process (this agent will stop)...\n", false, 0)

	// Launch the update script in a detached process via platform-specific method
	// NOTE: Do NOT send completed=true here! The update has not finished yet.
	// The UI should wait for the agent to reconnect (machine_status_changed → online).
	cmd := platform.Current.BackgroundExecCommand(scriptPath)

	err = cmd.Start()
	if err != nil {
		sendOutput(fmt.Sprintf("Error: Failed to start update process: %v\n", err), true, 1)
		return
	}

	log.Printf("Update script launched with PID: %d", cmd.Process.Pid)

	// Now send the last status message — NOT completed, just informational.
	// The UI will mark it complete when the agent reconnects.
	sendOutput("Update gestartet. Agent wird sich nach dem Update automatisch neu verbinden...\n", false, 0)

	go func() {
		time.Sleep(1 * time.Second)
		log.Println("Agent shutting down for update...")
		if a.conn != nil {
			a.conn.Close()
		}
		// Signal graceful shutdown instead of os.Exit — lets the Windows
		// Service handler perform proper SCM shutdown.
		select {
		case <-a.shutdownCh:
			// Already closed
		default:
			close(a.shutdownCh)
		}
	}()
}

func (a *Agent) spawnShell(data SpawnShellData) {
	log.Printf("Spawning shell for session: %s", data.SessionID)

	// Use platform-specific terminal spawning (PTY on Linux, ConPTY/pipes on Windows)
	term, err := platform.Current.SpawnTerminal()
	if err != nil {
		log.Printf("Failed to spawn terminal: %v", err)
		return
	}

	a.terminals[data.SessionID] = term

	// Read output and send to server
	go func() {
		defer func() {
			delete(a.terminals, data.SessionID)
			term.Close()
		}()

		buf := make([]byte, 8192)
		for {
			n, err := term.Read(buf)
			if err != nil {
				if err != io.EOF {
					log.Printf("Terminal read error for session %s: %v", data.SessionID, err)
				}
				return
			}

			if n > 0 {
				log.Printf("Terminal output (%d bytes) for session %s: %q", n, data.SessionID, string(buf[:n]))

				msg := TerminalOutputMessage{
					Type:      "terminal_output",
					SessionID: data.SessionID,
					Output:    string(buf[:n]),
				}

				if err = a.writeJSON(msg); err != nil {
					log.Printf("Failed to send terminal output for session %s: %v", data.SessionID, err)
					return
				}
			}
		}
	}()
}

func (a *Agent) terminalStdin(data TerminalStdinData) {
	log.Printf("Terminal stdin for session %s: %q", data.SessionID, data.Data)

	term, ok := a.terminals[data.SessionID]
	if !ok {
		log.Printf("Terminal session not found: %s (available: %v)", data.SessionID, a.getTerminalSessions())
		return
	}

	n, err := term.Write([]byte(data.Data))
	if err != nil {
		log.Printf("Failed to write to terminal: %v", err)
	} else {
		log.Printf("Wrote %d bytes to terminal", n)
	}
}

func (a *Agent) getTerminalSessions() []string {
	sessions := make([]string, 0, len(a.terminals))
	for sid := range a.terminals {
		sessions = append(sessions, sid)
	}
	return sessions
}

func (a *Agent) terminalResize(data TerminalResizeData) {
	term, ok := a.terminals[data.SessionID]
	if !ok {
		return
	}
	term.Resize(data.Cols, data.Rows)
}

func collectMetrics() Metrics {
	metrics := Metrics{}

	// CPU
	if cpuPercent, err := cpu.Percent(time.Second, false); err == nil && len(cpuPercent) > 0 {
		metrics.CPUUsage = cpuPercent[0]
	}

	// Memory
	if vmStat, err := mem.VirtualMemory(); err == nil {
		metrics.RAMUsage = vmStat.UsedPercent
		metrics.RAMTotal = float64(vmStat.Total) / 1024 / 1024 / 1024 // GB
		metrics.RAMUsed = float64(vmStat.Used) / 1024 / 1024 / 1024   // GB
	}

	// Disk - enumerate all partitions
	metrics.Disks = collectDiskMetrics()
	
	// Aggregate disk stats for backward compatibility
	var totalDiskTotal, totalDiskUsed float64
	for _, d := range metrics.Disks {
		totalDiskTotal += d.Total
		totalDiskUsed += d.Used
	}
	if totalDiskTotal > 0 {
		metrics.DiskTotal = totalDiskTotal
		metrics.DiskUsed = totalDiskUsed
		metrics.DiskUsage = (totalDiskUsed / totalDiskTotal) * 100
	}

	// Uptime
	if uptime, err := host.Uptime(); err == nil {
		metrics.Uptime = uptime
	}

	return metrics
}

// collectDiskMetrics enumerates all mounted partitions and returns per-disk metrics
func collectDiskMetrics() []DiskInfo {
	var disks []DiskInfo
	
	partitions, err := disk.Partitions(false) // false = exclude virtual/pseudo filesystems
	if err != nil {
		log.Printf("Failed to get disk partitions: %v", err)
		return disks
	}
	
	for _, partition := range partitions {
		// Skip invalid mount points and pseudo filesystems
		if partition.Mountpoint == "" {
			continue
		}
		
		// Get usage stats for this partition
		usageStat, err := disk.Usage(partition.Mountpoint)
		if err != nil {
			continue // Skip partitions we can't read
		}
		
		// Skip very small partitions (< 100MB) - likely boot/recovery partitions
		if usageStat.Total < 100*1024*1024 {
			continue
		}
		
		disks = append(disks, DiskInfo{
			Path:  partition.Mountpoint,
			Usage: usageStat.UsedPercent,
			Total: float64(usageStat.Total) / 1024 / 1024 / 1024,
			Used:  float64(usageStat.Used) / 1024 / 1024 / 1024,
		})
	}
	
	return disks
}

// ==================== SECURITY MONITORING ====================

// computeFileHash computes SHA256 hash of a file
func computeFileHash(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return fmt.Sprintf("%x", h.Sum(nil)), nil
}

// collectIntegrityPaths walks the filesystem to monitor all files (excluding volatile/system pseudo file systems)
func collectIntegrityPaths() []string {
	var paths []string
	seen := make(map[string]bool)

	integrityRoots := platform.Current.IntegrityRoots()
	integritySkipDirs := platform.Current.IntegritySkipDirs()
	criticalFiles := platform.Current.CriticalFiles()

	for _, root := range integrityRoots {
		filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return nil
			}

			// Skip known virtual/ephemeral directories
			if d.IsDir() {
				if integritySkipDirs[path] {
					return filepath.SkipDir
				}
				return nil
			}

			// Skip symlinks to avoid loops
			if d.Type()&os.ModeSymlink != 0 {
				return nil
			}

			// Only include regular files
			info, err := d.Info()
			if err != nil || !info.Mode().IsRegular() {
				return nil
			}

			if !seen[path] {
				seen[path] = true
				paths = append(paths, path)
			}
			return nil
		})
	}

	// Always include the critical set to ensure they are monitored even if permissions block traversal
	for _, p := range criticalFiles {
		if !seen[p] {
			paths = append(paths, p)
		}
	}

	return paths
}

// checkFileIntegrity monitors critical system files for changes
func (a *Agent) checkFileIntegrity() []SecurityFinding {
	var findings []SecurityFinding

	a.fileHashesMu.Lock()
	defer a.fileHashesMu.Unlock()

	paths := collectIntegrityPaths()

	for _, path := range paths {
		currentHash, err := computeFileHash(path)
		if err != nil {
			// File doesn't exist or not readable - skip
			continue
		}
		if previousHash, exists := a.fileHashes[path]; exists {
			if previousHash != currentHash {
				findings = append(findings, SecurityFinding{
					TargetPath: path,
					Message:    fmt.Sprintf("File modified: %s", path),
					Severity:   "high",
					Expected:   previousHash[:16] + "...",
					Actual:     currentHash[:16] + "...",
					Hash:       currentHash,
				})
				log.Printf("🔴 INTEGRITY ALERT: %s has been modified!", path)
			}
		}
		// Update stored hash
		a.fileHashes[path] = currentHash
	}

	// Detect deletions
	for storedPath := range a.fileHashes {
		if _, err := os.Stat(storedPath); err != nil && os.IsNotExist(err) {
			findings = append(findings, SecurityFinding{
				TargetPath: storedPath,
				Message:    fmt.Sprintf("File removed: %s", storedPath),
				Severity:   "high",
			})
			delete(a.fileHashes, storedPath)
		}
	}

	return findings
}

// checkConfigDrift checks for configuration drift from expected values
func (a *Agent) checkConfigDrift() []SecurityFinding {
	var findings []SecurityFinding

	for filePath, expectedValues := range platform.Current.ConfigExpectations() {
		content, err := os.ReadFile(filePath)
		if err != nil {
			continue
		}

		lines := strings.Split(string(content), "\n")
		actualValues := make(map[string]string)

		for _, line := range lines {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}

			parts := strings.Fields(line)
			if len(parts) >= 2 {
				actualValues[parts[0]] = parts[1]
			}
		}

		for key, expected := range expectedValues {
			actual, exists := actualValues[key]
			if !exists {
				// Setting not found - might be using default
				continue
			}

			if !strings.EqualFold(actual, expected) {
				severity := "medium"
				if key == "PermitRootLogin" && strings.EqualFold(actual, "yes") {
					severity = "critical"
				}

				findings = append(findings, SecurityFinding{
					TargetPath: filePath,
					Message:    fmt.Sprintf("Config drift detected: %s = %s (expected: %s)", key, actual, expected),
					Severity:   severity,
					Expected:   expected,
					Actual:     actual,
				})
				log.Printf("🟡 CONFIG DRIFT: %s in %s (actual: %s, expected: %s)", key, filePath, actual, expected)
			}
		}
	}

	return findings
}

// checkAuthLog monitors authentication logs for security events (used by package scan)
// This uses the cumulative failed login counts to generate events
func (a *Agent) checkAuthLog() []SecurityEvent {
	var events []SecurityEvent

	// Use cumulative counts from the security monitoring
	a.failedLoginsMu.Lock()
	for ip, totalCount := range a.failedLoginCounts {
		if totalCount >= 3 {
			severity := "medium"
			if totalCount >= 10 {
				severity = "high"
			}
			if totalCount >= 50 {
				severity = "critical"
			}

			fingerprint := fmt.Sprintf("failed_auth:%s", ip)
			events = append(events, SecurityEvent{
				Type:        "failed_auth",
				Severity:    severity,
				Message:     fmt.Sprintf("Multiple failed login attempts detected: %d attempts from %s", totalCount, ip),
				Fingerprint: fingerprint,
				Data: map[string]string{
					"source_ip":     ip,
					"attempt_count": fmt.Sprintf("%d", totalCount),
					"fingerprint":   fingerprint,
				},
			})
		}
	}
	a.failedLoginsMu.Unlock()

	return events
}

