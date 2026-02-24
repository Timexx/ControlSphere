//go:build windows
// +build windows

package platform

import (
	"bufio"
	"context"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"log"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
	"time"

	"github.com/shirou/gopsutil/v3/host"
)

func init() {
	Current = &WindowsPlatform{}
}

// WindowsPlatform implements Platform for Windows Server and Windows 11.
type WindowsPlatform struct {
	lastEventTime string // tracks the last read Windows Event Log timestamp
}

// ---------- windowsTerminal wraps a ConPTY / piped process ----------

// windowsTerminal is a simple pipe-based terminal for Windows.
// For production use a ConPTY wrapper (github.com/UserExistsError/conpty)
// could be linked in; here we provide a baseline with stdin/stdout pipes.
type windowsTerminal struct {
	cmd    *exec.Cmd
	stdin  *os.File // write end of stdin pipe
	stdout *os.File // read end of stdout pipe
}

func (t *windowsTerminal) Read(p []byte) (int, error)  { return t.stdout.Read(p) }
func (t *windowsTerminal) Write(p []byte) (int, error)  { return t.stdin.Write(p) }
func (t *windowsTerminal) Resize(cols, rows int) error   { return nil /* ConPTY resize here */ }
func (t *windowsTerminal) Close() error {
	t.stdin.Close()
	t.stdout.Close()
	if t.cmd.Process != nil {
		t.cmd.Process.Kill()
	}
	return nil
}

// ---------- Platform interface ----------

func (p *WindowsPlatform) ConfigPath() string {
	pd := os.Getenv("ProgramData")
	if pd == "" {
		pd = `C:\ProgramData`
	}
	return filepath.Join(pd, "maintainer-agent", "config.json")
}

func (p *WindowsPlatform) RuntimePlatform() string { return "windows" }
func (p *WindowsPlatform) RootDiskPath() string    { return `C:\` }

func (p *WindowsPlatform) SpawnTerminal() (Terminal, error) {
	// Determine the best available shell
	shell := pickWindowsShell()
	var cmd *exec.Cmd
	if strings.Contains(shell, "pwsh") || strings.Contains(shell, "powershell") {
		// -NoExit keeps PowerShell alive reading stdin interactively via pipes
		cmd = exec.Command(shell, "-NoLogo", "-NoProfile", "-NoExit")
	} else {
		cmd = exec.Command(shell) // cmd.exe
	}

	// When running as a Windows Service (Session 0), there is no desktop or
	// console.  CREATE_NO_WINDOW (0x08000000) prevents CreateProcess from
	// failing when it tries to allocate a console window.
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: 0x08000000, // CREATE_NO_WINDOW
	}

	// Create pipes
	stdinR, stdinW, err := os.Pipe()
	if err != nil {
		return nil, fmt.Errorf("stdin pipe: %w", err)
	}
	stdoutR, stdoutW, err := os.Pipe()
	if err != nil {
		stdinR.Close()
		stdinW.Close()
		return nil, fmt.Errorf("stdout pipe: %w", err)
	}

	cmd.Stdin = stdinR
	cmd.Stdout = stdoutW
	cmd.Stderr = stdoutW

	if err := cmd.Start(); err != nil {
		stdinR.Close()
		stdinW.Close()
		stdoutR.Close()
		stdoutW.Close()
		return nil, fmt.Errorf("start shell: %w", err)
	}

	// Close unused ends in the parent process; child has its own handles
	stdinR.Close()
	stdoutW.Close()

	log.Printf("Spawned Windows terminal: %s (PID %d)", shell, cmd.Process.Pid)

	return &windowsTerminal{
		cmd:    cmd,
		stdin:  stdinW,
		stdout: stdoutR,
	}, nil
}

func (p *WindowsPlatform) ShellCommand() []string {
	shell := pickWindowsShell()
	if strings.Contains(shell, "pwsh") || strings.Contains(shell, "powershell") {
		return []string{shell, "-Command"}
	}
	return []string{shell, "/C"}
}

func (p *WindowsPlatform) BackgroundExecCommand(scriptPath string) *exec.Cmd {
	// Use WMI Win32_Process.Create to launch the update script fully detached
	// from the service process tree. This is the most reliable method because:
	//   - Child processes via exec.Command are tied to the service job object
	//   - schtasks /TR has quoting issues with paths containing spaces/quotes
	//   - WMI Process.Create spawns a truly independent process under SYSTEM
	shell := pickWindowsShell()

	// WMI Create() takes a single CommandLine string. The spawned process
	// runs outside the service job object, so it survives service shutdown.
	wmiCommand := fmt.Sprintf(
		`$proc = ([wmiclass]'Win32_Process').Create('%s -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%s"'); if ($proc.ReturnValue -ne 0) { exit 1 }`,
		shell, scriptPath,
	)

	cmd := exec.Command("powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", wmiCommand)
	cmd.Stdout = nil
	cmd.Stderr = nil
	cmd.Stdin = nil
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: 0x08000000, // CREATE_NO_WINDOW
	}
	return cmd
}

func (p *WindowsPlatform) DangerousCommands() []string {
	return []string{
		"shutdown /r",
		"shutdown /s",
		"Restart-Computer",
		"Stop-Computer",
		"Format-Volume",
		"Clear-Disk",
		"Remove-Partition",
	}
}

func (p *WindowsPlatform) GetOSInfo() OSInfo {
	info := OSInfo{}
	// gopsutil works natively on Windows — use the same host.Info call
	if hostInfo, err := hostInfoWindows(); err == nil {
		info.Distro = hostInfo.distro
		info.Release = hostInfo.release
		info.Kernel = hostInfo.kernel
	}
	return info
}

func (p *WindowsPlatform) GetOutboundIP() string {
	// Dial-based detection: connect to a public DNS server to determine
	// the actual outbound interface (avoids VPN/Docker/virtual interfaces)
	conn, err := net.Dial("udp", "8.8.8.8:80")
	if err == nil {
		defer conn.Close()
		if localAddr, ok := conn.LocalAddr().(*net.UDPAddr); ok {
			return localAddr.IP.String()
		}
	}

	// Fallback: use Go's net package to iterate interfaces
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		hostname, _ := os.Hostname()
		return hostname
	}
	for _, addr := range addrs {
		if ipnet, ok := addr.(*net.IPNet); ok && !ipnet.IP.IsLoopback() && ipnet.IP.To4() != nil {
			return ipnet.IP.String()
		}
	}
	hostname, _ := os.Hostname()
	return hostname
}

func (p *WindowsPlatform) CollectPorts() []Port {
	// Try PowerShell cmdlets first (more reliable, structured output)
	if ports, err := collectPortsPowerShell(); err == nil && len(ports) > 0 {
		return ports
	}

	// Fallback: parse netstat -ano
	return collectPortsNetstat()
}

// collectPortsPowerShell uses Get-NetTCPConnection / Get-NetUDPEndpoint
// for reliable, structured port collection on Windows Server 2012+ / Win8+.
func collectPortsPowerShell() ([]Port, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	shell := pickWindowsShell()
	if !strings.Contains(shell, "pwsh") && !strings.Contains(shell, "powershell") {
		return nil, fmt.Errorf("PowerShell not available")
	}

	// Collect TCP LISTEN + UDP bound ports in one script, output as JSON
	psScript := `
$tcp = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Select-Object @{N='port';E={$_.LocalPort}},
                @{N='proto';E={'tcp'}},
                @{N='state';E={'LISTENING'}},
                @{N='pid';E={$_.OwningProcess}}

$udp = Get-NetUDPEndpoint -ErrorAction SilentlyContinue |
  Select-Object @{N='port';E={$_.LocalPort}},
                @{N='proto';E={'udp'}},
                @{N='state';E={'LISTENING'}},
                @{N='pid';E={$_.OwningProcess}}

$all = @()
if ($tcp) { $all += $tcp }
if ($udp) { $all += $udp }
$all | Sort-Object port -Unique | ConvertTo-Json -Compress
`
	cmd := exec.CommandContext(ctx, shell, "-NoProfile", "-NonInteractive", "-Command", psScript)
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("PowerShell port query failed: %w", err)
	}

	output = []byte(strings.TrimSpace(string(output)))
	if len(output) == 0 {
		return nil, fmt.Errorf("empty output")
	}

	type psPort struct {
		Port  int    `json:"port"`
		Proto string `json:"proto"`
		State string `json:"state"`
		PID   int    `json:"pid"`
	}

	var entries []psPort
	if err := json.Unmarshal(output, &entries); err != nil {
		// Single object when only one port
		var single psPort
		if err2 := json.Unmarshal(output, &single); err2 != nil {
			return nil, fmt.Errorf("failed to parse port JSON: %w", err)
		}
		entries = []psPort{single}
	}

	seenPorts := make(map[string]bool)
	var ports []Port
	for _, e := range entries {
		if e.Port == 0 {
			continue
		}
		key := fmt.Sprintf("%s:%d", e.Proto, e.Port)
		if seenPorts[key] {
			continue
		}
		seenPorts[key] = true

		ports = append(ports, Port{
			Port:    e.Port,
			Proto:   e.Proto,
			Service: getWindowsServiceName(e.Port),
			State:   e.State,
		})
	}

	log.Printf("PowerShell: collected %d listening ports", len(ports))
	return ports, nil
}

// collectPortsNetstat falls back to parsing `netstat -ano` output.
func collectPortsNetstat() []Port {
	ports := []Port{}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "netstat", "-ano")
	output, err := cmd.Output()
	if err != nil {
		log.Printf("Failed to run netstat: %v", err)
		return ports
	}

	seenPorts := make(map[string]bool)
	for _, line := range strings.Split(string(output), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}

		proto := strings.ToLower(fields[0])
		if proto != "tcp" && proto != "udp" {
			continue
		}

		// TCP lines: Proto  LocalAddr  ForeignAddr  State  [PID]
		// UDP lines: Proto  LocalAddr  ForeignAddr  [PID]  (no State column!)
		state := "LISTENING"
		if proto == "tcp" {
			if len(fields) >= 4 {
				state = fields[3]
			}
			// Only interested in LISTENING TCP ports
			if state != "LISTENING" {
				continue
			}
		}
		// UDP: all bound ports are effectively "listening"

		localAddr := fields[1]
		// Parse port from "0.0.0.0:80", "[::]:80", or "127.0.0.1:8080"
		lastColon := strings.LastIndex(localAddr, ":")
		if lastColon < 0 {
			continue
		}
		portStr := localAddr[lastColon+1:]
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
			Service: getWindowsServiceName(port),
			State:   state,
		})
	}

	log.Printf("netstat: collected %d listening ports", len(ports))
	return ports
}

func (p *WindowsPlatform) CollectPackages() ([]PackageInfo, PackageSummary, error) {
	var allPackages []PackageInfo
	summary := PackageSummary{}
	var collectionErrors []string

	// 1. Installed programs from Windows Registry (primary source — "Add/Remove Programs")
	if pkgs, err := collectRegistryInstalledPrograms(); err == nil {
		allPackages = append(allPackages, pkgs...)
		log.Printf("Registry: collected %d installed programs", len(pkgs))
	} else {
		log.Printf("Registry collection failed: %v", err)
		collectionErrors = append(collectionErrors, fmt.Sprintf("Registry: %v", err))
	}

	// 2. Windows Update installed patches (via wmic)
	if pkgs, err := collectWindowsUpdatePackages(); err == nil {
		allPackages = append(allPackages, pkgs...)
		log.Printf("Windows Update: collected %d KB patches", len(pkgs))
	} else {
		log.Printf("Windows Update collection failed: %v", err)
		collectionErrors = append(collectionErrors, fmt.Sprintf("Windows Update: %v", err))
	}

	// 3. Chocolatey
	if _, err := exec.LookPath("choco"); err == nil {
		if pkgs, updates, err := collectChocolateyPackages(); err == nil {
			allPackages = append(allPackages, pkgs...)
			summary.Updates += updates
			log.Printf("Chocolatey: collected %d packages (%d updates)", len(pkgs), updates)
		} else {
			log.Printf("Chocolatey collection failed: %v", err)
			collectionErrors = append(collectionErrors, fmt.Sprintf("Chocolatey: %v", err))
		}
	} else {
		log.Printf("Chocolatey not installed")
	}

	// 4. winget
	if _, err := exec.LookPath("winget"); err == nil {
		if pkgs, updates, err := collectWingetPackages(); err == nil {
			allPackages = append(allPackages, pkgs...)
			summary.Updates += updates
			log.Printf("winget: collected %d packages (%d updates)", len(pkgs), updates)
		} else {
			log.Printf("winget collection failed: %v", err)
			collectionErrors = append(collectionErrors, fmt.Sprintf("winget: %v", err))
		}
	} else {
		log.Printf("winget not installed")
	}

	// Deduplicate: registry may overlap with choco/winget
	allPackages = deduplicatePackages(allPackages)

	summary.Total = len(allPackages)
	
	// If we have no packages at all, return empty instead of error
	// so the scan can still deliver integrity/config/auth findings
	if len(allPackages) == 0 {
		errMsg := "No packages collected from any source"
		if len(collectionErrors) > 0 {
			errMsg += ": " + strings.Join(collectionErrors, "; ")
		}
		log.Printf("Warning: %s", errMsg)
		return []PackageInfo{}, PackageSummary{}, nil
	}
	
	log.Printf("Total packages collected: %d (Updates: %d, Security: %d)",
		summary.Total, summary.Updates, summary.SecurityUpdates)
	
	return allPackages, summary, nil
}

// deduplicatePackages removes duplicates preferring choco/winget over registry entries.
func deduplicatePackages(pkgs []PackageInfo) []PackageInfo {
	// key = lowercase(name), prefer managed packages over registry
	priority := map[string]int{
		"choco":          3,
		"winget":         3,
		"windows_update": 2,
		"registry":       1,
	}
	type entry struct {
		pkg      PackageInfo
		priority int
	}
	bestByName := make(map[string]entry)
	for _, p := range pkgs {
		key := strings.ToLower(p.Name)
		pri := priority[p.Manager]
		if pri == 0 {
			pri = 1
		}
		if existing, ok := bestByName[key]; !ok || pri > existing.priority {
			bestByName[key] = entry{pkg: p, priority: pri}
		}
	}
	result := make([]PackageInfo, 0, len(bestByName))
	for _, e := range bestByName {
		result = append(result, e.pkg)
	}
	return result
}

func (p *WindowsPlatform) CriticalFiles() []string {
	systemRoot := os.Getenv("SystemRoot")
	if systemRoot == "" {
		systemRoot = `C:\Windows`
	}
	return []string{
		filepath.Join(systemRoot, `System32\config\SAM`),
		filepath.Join(systemRoot, `System32\drivers\etc\hosts`),
		filepath.Join(systemRoot, `System32\drivers\etc\lmhosts.sam`),
		filepath.Join(systemRoot, `System32\GroupPolicy\Machine\Registry.pol`),
		filepath.Join(systemRoot, `System32\GroupPolicy\User\Registry.pol`),
	}
}

func (p *WindowsPlatform) IntegrityRoots() []string {
	systemRoot := os.Getenv("SystemRoot")
	if systemRoot == "" {
		systemRoot = `C:\Windows`
	}
	return []string{
		filepath.Join(systemRoot, `System32\config`),
		filepath.Join(systemRoot, `System32\drivers\etc`),
	}
}

func (p *WindowsPlatform) IntegritySkipDirs() map[string]bool {
	systemRoot := os.Getenv("SystemRoot")
	if systemRoot == "" {
		systemRoot = `C:\Windows`
	}
	return map[string]bool{
		filepath.Join(systemRoot, "WinSxS"):          true,
		filepath.Join(systemRoot, "Temp"):             true,
		`C:\$Recycle.Bin`:                             true,
		`C:\System Volume Information`:                true,
		filepath.Join(systemRoot, "Prefetch"):         true,
		filepath.Join(systemRoot, "SoftwareDistribution"): true,
	}
}

func (p *WindowsPlatform) ConfigExpectations() map[string]map[string]string {
	// Windows doesn't have key=value config files in the same sense.
	// We check registry values via dedicated commands in CheckAuthLogIncremental / ConfigDrift.
	return map[string]map[string]string{}
}

// Windows Event Log XML types for parsing wevtutil output
type eventLog struct {
	XMLName xml.Name `xml:"Event"`
	System  struct {
		EventID   int    `xml:"EventID"`
		TimeCreated struct {
			SystemTime string `xml:"SystemTime,attr"`
		} `xml:"TimeCreated"`
	} `xml:"System"`
	EventData struct {
		Data []struct {
			Name  string `xml:"Name,attr"`
			Value string `xml:",chardata"`
		} `xml:"Data"`
	} `xml:"EventData"`
}

func (p *WindowsPlatform) CheckAuthLogIncremental(failedLoginCounts map[string]int) []SecurityEvent {
	var events []SecurityEvent

	// Query Windows Security Event Log for failed logins (4625) and successes (4624)
	// Use wevtutil which is available on all Windows versions
	timeFilter := ""
	if p.lastEventTime != "" {
		timeFilter = fmt.Sprintf(" and TimeCreated[@SystemTime>'%s']", p.lastEventTime)
	} else {
		// First run: look back 1 hour
		oneHourAgo := time.Now().Add(-1 * time.Hour).UTC().Format("2006-01-02T15:04:05.000Z")
		timeFilter = fmt.Sprintf(" and TimeCreated[@SystemTime>'%s']", oneHourAgo)
	}

	query := fmt.Sprintf("*[System[(EventID=4625 or EventID=4624)%s]]", timeFilter)
	cmd := exec.Command("wevtutil", "qe", "Security", "/q:"+query, "/f:xml")
	output, err := cmd.Output()
	if err != nil {
		// wevtutil may require elevated privileges — log and return
		log.Printf("Failed to query Windows Event Log: %v", err)
		return events
	}

	// Parse the XML output (may contain multiple <Event> elements)
	rawEvents := splitXMLEvents(string(output))
	newFailedLogins := make(map[string]int)
	newAdminLogins := 0
	var latestTime string

	for _, rawEvent := range rawEvents {
		var evt eventLog
		if err := xml.Unmarshal([]byte(rawEvent), &evt); err != nil {
			continue
		}

		timestamp := evt.System.TimeCreated.SystemTime
		if timestamp > latestTime {
			latestTime = timestamp
		}

		// Extract relevant data fields
		dataMap := make(map[string]string)
		for _, d := range evt.EventData.Data {
			dataMap[d.Name] = d.Value
		}

		switch evt.System.EventID {
		case 4625: // Failed login
			ip := dataMap["IpAddress"]
			if ip == "" || ip == "-" {
				ip = "local"
			}
			newFailedLogins[ip]++

		case 4624: // Successful login
			targetUser := strings.ToLower(dataMap["TargetUserName"])
			logonType := dataMap["LogonType"]
			if targetUser == "administrator" && (logonType == "2" || logonType == "10") {
				// Interactive or Remote Desktop login as Administrator
				newAdminLogins++
			}
		}
	}

	if latestTime != "" {
		p.lastEventTime = latestTime
	}

	// Update cumulative counts
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

	if newAdminLogins > 0 {
		fingerprint := fmt.Sprintf("admin_login:%d", time.Now().Unix()/300)
		events = append(events, SecurityEvent{
			Type:        "admin_login",
			Severity:    "medium",
			Message:     fmt.Sprintf("Administrator login detected: %d login(s)", newAdminLogins),
			Fingerprint: fingerprint,
			Data: map[string]string{
				"login_count": fmt.Sprintf("%d", newAdminLogins),
			},
		})
		log.Printf("🟡 AUTH ALERT: %d Administrator logins detected", newAdminLogins)
	}

	return events
}

func (p *WindowsPlatform) GenerateUpdateScript(binaryURL, currentBinary string) string {
	return fmt.Sprintf(`# Maintainer Agent Self-Update Script (Windows)
# IMPORTANT: ErrorActionPreference must be Continue, not Stop!
# The script must survive non-critical errors (e.g. Defender exclusions)
$ErrorActionPreference = "Continue"

$BinaryURL = "%s"
$CurrentBinary = "%s"
$LogFile = "$env:ProgramData\maintainer-agent\update.log"
$NewBinary = "$env:TEMP\maintainer-agent-new.exe"

function Write-Log($msg) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$ts] $msg"
    try { $line | Out-File -FilePath $LogFile -Append -Encoding utf8 } catch {}
    Write-Host $line
}

Write-Log "Maintainer Agent Update Started"
Write-Log "Binary URL: $BinaryURL"
Write-Log "Current binary: $CurrentBinary"
Write-Log "Running as: $([System.Security.Principal.WindowsIdentity]::GetCurrent().Name)"
Write-Log "PID: $PID"

# Wait for the agent to shut itself down gracefully.
# DO NOT call Stop-Service here! The agent already initiated its own
# shutdown. Calling Stop-Service from a child process causes a deadlock
# because the SCM waits for child processes to exit before completing
# the stop.
Write-Log "Waiting for agent to shut down gracefully..."
$waited = 0
while ($waited -lt 15) {
    $proc = Get-Process -Name maintainer-agent -ErrorAction SilentlyContinue
    if (-not $proc) {
        Write-Log "Agent process exited after $waited seconds"
        break
    }
    Start-Sleep -Seconds 1
    $waited++
}

# If still running after 15s, force kill as last resort
$proc = Get-Process -Name maintainer-agent -ErrorAction SilentlyContinue
if ($proc) {
    Write-Log "WARNING: Agent still running after 15s, force killing..."
    $proc | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

# Download new binary
Write-Log "Downloading new binary from $BinaryURL..."
try {
    # Add cache buster to avoid cached old version
    $timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $downloadURL = "${BinaryURL}?t=$timestamp"
    Invoke-WebRequest -Uri $downloadURL -UseBasicParsing -OutFile $NewBinary
    Write-Log "Download complete. Size: $((Get-Item $NewBinary).Length) bytes"
} catch {
    Write-Log "ERROR: Download failed: $_"
    Write-Log "Attempting to restart service with old binary..."
    Start-Service MaintainerAgent -ErrorAction SilentlyContinue
    exit 1
}

# Verify downloaded file
if (-not (Test-Path $NewBinary)) {
    Write-Log "ERROR: Downloaded binary not found!"
    Start-Service MaintainerAgent -ErrorAction SilentlyContinue
    exit 1
}

if ((Get-Item $NewBinary).Length -lt 1MB) {
    Write-Log "ERROR: Downloaded binary too small ($(Get-Item $NewBinary).Length) bytes - likely download error"
    Remove-Item $NewBinary -Force -ErrorAction SilentlyContinue
    Start-Service MaintainerAgent -ErrorAction SilentlyContinue
    exit 1
}

# Backup current binary
Write-Log "Creating backup of current binary..."
Copy-Item $CurrentBinary "${CurrentBinary}.backup" -Force -ErrorAction SilentlyContinue

# Replace binary
Write-Log "Replacing binary..."
try {
    Copy-Item $NewBinary $CurrentBinary -Force
    Write-Log "Binary replaced successfully"
} catch {
    Write-Log "ERROR: Failed to replace binary: $_"
    if (Test-Path "${CurrentBinary}.backup") {
        Write-Log "Restoring backup..."
        Copy-Item "${CurrentBinary}.backup" $CurrentBinary -Force
    }
    Start-Service MaintainerAgent -ErrorAction SilentlyContinue
    exit 1
}

# Add Windows Defender exclusions (best effort, don't fail on this)
Write-Log "Configuring Windows Defender exclusions..."
$InstallDir = Split-Path -Parent $CurrentBinary
try {
    Add-MpPreference -ExclusionProcess $CurrentBinary -ErrorAction SilentlyContinue
    Add-MpPreference -ExclusionPath $InstallDir -ErrorAction SilentlyContinue
    Write-Log "Windows Defender exclusions configured"
} catch {
    Write-Log "NOTE: Could not set Defender exclusions (non-critical): $($_.Exception.Message)"
}

# Start the service
Write-Log "Starting MaintainerAgent service..."
try {
    Start-Service MaintainerAgent -ErrorAction Stop
} catch {
    Write-Log "ERROR: Failed to start service: $($_.Exception.Message)"
    Write-Log "Retrying in 3 seconds..."
    Start-Sleep -Seconds 3
    try {
        Start-Service MaintainerAgent -ErrorAction Stop
    } catch {
        Write-Log "ERROR: Retry also failed: $($_.Exception.Message)"
    }
}

# Wait and verify service started
$started = $false
for ($i = 0; $i -lt 10; $i++) {
    Start-Sleep -Seconds 1
    $svc = Get-Service -Name MaintainerAgent -ErrorAction SilentlyContinue
    if ($svc -and $svc.Status -eq 'Running') {
        $started = $true
        break
    }
}

if ($started) {
    Write-Log "✅ Update successful! Service is running."
    Remove-Item "${CurrentBinary}.backup" -Force -ErrorAction SilentlyContinue
} else {
    $svcStatus = if ($svc) { $svc.Status } else { 'NOT FOUND' }
    Write-Log "⚠️ Service not running (status: $svcStatus), restoring backup..."
    if (Test-Path "${CurrentBinary}.backup") {
        Copy-Item "${CurrentBinary}.backup" $CurrentBinary -Force -ErrorAction SilentlyContinue
        Start-Service MaintainerAgent -ErrorAction SilentlyContinue
        Write-Log "Backup restored and service restarted"
    }
}

# Cleanup temporary files
Remove-Item $NewBinary -Force -ErrorAction SilentlyContinue

Write-Log "Update process complete!"
`, binaryURL, currentBinary)
}

func (p *WindowsPlatform) ShutdownSignals() []os.Signal {
	// On Windows only os.Interrupt (Ctrl-C) is reliably supported.
	return []os.Signal{os.Interrupt}
}

// ---------- internal helpers ----------

// pickWindowsShell returns the best available shell path.
// Prefers pwsh.exe (PowerShell 7+) → powershell.exe → cmd.exe
func pickWindowsShell() string {
	if path, err := exec.LookPath("pwsh.exe"); err == nil {
		return path
	}
	if path, err := exec.LookPath("powershell.exe"); err == nil {
		return path
	}
	return "cmd.exe"
}

// hostInfoResult holds OS info extracted on Windows
type hostInfoResult struct {
	distro  string
	release string
	kernel  string
}

func hostInfoFromGopsutil() (*hostInfoResult, error) {
	hi, err := host.Info()
	if err != nil {
		return nil, err
	}
	distro := hi.Platform
	if hi.PlatformFamily != "" {
		distro = hi.Platform + " " + hi.PlatformFamily
	}
	return &hostInfoResult{
		distro:  distro,
		release: hi.PlatformVersion,
		kernel:  hi.KernelVersion,
	}, nil
}

func hostInfoWindows() (*hostInfoResult, error) {
	// Try wmic first for a nicer display name
	cmd := exec.Command("wmic", "os", "get", "Caption,Version,BuildNumber", "/format:list")
	output, err := cmd.Output()
	if err != nil {
		return hostInfoFromGopsutil()
	}

	result := &hostInfoResult{}
	for _, line := range strings.Split(string(output), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "Caption=") {
			result.distro = strings.TrimPrefix(line, "Caption=")
		} else if strings.HasPrefix(line, "Version=") {
			result.release = strings.TrimPrefix(line, "Version=")
		} else if strings.HasPrefix(line, "BuildNumber=") {
			result.kernel = "Build " + strings.TrimPrefix(line, "BuildNumber=")
		}
	}
	if result.distro == "" {
		return hostInfoFromGopsutil()
	}
	return result, nil
}

// getWindowsServiceName maps common ports to service names on Windows
func getWindowsServiceName(port int) string {
	services := map[int]string{
		21: "FTP", 22: "SSH", 25: "SMTP", 53: "DNS",
		80: "HTTP", 135: "RPC", 139: "NetBIOS", 443: "HTTPS",
		445: "SMB", 1433: "MSSQL", 3306: "MySQL",
		3389: "RDP", 5432: "PostgreSQL", 5985: "WinRM HTTP",
		5986: "WinRM HTTPS", 8080: "HTTP Alt", 8443: "HTTPS Alt",
	}
	if name, ok := services[port]; ok {
		return name
	}
	return "Unknown"
}

// splitXMLEvents splits a string containing multiple <Event>...</Event> blocks
func splitXMLEvents(data string) []string {
	var events []string
	re := regexp.MustCompile(`(?s)<Event[^>]*>.*?</Event>`)
	matches := re.FindAllString(data, -1)
	events = append(events, matches...)
	return events
}

// ---------- Package scanners ----------

// collectRegistryInstalledPrograms reads installed software from the Windows
// Registry Uninstall keys — the same source "Apps & Features" / "Add/Remove
// Programs" uses. This captures MSI/EXE-installed software like browsers,
// runtimes, editors, etc. that wmic/choco/winget may not list.
func collectRegistryInstalledPrograms() ([]PackageInfo, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	shell := pickWindowsShell()
	if !strings.Contains(shell, "pwsh") && !strings.Contains(shell, "powershell") {
		return nil, fmt.Errorf("PowerShell not available for registry query")
	}

	// Query both 64-bit and 32-bit (WOW6432Node) Uninstall keys
	psScript := `
$paths = @(
  'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
Get-ItemProperty $paths -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName -ne $null -and $_.DisplayName -ne '' -and $_.SystemComponent -ne 1 } |
  Select-Object DisplayName, DisplayVersion, Publisher |
  Sort-Object DisplayName -Unique |
  ConvertTo-Json -Compress
`
	cmd := exec.CommandContext(ctx, shell, "-NoProfile", "-NonInteractive", "-Command", psScript)
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("registry query failed: %w", err)
	}

	output = []byte(strings.TrimSpace(string(output)))
	if len(output) == 0 {
		return nil, fmt.Errorf("registry query returned empty output")
	}

	type registryEntry struct {
		DisplayName    string `json:"DisplayName"`
		DisplayVersion string `json:"DisplayVersion"`
		Publisher      string `json:"Publisher"`
	}

	var entries []registryEntry
	if err := json.Unmarshal(output, &entries); err != nil {
		// PowerShell returns a single object (not array) when there's only one result
		var single registryEntry
		if err2 := json.Unmarshal(output, &single); err2 != nil {
			return nil, fmt.Errorf("failed to parse registry JSON: %w", err)
		}
		entries = []registryEntry{single}
	}

	var packages []PackageInfo
	for _, e := range entries {
		name := strings.TrimSpace(e.DisplayName)
		version := strings.TrimSpace(e.DisplayVersion)
		if name == "" {
			continue
		}
		if version == "" {
			version = "unknown"
		}

		// Normalise the package name for better CVE matching:
		// "Mozilla Firefox (x64 en-US)" → "firefox"
		// "Python 3.12.1 (64-bit)" → "python"
		normName := normalizeWindowsPackageName(name)

		packages = append(packages, PackageInfo{
			Name:    normName,
			Version: normalizeWindowsVersion(version),
			Manager: "registry",
			Status:  "installed",
		})
	}

	log.Printf("Registry: parsed %d installed programs", len(packages))
	return packages, nil
}

// normalizeWindowsPackageName strips architecture, language, and marketing
// suffixes to produce a clean lowercase name that can match CVE entries.
func normalizeWindowsPackageName(name string) string {
	// Strip common suffixes: (x64), (x86), (64-bit), (32-bit), version numbers in parens, language tags
	re := regexp.MustCompile(`(?i)\s*\((?:x64|x86|64-bit|32-bit|amd64|arm64|x64 [a-z]{2}-[a-z]{2}|[a-z]{2}-[a-z]{2})\)\s*`)
	name = re.ReplaceAllString(name, " ")

	// Strip trailing version numbers: "Python 3.12.1" → "Python"
	reTrailingVersion := regexp.MustCompile(`\s+[vV]?\d+[\d.]+.*$`)
	name = reTrailingVersion.ReplaceAllString(name, "")

	// Strip " - ..." suffixes: "Git - Fast Version Control" → "Git"
	if idx := strings.Index(name, " - "); idx > 0 {
		name = name[:idx]
	}

	name = strings.TrimSpace(name)

	// Map well-known display names to CVE-standard names
	knownMappings := map[string]string{
		"mozilla firefox":               "firefox",
		"firefox":                        "firefox",
		"google chrome":                  "google-chrome",
		"microsoft edge":                 "microsoft-edge",
		"microsoft edge webview2":        "microsoft-edge",
		"adobe acrobat reader":           "acrobat_reader_dc",
		"adobe acrobat reader dc":        "acrobat_reader_dc",
		"adobe acrobat":                  "acrobat",
		"vlc media player":               "vlc",
		"vlc":                            "vlc",
		"python":                         "python",
		"python launcher":                "python",
		"node.js":                        "node",
		"nodejs":                         "node",
		"java":                           "jdk",
		"java(tm) se development kit":    "jdk",
		"java(tm) se runtime environment": "jre",
		"openjdk":                        "openjdk",
		"git":                            "git",
		"openssh":                        "openssh",
		"openssl":                        "openssl",
		"7-zip":                          "7-zip",
		"7zip":                           "7-zip",
		"notepad++":                      "notepad++",
		"putty":                          "putty",
		"winscp":                         "winscp",
		"filezilla":                      "filezilla",
		"filezilla client":               "filezilla",
		"wireshark":                      "wireshark",
		"curl":                           "curl",
		"wget":                           "wget",
		"terraform":                      "terraform",
		"visual studio code":             "visual-studio-code",
		"microsoft visual c++ redistributable": "visual-c++-redistributable",
		"cmake":                          "cmake",
		"postgresql":                     "postgresql",
		"mysql":                          "mysql",
		"mariadb":                        "mariadb",
		"mongodb":                        "mongodb",
		"redis":                          "redis",
		"nginx":                          "nginx",
		"apache":                         "apache",
		"tomcat":                         "tomcat",
		"docker desktop":                 "docker",
	}

	lower := strings.ToLower(name)
	if mapped, ok := knownMappings[lower]; ok {
		return mapped
	}

	// Return lowercase trimmed name for matching
	return strings.ToLower(strings.TrimSpace(name))
}

// normalizeWindowsVersion cleans up version strings from the registry.
func normalizeWindowsVersion(version string) string {
	// Strip leading "v" or "V"
	version = strings.TrimPrefix(version, "v")
	version = strings.TrimPrefix(version, "V")
	version = strings.TrimSpace(version)
	if version == "" || version == "0" || version == "0.0" {
		return "unknown"
	}
	return version
}

func collectWindowsUpdatePackages() ([]PackageInfo, error) {
	// Add timeout context to prevent hanging
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	
	// Try wmic first (faster, but deprecated in newer Windows versions)
	cmd := exec.CommandContext(ctx, "wmic", "qfe", "list", "brief", "/format:csv")
	output, err := cmd.Output()
	
	// If wmic fails, try PowerShell Get-HotFix as fallback
	if err != nil {
		log.Printf("wmic failed (%v), trying PowerShell Get-HotFix...", err)
		return collectWindowsUpdateViaPowerShell()
	}

	var packages []PackageInfo
	scanner := bufio.NewScanner(strings.NewReader(string(output)))
	lineCount := 0
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "Node") {
			continue
		}
		// CSV format: Node,Description,FixComments,HotFixID,InstalledBy,InstalledOn
		fields := strings.Split(line, ",")
		if len(fields) < 4 {
			continue
		}
		hotfixID := strings.TrimSpace(fields[3])
		if hotfixID == "" || hotfixID == "HotFixID" {
			continue
		}
		lineCount++
		desc := strings.TrimSpace(fields[1])
		status := "installed"
		if strings.Contains(strings.ToLower(desc), "security") {
			status = "security_installed"
		}
		installedOn := ""
		if len(fields) > 5 {
			installedOn = strings.TrimSpace(fields[5])
		}
		packages = append(packages, PackageInfo{
			Name:    hotfixID,
			Version: installedOn, // Use install date as version
			Manager: "windows_update",
			Status:  status,
		})
	}
	
	if lineCount == 0 {
		log.Printf("wmic returned no data, trying PowerShell fallback...")
		return collectWindowsUpdateViaPowerShell()
	}
	
	return packages, nil
}

func collectWindowsUpdateViaPowerShell() ([]PackageInfo, error) {
	// Add timeout context to prevent hanging
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	
	shell := pickWindowsShell()
	var cmd *exec.Cmd
	if strings.Contains(shell, "pwsh") || strings.Contains(shell, "powershell") {
		cmd = exec.CommandContext(ctx, shell, "-NoProfile", "-NonInteractive", "-Command",
			"Get-HotFix | Select-Object -Property HotFixID,Description,InstalledOn | ConvertTo-Json")
	} else {
		return nil, fmt.Errorf("PowerShell not available")
	}
	
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("Get-HotFix failed: %w", err)
	}
	
	// Parse JSON output
	var hotfixes []struct {
		HotFixID    string `json:"HotFixID"`
		Description string `json:"Description"`
		InstalledOn string `json:"InstalledOn"`
	}
	
	if err := json.Unmarshal(output, &hotfixes); err != nil {
		// Try as single object (when only one hotfix is installed)
		var singleHotfix struct {
			HotFixID    string `json:"HotFixID"`
			Description string `json:"Description"`
			InstalledOn string `json:"InstalledOn"`
		}
		if err2 := json.Unmarshal(output, &singleHotfix); err2 == nil {
			hotfixes = []struct {
				HotFixID    string `json:"HotFixID"`
				Description string `json:"Description"`
				InstalledOn string `json:"InstalledOn"`
			}{singleHotfix}
		} else {
			return nil, fmt.Errorf("failed to parse Get-HotFix JSON: %w", err)
		}
	}
	
	var packages []PackageInfo
	for _, hf := range hotfixes {
		if hf.HotFixID == "" {
			continue
		}
		status := "installed"
		if strings.Contains(strings.ToLower(hf.Description), "security") {
			status = "security_installed"
		}
		packages = append(packages, PackageInfo{
			Name:    hf.HotFixID,
			Version: hf.InstalledOn,
			Manager: "windows_update",
			Status:  status,
		})
	}
	
	log.Printf("PowerShell Get-HotFix collected %d patches", len(packages))
	return packages, nil
}

func collectChocolateyPackages() ([]PackageInfo, int, error) {
	// Add timeout context to prevent hanging
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	
	// choco list --local-only --limit-output produces "name|version" lines
	cmd := exec.CommandContext(ctx, "choco", "list", "--local-only", "--limit-output")
	output, err := cmd.Output()
	if err != nil {
		return nil, 0, fmt.Errorf("choco list: %w", err)
	}

	var packages []PackageInfo
	for _, line := range strings.Split(string(output), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "|", 2)
		if len(parts) < 2 {
			continue
		}
		packages = append(packages, PackageInfo{
			Name:    parts[0],
			Version: parts[1],
			Manager: "choco",
			Status:  "installed",
		})
	}

	// Check for outdated packages with timeout
	updates := 0
	outdatedCtx, outdatedCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer outdatedCancel()
	
	outdatedCmd := exec.CommandContext(outdatedCtx, "choco", "outdated", "--limit-output")
	if outdatedOutput, err := outdatedCmd.Output(); err == nil {
		for _, line := range strings.Split(string(outdatedOutput), "\n") {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			// Format: name|currentVersion|availableVersion|pinned
			parts := strings.SplitN(line, "|", 4)
			if len(parts) < 3 {
				continue
			}
			updates++
			// Mark the matching package as having an update
			for i := range packages {
				if packages[i].Name == parts[0] {
					packages[i].Status = "update_available"
					break
				}
			}
		}
	}

	return packages, updates, nil
}

func collectWingetPackages() ([]PackageInfo, int, error) {
	// Add timeout context to prevent hanging
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	
	cmd := exec.CommandContext(ctx, "winget", "list", "--disable-interactivity",
		"--accept-source-agreements")
	output, err := cmd.Output()
	if err != nil {
		return nil, 0, fmt.Errorf("winget list: %w", err)
	}

	var packages []PackageInfo
	lines := strings.Split(string(output), "\n")

	// Find the header line to determine column positions
	headerIdx := -1
	for i, line := range lines {
		if strings.Contains(line, "Name") && strings.Contains(line, "Version") {
			headerIdx = i
			break
		}
	}
	if headerIdx < 0 || headerIdx+1 >= len(lines) {
		return packages, 0, nil
	}

	headerLine := lines[headerIdx]

	// Parse column positions from the header
	nameStart := strings.Index(headerLine, "Name")
	idCol := strings.Index(headerLine, "Id")
	versionCol := strings.Index(headerLine, "Version")

	// Find the separator line (dashes)
	sepIdx := headerIdx + 1
	if sepIdx < len(lines) && strings.Contains(lines[sepIdx], "---") {
		sepIdx++ // skip separator, data starts after
	}

	for _, line := range lines[sepIdx:] {
		// Don't trim — we need the exact column positions
		if strings.TrimSpace(line) == "" {
			continue
		}
		// Stop at summary lines
		if strings.Contains(line, "upgrades available") || strings.HasPrefix(strings.TrimSpace(line), "-") {
			break
		}

		var name, id, version string

		// Use column positions for precise extraction
		if idCol > 0 && versionCol > 0 && len(line) > versionCol {
			if nameStart >= 0 && idCol > nameStart {
				name = strings.TrimSpace(line[nameStart:minInt(idCol, len(line))])
			}
			id = strings.TrimSpace(line[idCol:minInt(versionCol, len(line))])
			versionPart := line[versionCol:]
			// Version ends at the next column or end of line
			versionFields := strings.Fields(versionPart)
			if len(versionFields) > 0 {
				version = versionFields[0]
			}
		} else {
			// Fallback: use fields
			fields := strings.Fields(line)
			if len(fields) < 2 {
				continue
			}
			name = strings.Join(fields[:len(fields)-1], " ")
			version = fields[len(fields)-1]
		}

		if name == "" || version == "" {
			continue
		}

		// Prefer the winget package ID (e.g. "Mozilla.Firefox") over display name
		pkgName := name
		if id != "" {
			pkgName = id
		}

		packages = append(packages, PackageInfo{
			Name:    pkgName,
			Version: version,
			Manager: "winget",
			Status:  "installed",
		})
	}

	// Check for upgrades with timeout
	updates := 0
	upgradeCtx, upgradeCancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer upgradeCancel()
	
	upgradeCmd := exec.CommandContext(upgradeCtx, "winget", "upgrade", "--disable-interactivity",
		"--accept-source-agreements", "--include-unknown")
	if upgradeOutput, err := upgradeCmd.Output(); err == nil {
		for _, line := range strings.Split(string(upgradeOutput), "\n") {
			if strings.Contains(line, "upgrades available") {
				// Parse "X upgrades available."
				re := regexp.MustCompile(`(\d+)\s+upgrades?\s+available`)
				if m := re.FindStringSubmatch(line); len(m) > 1 {
					fmt.Sscanf(m[1], "%d", &updates)
				}
			}
		}
	}

	return packages, updates, nil
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
