//go:build linux || darwin
// +build linux darwin

package platform

import (
	"bufio"
	"fmt"
	"log"
	"net"
	"os"
	"os/exec"
	"os/signal"
	"regexp"
	"strings"
	"syscall"
	"time"

	"github.com/creack/pty"
	"github.com/shirou/gopsutil/v3/host"
)

func init() {
	Current = &LinuxPlatform{}
}

// LinuxPlatform implements Platform for Linux and macOS.
type LinuxPlatform struct {
	lastAuthLogPos int64
}

// ---------- linuxTerminal wraps a PTY file descriptor ----------

type linuxTerminal struct {
	ptmx *os.File
	cmd  *exec.Cmd
}

func (t *linuxTerminal) Read(p []byte) (int, error)  { return t.ptmx.Read(p) }
func (t *linuxTerminal) Write(p []byte) (int, error)  { return t.ptmx.Write(p) }
func (t *linuxTerminal) Close() error                  { return t.ptmx.Close() }
func (t *linuxTerminal) Resize(cols, rows int) error {
	ws := &pty.Winsize{
		Rows: uint16(rows),
		Cols: uint16(cols),
	}
	return pty.Setsize(t.ptmx, ws)
}

// ---------- Platform interface ----------

func (p *LinuxPlatform) ConfigPath() string       { return "/etc/maintainer-agent/config.json" }
func (p *LinuxPlatform) RuntimePlatform() string   { return "linux" }
func (p *LinuxPlatform) RootDiskPath() string      { return "/" }

func (p *LinuxPlatform) SpawnTerminal() (Terminal, error) {
	cmd := exec.Command("/bin/bash", "--login")
	cmd.Env = append(os.Environ(),
		"TERM=xterm-256color",
		"BASH_SILENCE_DEPRECATION_WARNING=1",
		"LC_ALL=en_US.UTF-8",
		"LANG=en_US.UTF-8",
	)
	ptmx, err := pty.Start(cmd)
	if err != nil {
		return nil, fmt.Errorf("pty.Start: %w", err)
	}
	// Set initial size
	ws := &pty.Winsize{Rows: 24, Cols: 80}
	pty.Setsize(ptmx, ws)
	return &linuxTerminal{ptmx: ptmx, cmd: cmd}, nil
}

func (p *LinuxPlatform) ShellCommand() []string {
	return []string{"/bin/bash", "-c"}
}

func (p *LinuxPlatform) BackgroundExecCommand(scriptPath string) *exec.Cmd {
	cmd := exec.Command("setsid", "nohup", "/bin/bash", scriptPath)
	cmd.Stdout = nil
	cmd.Stderr = nil
	cmd.Stdin = nil
	return cmd
}

func (p *LinuxPlatform) DangerousCommands() []string {
	return []string{
		"reboot",
		"shutdown",
		"systemctl reboot",
		"systemctl poweroff",
		"shutdown -r",
		"shutdown -h",
	}
}

func (p *LinuxPlatform) GetOSInfo() OSInfo {
	info := OSInfo{}
	if hostInfo, err := host.Info(); err == nil {
		info.Distro = hostInfo.Platform
		info.Release = hostInfo.PlatformVersion
		info.Kernel = hostInfo.KernelVersion
	}
	// Try to get a nicer distro string from /etc/os-release
	if data, err := os.ReadFile("/etc/os-release"); err == nil {
		for _, line := range strings.Split(string(data), "\n") {
			if strings.HasPrefix(line, "PRETTY_NAME=") {
				info.Distro = strings.Trim(strings.TrimPrefix(line, "PRETTY_NAME="), "\"")
			}
		}
	}
	return info
}

func (p *LinuxPlatform) GetOutboundIP() string {
	// Dial-based detection: connect to a public DNS server to determine
	// the actual outbound interface (avoids VPN/Docker/virtual interfaces)
	conn, err := net.Dial("udp", "8.8.8.8:80")
	if err == nil {
		defer conn.Close()
		if localAddr, ok := conn.LocalAddr().(*net.UDPAddr); ok {
			return localAddr.IP.String()
		}
	}

	// Fallback: use hostname -I command
	if out, err := exec.Command("hostname", "-I").Output(); err == nil {
		fields := strings.Fields(strings.TrimSpace(string(out)))
		if len(fields) > 0 {
			return fields[0]
		}
	}
	hostname, _ := os.Hostname()
	return hostname
}

func (p *LinuxPlatform) CollectPorts() []Port {
	ports := []Port{}

	cmd := exec.Command("ss", "-tuln")
	output, err := cmd.Output()
	if err != nil {
		cmd = exec.Command("netstat", "-tuln")
		output, err = cmd.Output()
		if err != nil {
			return ports
		}
	}

	seenPorts := make(map[string]bool)
	for _, line := range strings.Split(string(output), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "Netid") || strings.HasPrefix(line, "Proto") || strings.HasPrefix(line, "Active") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 5 {
			continue
		}

		var proto, localAddr, state string
		if fields[0] == "tcp" || fields[0] == "udp" {
			proto = fields[0]
			state = fields[1]
			localAddr = fields[4]
		} else if strings.HasPrefix(fields[0], "tcp") || strings.HasPrefix(fields[0], "udp") {
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

		parts := strings.Split(localAddr, ":")
		if len(parts) < 2 {
			continue
		}
		portStr := parts[len(parts)-1]

		var port int
		if _, err := fmt.Sscanf(portStr, "%d", &port); err != nil || port == 0 {
			continue
		}
		key := fmt.Sprintf("%s:%d", proto, port)
		if seenPorts[key] {
			continue
		}
		seenPorts[key] = true

		ports = append(ports, Port{
			Port:    port,
			Proto:   proto,
			Service: getServiceName(port, proto),
			State:   state,
		})
	}
	return ports
}

func (p *LinuxPlatform) CollectPackages() ([]PackageInfo, PackageSummary, error) {
	if _, err := exec.LookPath("dpkg-query"); err == nil {
		return collectDebPackages()
	}
	if _, err := exec.LookPath("rpm"); err == nil {
		return collectRpmPackages()
	}
	if _, err := exec.LookPath("apk"); err == nil {
		return collectApkPackages()
	}
	if _, err := exec.LookPath("pacman"); err == nil {
		return collectPacmanPackages()
	}
	if _, err := exec.LookPath("brew"); err == nil {
		return collectBrewPackages()
	}
	log.Printf("Warning: no supported package manager found (dpkg, rpm, apk, pacman, brew)")
	return []PackageInfo{}, PackageSummary{}, nil
}

func (p *LinuxPlatform) CriticalFiles() []string {
	return []string{
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
}

func (p *LinuxPlatform) IntegrityRoots() []string { return []string{"/"} }

func (p *LinuxPlatform) IntegritySkipDirs() map[string]bool {
	return map[string]bool{
		"/proc": true,
		"/sys":  true,
		"/dev":  true,
		"/run":  true,
		"/tmp":  true,
	}
}

func (p *LinuxPlatform) ConfigExpectations() map[string]map[string]string {
	return map[string]map[string]string{
		"/etc/ssh/sshd_config": {
			"PermitRootLogin":        "no",
			"PasswordAuthentication": "no",
			"PermitEmptyPasswords":   "no",
		},
	}
}

func (p *LinuxPlatform) CheckAuthLogIncremental(failedLoginCounts map[string]int) []SecurityEvent {
	var events []SecurityEvent

	authLogPaths := []string{
		"/var/log/auth.log",
		"/var/log/secure",
		"/var/log/messages",
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

	info, err := file.Stat()
	if err != nil {
		return events
	}

	// Detect log rotation
	if info.Size() < p.lastAuthLogPos {
		log.Printf("Auth log rotated, resetting position")
		p.lastAuthLogPos = 0
	}

	if p.lastAuthLogPos > 0 {
		file.Seek(p.lastAuthLogPos, 0)
	} else {
		if info.Size() > 51200 {
			file.Seek(-51200, 2)
		}
		log.Printf("First security scan - reading recent auth log entries")
	}

	scanner := bufio.NewScanner(file)
	newFailedLogins := make(map[string]int)
	newRootLogins := 0

	for scanner.Scan() {
		line := scanner.Text()
		lineLower := strings.ToLower(line)

		if strings.Contains(lineLower, "failed password") ||
			strings.Contains(lineLower, "authentication failure") ||
			strings.Contains(lineLower, "invalid user") {
			ipMatch := extractIP(line)
			if ipMatch == "" {
				ipMatch = "unknown"
			}
			newFailedLogins[ipMatch]++
		}

		if strings.Contains(lineLower, "accepted") && strings.Contains(lineLower, "root") {
			newRootLogins++
		}
	}

	pos, _ := file.Seek(0, 1)
	p.lastAuthLogPos = pos

	for ip, newCount := range newFailedLogins {
		failedLoginCounts[ip] += newCount
		totalCount := failedLoginCounts[ip]

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
				},
			})
			log.Printf("🔴 AUTH ALERT: %d total failed login attempts from %s (+%d new)", totalCount, ip, newCount)
		}
	}

	if newRootLogins > 0 {
		fingerprint := fmt.Sprintf("root_login:%d", time.Now().Unix()/300)
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

func (p *LinuxPlatform) GenerateUpdateScript(binaryURL, currentBinary string) string {
	return fmt.Sprintf(`#!/bin/bash
set -e

BINARY_URL="%s"
CURRENT_BINARY="%s"
LOG_FILE="/tmp/maintainer-agent-update.log"
NEW_BINARY="/tmp/maintainer-agent-new"

log() {
    echo "[$(date '+%%%%Y-%%%%m-%%%%d %%%%H:%%%%M:%%%%S')] $1" | tee -a "$LOG_FILE"
}

log "Maintainer Agent Update Started"
log "Binary URL: $BINARY_URL"
log "Current binary: $CURRENT_BINARY"

# Wait for agent to disconnect
sleep 3

# Stop the service
log "Stopping maintainer-agent service..."
if systemctl is-active --quiet maintainer-agent 2>/dev/null; then
    systemctl stop maintainer-agent
    sleep 2
fi

# Kill any stray process
pkill -9 -f "maintainer-agent" 2>/dev/null || true
sleep 1

# Download new binary with cache buster
log "Downloading new binary from $BINARY_URL..."
TIMESTAMP=$(date +%%s)
DOWNLOAD_URL="${BINARY_URL}?t=${TIMESTAMP}"

if command -v curl &> /dev/null; then
    if ! curl -fsSL "$DOWNLOAD_URL" -o "$NEW_BINARY"; then
        log "ERROR: Download failed with curl!"
        systemctl start maintainer-agent 2>/dev/null || true
        exit 1
    fi
elif command -v wget &> /dev/null; then
    if ! wget -q -O "$NEW_BINARY" "$DOWNLOAD_URL"; then
        log "ERROR: Download failed with wget!"
        systemctl start maintainer-agent 2>/dev/null || true
        exit 1
    fi
else
    log "ERROR: Neither curl nor wget available!"
    systemctl start maintainer-agent 2>/dev/null || true
    exit 1
fi

# Verify downloaded file
if [ ! -f "$NEW_BINARY" ]; then
    log "ERROR: Downloaded binary not found!"
    systemctl start maintainer-agent 2>/dev/null || true
    exit 1
fi

FILE_SIZE=$(stat -f%%z "$NEW_BINARY" 2>/dev/null || stat -c%%s "$NEW_BINARY" 2>/dev/null || echo 0)
if [ "$FILE_SIZE" -lt 1048576 ]; then
    log "ERROR: Downloaded binary too small ($FILE_SIZE bytes) - likely download error"
    rm -f "$NEW_BINARY"
    systemctl start maintainer-agent 2>/dev/null || true
    exit 1
fi

log "Download complete. Size: $FILE_SIZE bytes"

# Backup current binary
log "Creating backup of current binary..."
cp "$CURRENT_BINARY" "${CURRENT_BINARY}.backup" 2>/dev/null || true

# Replace binary
log "Replacing binary..."
chmod +x "$NEW_BINARY"
if ! mv "$NEW_BINARY" "$CURRENT_BINARY"; then
    log "ERROR: Failed to replace binary!"
    if [ -f "${CURRENT_BINARY}.backup" ]; then
        log "Restoring backup..."
        mv "${CURRENT_BINARY}.backup" "$CURRENT_BINARY"
    fi
    systemctl start maintainer-agent 2>/dev/null || true
    exit 1
fi
chmod +x "$CURRENT_BINARY"
log "Binary replaced successfully"

# Start the service
log "Starting maintainer-agent service..."
systemctl start maintainer-agent 2>/dev/null || true

# Wait and verify service started
sleep 3
if systemctl is-active --quiet maintainer-agent 2>/dev/null; then
    log "✅ Update successful! Service is running."
    # Remove backup after successful update
    rm -f "${CURRENT_BINARY}.backup"
else
    log "⚠️ Service failed to start, restoring backup..."
    if [ -f "${CURRENT_BINARY}.backup" ]; then
        mv "${CURRENT_BINARY}.backup" "$CURRENT_BINARY"
        systemctl start maintainer-agent 2>/dev/null || true
        log "Backup restored and service started"
    fi
fi

# Cleanup temporary files and self-delete
rm -f "$NEW_BINARY"
rm -f "$0"
log "Update process complete!"
`, binaryURL, currentBinary)
}

func (p *LinuxPlatform) ShutdownSignals() []os.Signal {
	return []os.Signal{syscall.SIGINT, syscall.SIGTERM}
}

// ---------- helpers ----------

func extractIP(line string) string {
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

func collectDebPackages() ([]PackageInfo, PackageSummary, error) {
	exec.Command("apt-get", "update", "-qq").Run()

	cmd := exec.Command("dpkg-query", "-W", "-f=${Package} ${Version}\n")
	output, err := cmd.Output()
	if err != nil {
		return nil, PackageSummary{}, err
	}

	statusMap := make(map[string]string)

	if upgradeOutput, err := exec.Command("apt-get", "-s", "upgrade").Output(); err == nil {
		for _, line := range strings.Split(string(upgradeOutput), "\n") {
			line = strings.TrimSpace(line)
			if !strings.HasPrefix(line, "Inst ") {
				continue
			}
			parts := strings.Fields(line)
			if len(parts) < 2 {
				continue
			}
			status := "update_available"
			lineLower := strings.ToLower(line)
			if strings.Contains(lineLower, "security") {
				status = "security_update"
			}
			statusMap[parts[1]] = status
		}
	}

	if distOutput, err := exec.Command("apt-get", "-s", "dist-upgrade").Output(); err == nil {
		for _, line := range strings.Split(string(distOutput), "\n") {
			line = strings.TrimSpace(line)
			if !strings.HasPrefix(line, "Inst ") {
				continue
			}
			parts := strings.Fields(line)
			if len(parts) < 2 {
				continue
			}
			pkgName := parts[1]
			if _, exists := statusMap[pkgName]; !exists {
				status := "update_available"
				if strings.Contains(strings.ToLower(line), "security") {
					status = "security_update"
				}
				statusMap[pkgName] = status
			} else if statusMap[pkgName] == "update_available" {
				if strings.Contains(strings.ToLower(line), "security") {
					statusMap[pkgName] = "security_update"
				}
			}
		}
	}

	var packages []PackageInfo
	summary := PackageSummary{}

	for _, line := range strings.Split(string(output), "\n") {
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

func collectRpmPackages() ([]PackageInfo, PackageSummary, error) {
	cmd := exec.Command("rpm", "-qa", "--queryformat", "%{NAME} %{VERSION}-%{RELEASE}\n")
	output, err := cmd.Output()
	if err != nil {
		return nil, PackageSummary{}, err
	}

	var packages []PackageInfo
	for _, line := range strings.Split(string(output), "\n") {
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
	summary := PackageSummary{Total: len(packages)}
	return packages, summary, nil
}

func collectApkPackages() ([]PackageInfo, PackageSummary, error) {
	cmd := exec.Command("apk", "list", "--installed")
	output, err := cmd.Output()
	if err != nil {
		return nil, PackageSummary{}, fmt.Errorf("apk list: %w", err)
	}

	var packages []PackageInfo
	for _, line := range strings.Split(string(output), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		// Format: "package-name-1.2.3-r0 x86_64 {origin} (license) [installed]"
		// We need to split name and version from the first field
		fields := strings.Fields(line)
		if len(fields) < 1 {
			continue
		}
		nameVersion := fields[0]
		// Find the last dash that separates name from version
		idx := strings.LastIndex(nameVersion, "-")
		if idx <= 0 {
			continue
		}
		// The version part may contain a second dash (e.g., "1.2.3-r0")
		// Find version start: scan backwards for second-to-last dash before a digit
		name := nameVersion
		version := ""
		for i := len(nameVersion) - 1; i > 0; i-- {
			if nameVersion[i] == '-' && i+1 < len(nameVersion) && nameVersion[i+1] >= '0' && nameVersion[i+1] <= '9' {
				name = nameVersion[:i]
				version = nameVersion[i+1:]
				break
			}
		}
		if version == "" {
			continue
		}
		packages = append(packages, PackageInfo{
			Name:    name,
			Version: version,
			Manager: "apk",
			Status:  "installed",
		})
	}

	summary := PackageSummary{Total: len(packages)}

	// Check for upgradable packages
	if upgradeOutput, err := exec.Command("apk", "version", "-l", "<").Output(); err == nil {
		for _, line := range strings.Split(string(upgradeOutput), "\n") {
			line = strings.TrimSpace(line)
			if line != "" && !strings.HasPrefix(line, "Installed:") {
				summary.Updates++
			}
		}
	}

	return packages, summary, nil
}

func collectPacmanPackages() ([]PackageInfo, PackageSummary, error) {
	cmd := exec.Command("pacman", "-Q")
	output, err := cmd.Output()
	if err != nil {
		return nil, PackageSummary{}, fmt.Errorf("pacman -Q: %w", err)
	}

	var packages []PackageInfo
	for _, line := range strings.Split(string(output), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		// Format: "package-name version"
		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}
		packages = append(packages, PackageInfo{
			Name:    parts[0],
			Version: parts[1],
			Manager: "pacman",
			Status:  "installed",
		})
	}

	summary := PackageSummary{Total: len(packages)}

	// Check for available updates
	if updateOutput, err := exec.Command("pacman", "-Qu").Output(); err == nil {
		for _, line := range strings.Split(string(updateOutput), "\n") {
			if strings.TrimSpace(line) != "" {
				summary.Updates++
			}
		}
	}

	return packages, summary, nil
}

func collectBrewPackages() ([]PackageInfo, PackageSummary, error) {
	cmd := exec.Command("brew", "list", "--versions")
	output, err := cmd.Output()
	if err != nil {
		return nil, PackageSummary{}, fmt.Errorf("brew list: %w", err)
	}

	var packages []PackageInfo
	for _, line := range strings.Split(string(output), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		// Format: "package-name 1.2.3" (may have multiple versions)
		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}
		// Use the last version listed (most recent)
		packages = append(packages, PackageInfo{
			Name:    parts[0],
			Version: parts[len(parts)-1],
			Manager: "brew",
			Status:  "installed",
		})
	}

	summary := PackageSummary{Total: len(packages)}

	// Check for outdated packages
	if outdatedOutput, err := exec.Command("brew", "outdated", "--verbose").Output(); err == nil {
		for _, line := range strings.Split(string(outdatedOutput), "\n") {
			if strings.TrimSpace(line) != "" {
				summary.Updates++
			}
		}
	}

	return packages, summary, nil
}

func getServiceName(port int, proto string) string {
	services := map[int]string{
		20: "FTP Data", 21: "FTP", 22: "SSH", 23: "Telnet",
		25: "SMTP", 53: "DNS", 80: "HTTP", 110: "POP3",
		143: "IMAP", 443: "HTTPS", 465: "SMTPS",
		587: "SMTP (Submission)", 993: "IMAPS", 995: "POP3S",
		3000: "Node.js/Dev Server", 3306: "MySQL", 5432: "PostgreSQL",
		6379: "Redis", 8080: "HTTP Alt", 8443: "HTTPS Alt",
		27017: "MongoDB",
	}
	if name, ok := services[port]; ok {
		return name
	}
	if out, err := exec.Command("getent", "services", fmt.Sprintf("%d/%s", port, proto)).Output(); err == nil {
		if fields := strings.Fields(string(out)); len(fields) > 0 {
			return fields[0]
		}
	}
	return "Unknown"
}

// Ensure we use signal.Notify indirectly so the import is consumed.
var _ = signal.Notify
