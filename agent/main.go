package main

import (
	"bufio"
	"bytes"
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
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"
	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/disk"
	"github.com/shirou/gopsutil/v3/host"
	"github.com/shirou/gopsutil/v3/mem"
)

var (
	serverURL = flag.String("server", "ws://localhost:3000/ws/agent", "Maintainer server WebSocket URL")
	secretKey = flag.String("key", "", "Secret key for authentication")
	configFile = flag.String("config", "/etc/maintainer-agent/config.json", "Path to config file")
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

type OSInfo struct {
	Distro  string `json:"distro"`
	Release string `json:"release"`
	Kernel  string `json:"kernel"`
}



type Metrics struct {
	CPUUsage  float64 `json:"cpuUsage"`
	RAMUsage  float64 `json:"ramUsage"`
	RAMTotal  float64 `json:"ramTotal"`
	RAMUsed   float64 `json:"ramUsed"`
	DiskUsage float64 `json:"diskUsage"`
	DiskTotal float64 `json:"diskTotal"`
	DiskUsed  float64 `json:"diskUsed"`
	Uptime    uint64  `json:"uptime"`
}

type Port struct {
	Port    int    `json:"port"`
	Proto   string `json:"proto"`
	Service string `json:"service"`
	State   string `json:"state"`
}

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

type PackageInfo struct {
	Name    string   `json:"name"`
	Version string   `json:"version"`
	Manager string   `json:"manager,omitempty"`
	Status  string   `json:"status,omitempty"`
	CveIds  []string `json:"cveIds,omitempty"`
}

type ScanSummary struct {
	Total           int `json:"total"`
	Updates         int `json:"updates"`
	SecurityUpdates int `json:"securityUpdates"`
}

// SecurityFinding represents a config drift or integrity issue
type SecurityFinding struct {
	TargetPath string `json:"targetPath"`
	Message    string `json:"message"`
	Severity   string `json:"severity"`
	Expected   string `json:"expected,omitempty"`
	Actual     string `json:"actual,omitempty"`
	Hash       string `json:"hash,omitempty"`
}

// SecurityEvent represents a general security event
type SecurityEvent struct {
	Type        string            `json:"type"`
	Severity    string            `json:"severity"`
	Message     string            `json:"message"`
	Data        map[string]string `json:"data,omitempty"`
	Fingerprint string            `json:"fingerprint,omitempty"` // Unique identifier for deduplication
}

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
	terminals map[string]*os.File
	writeMu   sync.Mutex
	httpMu    sync.Mutex
	httpClient *http.Client
	machineId string

	packageScanMu   sync.Mutex
	lastPackageScan time.Time

	scanProgressMu sync.Mutex
	scanStartedAt  time.Time
	
	// Security monitoring state
	fileHashes         map[string]string // Stores hashes for integrity monitoring
	fileHashesMu       sync.Mutex
	lastAuthLogPos     int64             // Last read position in auth.log
	
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

// checkAuthLogIncremental reads new entries from auth log and returns events with fingerprints
func (a *Agent) checkAuthLogIncremental() []SecurityEvent {
	var events []SecurityEvent

	// Try common auth log locations
	authLogPaths := []string{
		"/var/log/auth.log",      // Debian/Ubuntu
		"/var/log/secure",        // RHEL/CentOS
		"/var/log/messages",      // Fallback
	}

	var authLogPath string
	for _, path := range authLogPaths {
		if _, err := os.Stat(path); err == nil {
			authLogPath = path
			break
		}
	}

	if authLogPath == "" {
		return events
	}

	file, err := os.Open(authLogPath)
	if err != nil {
		return events
	}
	defer file.Close()

	// Get file info to check for log rotation
	info, err := file.Stat()
	if err != nil {
		return events
	}

	// If file is smaller than last position, log was rotated - reset
	if info.Size() < a.lastAuthLogPos {
		log.Printf("Auth log rotated, resetting position")
		a.lastAuthLogPos = 0
	}

	// Seek to last position
	if a.lastAuthLogPos > 0 {
		file.Seek(a.lastAuthLogPos, 0)
	} else {
		// First run - read last 50KB to catch recent events
		if info.Size() > 51200 {
			file.Seek(-51200, 2)
		}
		// else start from beginning
		log.Printf("First security scan - reading recent auth log entries")
	}

	scanner := bufio.NewScanner(file)
	
	// Track new failed logins in this scan
	newFailedLogins := make(map[string]int)
	newRootLogins := 0

	for scanner.Scan() {
		line := scanner.Text()
		lineLower := strings.ToLower(line)

		// Check for failed login attempts
		if strings.Contains(lineLower, "failed password") || 
		   strings.Contains(lineLower, "authentication failure") ||
		   strings.Contains(lineLower, "invalid user") {
			ipMatch := extractIP(line)
			if ipMatch == "" {
				ipMatch = "unknown"
			}
			newFailedLogins[ipMatch]++
		}

		// Check for root login
		if strings.Contains(lineLower, "accepted") && strings.Contains(lineLower, "root") {
			newRootLogins++
		}
	}

	// Update position for next read
	pos, _ := file.Seek(0, 1)
	a.lastAuthLogPos = pos

	// Update cumulative counts and generate events
	a.failedLoginsMu.Lock()
	for ip, newCount := range newFailedLogins {
		// Add to cumulative count
		a.failedLoginCounts[ip] += newCount
		totalCount := a.failedLoginCounts[ip]

		// Only generate event if threshold crossed
		if totalCount >= 3 {
			severity := "medium"
			if totalCount >= 10 {
				severity = "high"
			}
			if totalCount >= 50 {
				severity = "critical"
			}

			// Fingerprint based on IP - same IP = same event (will be updated)
			fingerprint := fmt.Sprintf("failed_auth:%s", ip)

			events = append(events, SecurityEvent{
				Type:        "failed_auth",
				Severity:    severity,
				Message:     fmt.Sprintf("Multiple failed login attempts detected: %d attempts from %s", totalCount, ip),
				Fingerprint: fingerprint,
				Data: map[string]string{
					"source_ip":     ip,
					"attempt_count": fmt.Sprintf("%d", totalCount),
				},
			})
			log.Printf("🔴 AUTH ALERT: %d total failed login attempts from %s (+%d new)", totalCount, ip, newCount)
		}
	}
	a.failedLoginsMu.Unlock()

	// Root logins - each one is a separate event
	if newRootLogins > 0 {
		fingerprint := fmt.Sprintf("root_login:%d", time.Now().Unix()/300) // 5-minute buckets
		events = append(events, SecurityEvent{
			Type:        "root_login",
			Severity:    "medium",
			Message:     fmt.Sprintf("Root login detected: %d login(s)", newRootLogins),
			Fingerprint: fingerprint,
			Data: map[string]string{
				"login_count": fmt.Sprintf("%d", newRootLogins),
			},
		})
		log.Printf("🟡 AUTH ALERT: %d root logins detected", newRootLogins)
	}

	return events
}

func main() {
	flag.Parse()

	config := loadConfig()

	agent := &Agent{
		config:            config,
		terminals:         make(map[string]*os.File),
		httpClient:        &http.Client{Timeout: 10 * time.Second},
		fileHashes:        make(map[string]string),
		reportedEvents:    make(map[string]time.Time),
		failedLoginCounts: make(map[string]int),
	}

	// Handle graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		<-sigChan
		log.Println("Shutting down gracefully...")
		if agent.conn != nil {
			agent.conn.Close()
		}
		os.Exit(0)
	}()

	// Connect and run
	for {
		err := agent.connect()
		if err != nil {
			log.Printf("Connection error: %v. Retrying in 5 seconds...", err)
			time.Sleep(5 * time.Second)
			continue
		}

		err = agent.run()
		if err != nil {
			log.Printf("Runtime error: %v. Reconnecting in 5 seconds...", err)
		}

		time.Sleep(5 * time.Second)
	}
}

func loadConfig() Config {
	config := Config{}

	// Try loading from config file
	if data, err := os.ReadFile(*configFile); err == nil {
		json.Unmarshal(data, &config)
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
		log.Fatal("Secret key is required. Use -key flag or set in config file.")
	}

	// AUTO-MIGRATION: Normalize secret key to 64 hex chars
	config.SecretKey = normalizeSecretKey(config.SecretKey)

	// Save normalized config back to file if it was loaded from file
	if _, err := os.Stat(*configFile); err == nil {
		saveConfig(config)
	}

	return config
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

	conn, _, err := websocket.DefaultDialer.Dial(a.config.ServerURL, nil)
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
	ip := getOutboundIP()
	osInfo := getOSInfo()

	msg := RegisterMessage{
		Type:      "register",
		Hostname:  hostname,
		IP:        ip,
		OSInfo:    osInfo,
		SecretKey: a.config.SecretKey,
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
	ports := collectPorts()

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

	pkgs, summary, err := collectPackages()
	if err != nil {
		log.Printf("Package scan skipped: %v", err)
		return
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

	// Check if this is a system command (reboot, shutdown, etc.)
	isSystemCommand := false
	lowerCmd := strings.ToLower(strings.TrimSpace(data.Command))

	if lowerCmd == "reboot" || lowerCmd == "shutdown" ||
		strings.Contains(lowerCmd, "systemctl reboot") ||
		strings.Contains(lowerCmd, "systemctl poweroff") ||
		strings.Contains(lowerCmd, "shutdown -r") ||
		strings.Contains(lowerCmd, "shutdown -h") {
		isSystemCommand = true
		log.Printf("Detected system command, will execute in background")
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
		outputMsg := "System command initiated. The system will reboot shortly.\n"

		sendOutput(outputMsg, false, 0)
		sendOutput("", true, -1)

		go func() {
			time.Sleep(1 * time.Second)
			cmd := exec.Command("sh", "-c", data.Command)
			cmd.Run()
		}()
		return
	}

	cmd := exec.Command("/bin/bash", "-c", data.Command)
	ptmx, err := pty.Start(cmd)
	if err != nil {
		log.Printf("Failed to start command PTY: %v", err)
		sendOutput(fmt.Sprintf("Failed to start command: %v\n", err), true, 1)
		return
	}

	// Use a channel to signal when PTY reading is done
	readerDone := make(chan struct{})

	// Stream output
	go func() {
		defer close(readerDone)
		buf := make([]byte, 8192)
		for {
			n, err := ptmx.Read(buf)
			if n > 0 {
				sendOutput(string(buf[:n]), false, 0)
			}
			if err != nil {
				// EOF is expected when PTY closes; other errors log but are non-fatal
				if err != io.EOF {
					// Suppress "input/output error" after PTY is closed
					if !strings.Contains(err.Error(), "input/output error") {
						log.Printf("Command PTY read error: %v", err)
					}
				}
				ptmx.Close()
				return
			}
		}
	}()

	go func() {
		err := cmd.Wait()

		// Wait for the PTY reader to finish sending all output
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

	// Determine the source URL (API endpoint for agent source code)
	serverURL := data.ServerURL
	if serverURL == "" {
		sendOutput("Error: No server URL provided for update\n", true, 1)
		return
	}
	
	// Remove trailing slash and construct source API URL
	serverURL = strings.TrimSuffix(serverURL, "/")
	sourceURL := serverURL + "/api/agent-source"

	sendOutput(fmt.Sprintf("🔄 Starting secure agent update (build from source)...\nSource URL: %s\n", sourceURL), false, 0)
	sendOutput("🔐 Update includes cryptographic signature verification\n", false, 0)

	// Get current agent binary path
	currentBinary, err := os.Executable()
	if err != nil {
		sendOutput(fmt.Sprintf("Error: Could not determine current binary path: %v\n", err), true, 1)
		return
	}
	sendOutput(fmt.Sprintf("Current binary: %s\n", currentBinary), false, 0)

	// Create the update script with signature verification
	// This script will:
	// 1. Download the signed source code from the server
	// 2. Verify the RSA-SHA256 signature
	// 3. Verify SHA-256 hashes of all files
	// 4. Only proceed with build if verification passes
	// 5. Build and install the new binary
	
	updateScript := fmt.Sprintf(`#!/bin/bash
# Maintainer Agent Self-Update Script (Secure Build from Source)
# This script runs independently of the agent process
# Security: RSA-SHA256 signature verification + SHA-256 hash validation

SOURCE_URL="%s"
CURRENT_BINARY="%s"
LOG_FILE="/tmp/maintainer-agent-update.log"
BUILD_DIR="/tmp/maintainer-agent-build"
NEW_BINARY="/tmp/maintainer-agent-new"
RESPONSE_FILE="/tmp/maintainer-agent-response.json"

log() {
    echo "[$(date '+%%Y-%%m-%%d %%H:%%M:%%S')] $1" >> "$LOG_FILE"
    echo "$1"
}

cleanup_build() {
    rm -rf "$BUILD_DIR"
    rm -f "$NEW_BINARY"
    rm -f "$RESPONSE_FILE"
    rm -f /tmp/maintainer-verify.py
}

log "========================================"
log "Maintainer Agent Secure Update Started"
log "========================================"
log "Source URL: $SOURCE_URL"
log "Current binary: $CURRENT_BINARY"

# Wait for the agent to send its completion message and disconnect
log "Waiting 3 seconds for agent to complete..."
sleep 3

# Stop the service gracefully
log "Stopping maintainer-agent service..."
if systemctl is-active --quiet maintainer-agent; then
    systemctl stop maintainer-agent
    sleep 2
fi

# Make sure the old process is gone
log "Ensuring old agent process is terminated..."
pkill -9 -f "maintainer-agent" 2>/dev/null || true
sleep 1

# Check if Go is installed
if ! command -v go &> /dev/null; then
    log "ERROR: Go is not installed! Cannot build from source."
    log "Please install Go first: https://golang.org/doc/install"
    systemctl start maintainer-agent
    exit 1
fi

GO_VERSION=$(go version)
log "Go version: $GO_VERSION"

# Check for Python (required for signature verification)
PYTHON_CMD=""
if command -v python3 &> /dev/null; then
    PYTHON_CMD="python3"
elif command -v python &> /dev/null; then
    PYTHON_CMD="python"
else
    log "ERROR: Python is required for signature verification!"
    log "Please install Python: apt-get install python3"
    systemctl start maintainer-agent
    exit 1
fi

log "Using Python: $PYTHON_CMD"

# Create build directory
log "Creating build directory..."
cleanup_build
mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

# Download source code
log "Downloading signed source code from: $SOURCE_URL"

if command -v curl &> /dev/null; then
    curl -fsSL "$SOURCE_URL" > "$RESPONSE_FILE" 2>/dev/null
elif command -v wget &> /dev/null; then
    wget -q -O "$RESPONSE_FILE" "$SOURCE_URL" 2>/dev/null
else
    log "ERROR: Neither curl nor wget available!"
    cleanup_build
    systemctl start maintainer-agent
    exit 1
fi

if [ ! -s "$RESPONSE_FILE" ]; then
    log "ERROR: Failed to download source code!"
    cleanup_build
    systemctl start maintainer-agent
    exit 1
fi

# Check for error in response
if grep -q '"error"' "$RESPONSE_FILE"; then
    log "ERROR: Server returned error:"
    cat "$RESPONSE_FILE"
    cleanup_build
    systemctl start maintainer-agent
    exit 1
fi

# Create Python verification script
log "🔐 Verifying cryptographic signature..."
cat > /tmp/maintainer-verify.py << 'VERIFY_SCRIPT'
#!/usr/bin/env python3
"""
Agent Update Signature Verification
Verifies RSA-SHA256 signature and SHA-256 hashes
"""
import json
import hashlib
import sys
import os

# Try to import cryptography library
try:
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding
    from cryptography.hazmat.backends import default_backend
    import base64
    HAS_CRYPTO = True
except ImportError:
    HAS_CRYPTO = False

def verify_hash(content, expected_hash):
    """Verify SHA-256 hash of content"""
    actual_hash = hashlib.sha256(content.encode('utf-8')).hexdigest()
    return actual_hash == expected_hash

def verify_signature_crypto(data_to_verify, signature_b64, public_key_pem):
    """Verify RSA-SHA256 signature using cryptography library"""
    try:
        public_key = serialization.load_pem_public_key(
            public_key_pem.encode('utf-8'),
            backend=default_backend()
        )
        signature = base64.b64decode(signature_b64)
        public_key.verify(
            signature,
            data_to_verify.encode('utf-8'),
            padding.PKCS1v15(),
            hashes.SHA256()
        )
        return True
    except Exception as e:
        print(f"Signature verification failed: {e}", file=sys.stderr)
        return False

def verify_signature_openssl(data_to_verify, signature_b64, public_key_pem):
    """Fallback: Verify signature using openssl command"""
    import subprocess
    import tempfile
    
    try:
        # Write public key to temp file
        with tempfile.NamedTemporaryFile(mode='w', suffix='.pem', delete=False) as f:
            f.write(public_key_pem)
            pubkey_file = f.name
        
        # Write signature to temp file
        import base64
        sig_bytes = base64.b64decode(signature_b64)
        with tempfile.NamedTemporaryFile(mode='wb', suffix='.sig', delete=False) as f:
            f.write(sig_bytes)
            sig_file = f.name
        
        # Write data to temp file
        with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as f:
            f.write(data_to_verify)
            data_file = f.name
        
        # Verify with openssl
        result = subprocess.run([
            'openssl', 'dgst', '-sha256', '-verify', pubkey_file,
            '-signature', sig_file, data_file
        ], capture_output=True, text=True)
        
        # Cleanup temp files
        os.unlink(pubkey_file)
        os.unlink(sig_file)
        os.unlink(data_file)
        
        return result.returncode == 0
    except Exception as e:
        print(f"OpenSSL verification failed: {e}", file=sys.stderr)
        return False

def main():
    if len(sys.argv) != 2:
        print("Usage: verify.py <response.json>", file=sys.stderr)
        sys.exit(1)
    
    response_file = sys.argv[1]
    
    try:
        with open(response_file, 'r') as f:
            data = json.load(f)
    except Exception as e:
        print(f"Failed to read response file: {e}", file=sys.stderr)
        sys.exit(1)
    
    # Check required fields
    required = ['files', 'hashes', 'signature', 'publicKey']
    for field in required:
        if field not in data:
            print(f"Missing required field: {field}", file=sys.stderr)
            sys.exit(1)
    
    files = data['files']
    hashes = data['hashes']
    signature = data['signature']
    public_key = data['publicKey']
    
    print("🔍 Verifying file hashes...")
    
    # Verify hashes for each file
    for filename, content in files.items():
        if filename not in hashes:
            print(f"  ❌ No hash provided for {filename}", file=sys.stderr)
            sys.exit(1)
        
        if not verify_hash(content, hashes[filename]):
            print(f"  ❌ Hash mismatch for {filename}", file=sys.stderr)
            sys.exit(1)
        
        print(f"  ✅ {filename} hash verified")
    
    print("🔐 Verifying cryptographic signature...")
    
    # Reconstruct signable data
    signable_items = sorted(hashes.items(), key=lambda x: x[0])
    signable_data = '\n'.join(f"{name}:{hash_val}" for name, hash_val in signable_items)
    
    # Try cryptography library first, fallback to openssl
    if HAS_CRYPTO:
        verified = verify_signature_crypto(signable_data, signature, public_key)
    else:
        print("  ℹ️  Using OpenSSL for signature verification")
        verified = verify_signature_openssl(signable_data, signature, public_key)
    
    if not verified:
        print("  ❌ SIGNATURE VERIFICATION FAILED!", file=sys.stderr)
        print("  ⚠️  The source code may have been tampered with!", file=sys.stderr)
        sys.exit(1)
    
    print("  ✅ Signature verified successfully")
    
    # Extract files to current directory
    print("📦 Extracting verified source files...")
    for filename, content in files.items():
        with open(filename, 'w') as f:
            f.write(content)
        print(f"  ✅ Extracted {filename}")
    
    print("✅ All security checks passed!")
    sys.exit(0)

if __name__ == '__main__':
    main()
VERIFY_SCRIPT

# Run verification
chmod +x /tmp/maintainer-verify.py
cd "$BUILD_DIR"
if ! $PYTHON_CMD /tmp/maintainer-verify.py "$RESPONSE_FILE"; then
    log "❌ SECURITY VERIFICATION FAILED!"
    log "The update was rejected due to signature/hash verification failure."
    log "This could indicate:"
    log "  - Man-in-the-middle attack"
    log "  - Corrupted download"
    log "  - Server configuration issue"
    cleanup_build
    systemctl start maintainer-agent
    exit 1
fi

log "✅ Security verification passed!"

# Verify files were created by the verification script
if [ ! -f "main.go" ] || [ ! -f "go.mod" ]; then
    log "ERROR: Source files not extracted!"
    ls -la
    cleanup_build
    systemctl start maintainer-agent
    exit 1
fi

log "Source files verified and extracted:"
ls -la

# Build the binary
log "Building new agent binary..."
go mod tidy 2>&1 | tee -a "$LOG_FILE"
go build -o "$NEW_BINARY" -ldflags="-s -w" . 2>&1 | tee -a "$LOG_FILE"

if [ ! -f "$NEW_BINARY" ]; then
    log "ERROR: Build failed!"
    cleanup_build
    systemctl start maintainer-agent
    exit 1
fi

# Check if it's a valid binary
if ! file "$NEW_BINARY" | grep -q "executable"; then
    log "ERROR: Built file is not a valid executable!"
    log "File type: $(file "$NEW_BINARY")"
    cleanup_build
    systemctl start maintainer-agent
    exit 1
fi

log "Build successful!"
ls -lh "$NEW_BINARY"

# Backup old binary
log "Backing up current binary..."
cp "$CURRENT_BINARY" "${CURRENT_BINARY}.backup" 2>/dev/null || true

# Replace binary
log "Installing new binary..."
chmod +x "$NEW_BINARY"
mv "$NEW_BINARY" "$CURRENT_BINARY"
chmod +x "$CURRENT_BINARY"

# Verify installation
if [ ! -x "$CURRENT_BINARY" ]; then
    log "ERROR: Failed to install new binary, restoring backup..."
    mv "${CURRENT_BINARY}.backup" "$CURRENT_BINARY" 2>/dev/null || true
    cleanup_build
    systemctl start maintainer-agent
    exit 1
fi

# Start the service
log "Starting maintainer-agent service..."
systemctl start maintainer-agent

# Wait and verify
sleep 3
if systemctl is-active --quiet maintainer-agent; then
    log "✅ Update successful! Agent is running."
    # Clean up backup after successful update
    rm -f "${CURRENT_BINARY}.backup"
else
    log "❌ Service failed to start! Check logs with: journalctl -u maintainer-agent -n 50"
    # Try to restore backup
    if [ -f "${CURRENT_BINARY}.backup" ]; then
        log "Restoring backup..."
        mv "${CURRENT_BINARY}.backup" "$CURRENT_BINARY"
        systemctl start maintainer-agent
    fi
    cleanup_build
    exit 1
fi

# Cleanup
log "Cleaning up build directory..."
cleanup_build
rm -f "$0"
log "Update complete!"
`, sourceURL, currentBinary)

	// Write the update script to a temporary file
	scriptPath := "/tmp/maintainer-agent-update.sh"
	err = os.WriteFile(scriptPath, []byte(updateScript), 0755)
	if err != nil {
		sendOutput(fmt.Sprintf("Error: Could not create update script: %v\n", err), true, 1)
		return
	}

	sendOutput("📝 Update script created at /tmp/maintainer-agent-update.sh\n", false, 0)
	sendOutput("🚀 Launching update process (this agent will stop)...\n", false, 0)
	sendOutput("📋 Update log will be at /tmp/maintainer-agent-update.log\n", false, 0)

	// Send completion before starting the update
	sendOutput("✅ Update initiated successfully. Agent will reconnect shortly.\n", true, 0)

	// Give time for the completion message to be sent
	time.Sleep(500 * time.Millisecond)

	// Launch the update script with nohup so it continues after this process dies
	// Use setsid to create a new session, completely detaching from this process
	cmd := exec.Command("setsid", "nohup", "/bin/bash", scriptPath)
	cmd.Stdout = nil
	cmd.Stderr = nil
	cmd.Stdin = nil
	
	// Start the process in background
	err = cmd.Start()
	if err != nil {
		log.Printf("Failed to start update script: %v", err)
		return
	}

	// Don't wait for the process - let it run independently
	// The script will stop this agent via systemctl
	log.Printf("Update script launched with PID: %d", cmd.Process.Pid)

	// Gracefully close the connection and exit
	// The update script will handle stopping/starting the service
	go func() {
		time.Sleep(1 * time.Second)
		log.Println("Agent shutting down for update...")
		if a.conn != nil {
			a.conn.Close()
		}
		os.Exit(0)
	}()
}

func (a *Agent) spawnShell(data SpawnShellData) {
	log.Printf("Spawning shell for session: %s", data.SessionID)

	// Use bash without readline to avoid bracketed paste mode issues
	cmd := exec.Command("/bin/bash", "--noediting")
	
	// Set environment variables for proper terminal behavior
	cmd.Env = append(os.Environ(), 
		"TERM=xterm-256color",
		"BASH_SILENCE_DEPRECATION_WARNING=1",
	)

	// Start with PTY
	ptmx, err := pty.Start(cmd)
	if err != nil {
		log.Printf("Failed to start PTY: %v", err)
		return
	}

	// Set PTY size
	ws := &pty.Winsize{
		Rows: 24,
		Cols: 80,
	}
	if err := pty.Setsize(ptmx, ws); err != nil {
		log.Printf("Failed to set PTY size: %v", err)
	}

	a.terminals[data.SessionID] = ptmx

	// Read output and send to server
	go func() {
		defer func() {
			delete(a.terminals, data.SessionID)
			ptmx.Close()
		}()

		buf := make([]byte, 8192)
		for {
			n, err := ptmx.Read(buf)
			if err != nil {
				if err != io.EOF {
					log.Printf("PTY read error for session %s: %v", data.SessionID, err)
				}
				return
			}

			if n > 0 {
				log.Printf("PTY output (%d bytes) for session %s: %q", n, data.SessionID, string(buf[:n]))
				
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
	
	ptmx, ok := a.terminals[data.SessionID]
	if !ok {
		log.Printf("Terminal session not found: %s (available: %v)", data.SessionID, a.getTerminalSessions())
		return
	}

	n, err := ptmx.Write([]byte(data.Data))
	if err != nil {
		log.Printf("Failed to write to PTY: %v", err)
	} else {
		log.Printf("Wrote %d bytes to PTY", n)
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
	ptmx, ok := a.terminals[data.SessionID]
	if !ok {
		return
	}

	ws := &pty.Winsize{
		Rows: uint16(data.Rows),
		Cols: uint16(data.Cols),
	}

	pty.Setsize(ptmx, ws)
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

	// Disk (root partition)
	if diskStat, err := disk.Usage("/"); err == nil {
		metrics.DiskUsage = diskStat.UsedPercent
		metrics.DiskTotal = float64(diskStat.Total) / 1024 / 1024 / 1024 // GB
		metrics.DiskUsed = float64(diskStat.Used) / 1024 / 1024 / 1024   // GB
	}

	// Uptime
	if uptime, err := host.Uptime(); err == nil {
		metrics.Uptime = uptime
	}

	return metrics
}

func collectPackages() ([]PackageInfo, ScanSummary, error) {
	if _, err := exec.LookPath("dpkg-query"); err == nil {
		return collectDebPackages()
	}

	if _, err := exec.LookPath("rpm"); err == nil {
		return collectRpmPackages()
	}

	return nil, ScanSummary{}, fmt.Errorf("no supported package manager found")
}

func collectDebPackages() ([]PackageInfo, ScanSummary, error) {
	// First, update the package lists to get latest update information
	// Run with timeout and ignore errors (may fail without sudo, but apt cache may still be fresh)
	updateCmd := exec.Command("apt-get", "update", "-qq")
	updateCmd.Run() // Ignore errors - might need sudo, but try anyway
	
	cmd := exec.Command("dpkg-query", "-W", "-f=${Package} ${Version}\n")
	output, err := cmd.Output()
	if err != nil {
		return nil, ScanSummary{}, err
	}

	statusMap := make(map[string]string)
	
	// Try apt-get -s upgrade first
	if upgradeOutput, err := exec.Command("apt-get", "-s", "upgrade").Output(); err == nil {
		lines := strings.Split(string(upgradeOutput), "\n")
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if !strings.HasPrefix(line, "Inst ") {
				continue
			}

			parts := strings.Fields(line)
			if len(parts) < 2 {
				continue
			}

			status := "update_available"
			// Check for security indicators in the line
			lineLower := strings.ToLower(line)
			if strings.Contains(lineLower, "security") || 
			   strings.Contains(lineLower, "-security") ||
			   strings.Contains(lineLower, "security.ubuntu") ||
			   strings.Contains(lineLower, "security.debian") {
				status = "security_update"
			}
			statusMap[parts[1]] = status
		}
	}
	
	// Also check apt-get -s dist-upgrade for additional security updates
	if distUpgradeOutput, err := exec.Command("apt-get", "-s", "dist-upgrade").Output(); err == nil {
		lines := strings.Split(string(distUpgradeOutput), "\n")
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if !strings.HasPrefix(line, "Inst ") {
				continue
			}

			parts := strings.Fields(line)
			if len(parts) < 2 {
				continue
			}
			
			pkgName := parts[1]
			// Only add if not already tracked
			if _, exists := statusMap[pkgName]; !exists {
				status := "update_available"
				lineLower := strings.ToLower(line)
				if strings.Contains(lineLower, "security") || 
				   strings.Contains(lineLower, "-security") ||
				   strings.Contains(lineLower, "security.ubuntu") ||
				   strings.Contains(lineLower, "security.debian") {
					status = "security_update"
				}
				statusMap[pkgName] = status
			} else if statusMap[pkgName] == "update_available" {
				// Upgrade existing entry to security if this shows security
				lineLower := strings.ToLower(line)
				if strings.Contains(lineLower, "security") || 
				   strings.Contains(lineLower, "-security") ||
				   strings.Contains(lineLower, "security.ubuntu") ||
				   strings.Contains(lineLower, "security.debian") {
					statusMap[pkgName] = "security_update"
				}
			}
		}
	}

	packages := []PackageInfo{}
	summary := ScanSummary{}

	lines := strings.Split(string(output), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}

		status := statusMap[parts[0]]
		if status == "" {
			status = "installed"
		} else {
			summary.Updates++
			if status == "security_update" {
				summary.SecurityUpdates++
			}
		}

		packages = append(packages, PackageInfo{
			Name:    parts[0],
			Version: parts[1],
			Manager: "apt",
			Status:  status,
		})
	}

	summary.Total = len(packages)
	return packages, summary, nil
}

func collectRpmPackages() ([]PackageInfo, ScanSummary, error) {
	cmd := exec.Command("rpm", "-qa", "--queryformat", "%{NAME} %{VERSION}-%{RELEASE}\n")
	output, err := cmd.Output()
	if err != nil {
		return nil, ScanSummary{}, err
	}

	packages := []PackageInfo{}
	lines := strings.Split(string(output), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}

		packages = append(packages, PackageInfo{
			Name:    parts[0],
			Version: parts[1],
			Manager: "rpm",
			Status:  "installed",
		})
	}

	summary := ScanSummary{
		Total: len(packages),
	}
	return packages, summary, nil
}

func getOSInfo() OSInfo {
	info := OSInfo{}

	if hostInfo, err := host.Info(); err == nil {
		info.Distro = hostInfo.Platform
		info.Release = hostInfo.PlatformVersion
		info.Kernel = hostInfo.KernelVersion
	}

	// Try to get better distro info from /etc/os-release
	if data, err := os.ReadFile("/etc/os-release"); err == nil {
		lines := strings.Split(string(data), "\n")
		for _, line := range lines {
			if strings.HasPrefix(line, "PRETTY_NAME=") {
				info.Distro = strings.Trim(strings.TrimPrefix(line, "PRETTY_NAME="), "\"")
			}
		}
	}

	return info
}

func getOutboundIP() string {
	// Try to get the actual outbound IP
	if addresses, err := exec.Command("hostname", "-I").Output(); err == nil {
		// Return first IP address
		fields := strings.Fields(strings.TrimSpace(string(addresses)))
		if len(fields) > 0 {
			return fields[0]
		}
	}
	
	// Fallback to hostname
	hostname, _ := os.Hostname()
	return hostname
}

func collectPorts() []Port {
	ports := []Port{}
	
	// Try ss command first (modern)
	cmd := exec.Command("ss", "-tuln")
	output, err := cmd.Output()
	
	if err != nil {
		// Fallback to netstat
		cmd = exec.Command("netstat", "-tuln")
		output, err = cmd.Output()
		if err != nil {
			log.Printf("Failed to get ports: %v", err)
			return ports
		}
	}
	
	lines := strings.Split(string(output), "\n")
	seenPorts := make(map[string]bool)
	
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "Netid") || strings.HasPrefix(line, "Proto") || strings.HasPrefix(line, "Active") {
			continue
		}
		
		fields := strings.Fields(line)
		if len(fields) < 5 {
			continue
		}
		
		var proto, localAddr, state string
		
		// Parse ss output format
		if fields[0] == "tcp" || fields[0] == "udp" {
			proto = fields[0]
			state = fields[1]
			localAddr = fields[4]
		} else if strings.HasPrefix(fields[0], "tcp") || strings.HasPrefix(fields[0], "udp") {
			// netstat format
			proto = fields[0]
			if strings.Contains(proto, "6") {
				proto = strings.Replace(proto, "6", "", 1)
			}
			localAddr = fields[3]
			if len(fields) > 5 {
				state = fields[5]
			} else {
				state = "LISTEN"
			}
		} else {
			continue
		}
		
		// Extract port from address (format: 0.0.0.0:80 or :::80 or *:80)
		parts := strings.Split(localAddr, ":")
		if len(parts) < 2 {
			continue
		}
		portStr := parts[len(parts)-1]
		
		// Parse port number
		var port int
		_, err := fmt.Sscanf(portStr, "%d", &port)
		if err != nil || port == 0 {
			continue
		}
		
		// Skip if we've seen this port/proto combo
		key := fmt.Sprintf("%s:%d", proto, port)
		if seenPorts[key] {
			continue
		}
		seenPorts[key] = true
		
		// Try to get service name
		service := getServiceName(port, proto)
		
		ports = append(ports, Port{
			Port:    port,
			Proto:   proto,
			Service: service,
			State:   state,
		})
	}
	
	return ports
}

func getServiceName(port int, proto string) string {
	// Common service mappings
	services := map[int]string{
		20:    "FTP Data",
		21:    "FTP",
		22:    "SSH",
		23:    "Telnet",
		25:    "SMTP",
		53:    "DNS",
		80:    "HTTP",
		110:   "POP3",
		143:   "IMAP",
		443:   "HTTPS",
		465:   "SMTPS",
		587:   "SMTP (Submission)",
		993:   "IMAPS",
		995:   "POP3S",
		3000:  "Node.js/Dev Server",
		3306:  "MySQL",
		5432:  "PostgreSQL",
		6379:  "Redis",
		8080:  "HTTP Alt",
		8443:  "HTTPS Alt",
		27017: "MongoDB",
	}
	
	if name, ok := services[port]; ok {
		return name
	}
	
	// Try to get from /etc/services
	cmd := exec.Command("getent", "services", fmt.Sprintf("%d/%s", port, proto))
	output, err := cmd.Output()
	if err == nil {
		fields := strings.Fields(string(output))
		if len(fields) > 0 {
			return fields[0]
		}
	}
	
	return "Unknown"
}

// ==================== SECURITY MONITORING ====================

// criticalFiles lists files to monitor for integrity changes
var criticalFiles = []string{
	"/etc/passwd",
	"/etc/shadow",
	"/etc/sudoers",
	"/etc/ssh/sshd_config",
	"/etc/hosts",
	"/etc/crontab",
	"/root/.ssh/authorized_keys",
	"/etc/pam.d/sshd",
	"/etc/security/access.conf",
}

var integrityRoots = []string{"/"}

// directories that should be skipped to avoid infinite/procfs loops
var integritySkipDirs = map[string]bool{
	"/proc": true,
	"/sys":  true,
	"/dev":  true,
	"/run":  true,
	"/tmp":  true,
}

// configFiles lists configuration files to monitor for drift
var configFiles = []string{
	"/etc/ssh/sshd_config",
	"/etc/sudoers",
	"/etc/hosts.allow",
	"/etc/hosts.deny",
	"/etc/security/limits.conf",
	"/etc/sysctl.conf",
	"/etc/fstab",
}

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

	// Always include the legacy critical set to ensure they are monitored even if permissions block traversal
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

// expectedConfigValues defines expected values for security-critical configs
var expectedConfigValues = map[string]map[string]string{
	"/etc/ssh/sshd_config": {
		"PermitRootLogin":       "no",
		"PasswordAuthentication": "no",
		"PermitEmptyPasswords":   "no",
	},
}

// checkConfigDrift checks for configuration drift from expected values
func (a *Agent) checkConfigDrift() []SecurityFinding {
	var findings []SecurityFinding

	for filePath, expectedValues := range expectedConfigValues {
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

// extractIP tries to extract an IP address from a log line
func extractIP(line string) string {
	// Common patterns: "from 192.168.1.1", "rhost=192.168.1.1"
	patterns := []string{
		`from (\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})`,
		`rhost=(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})`,
		`(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})`,
	}

	for _, pattern := range patterns {
		re := regexp.MustCompile(pattern)
		matches := re.FindStringSubmatch(line)
		if len(matches) > 1 {
			return matches[1]
		}
	}
	return ""
}
