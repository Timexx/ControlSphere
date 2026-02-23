// Package platform provides an OS-abstraction layer for the Maintainer Agent.
// Each supported operating system implements the Platform interface with its
// own files (platform_linux.go, platform_windows.go, …). The active
// implementation is selected at compile time via Go build tags.
package platform

import (
	"os"
	"os/exec"
)

// Terminal represents an interactive pseudo-terminal session.
// On Linux this wraps a PTY (*os.File), on Windows a ConPTY handle.
type Terminal interface {
	// Read reads output from the terminal.
	Read(p []byte) (n int, err error)
	// Write sends input to the terminal.
	Write(p []byte) (n int, err error)
	// Resize changes the terminal dimensions.
	Resize(cols, rows int) error
	// Close terminates the terminal session.
	Close() error
}

// Port describes a listening network port.
type Port struct {
	Port    int    `json:"port"`
	Proto   string `json:"proto"`
	Service string `json:"service"`
	State   string `json:"state"`
}

// OSInfo describes the operating system of the host.
type OSInfo struct {
	Distro  string `json:"distro"`
	Release string `json:"release"`
	Kernel  string `json:"kernel"`
}

// PackageInfo describes an installed software package.
type PackageInfo struct {
	Name    string   `json:"name"`
	Version string   `json:"version"`
	Manager string   `json:"manager,omitempty"`
	Status  string   `json:"status,omitempty"`
	CveIds  []string `json:"cveIds,omitempty"`
}

// PackageSummary summarises a package scan result.
type PackageSummary struct {
	Total           int `json:"total"`
	Updates         int `json:"updates"`
	SecurityUpdates int `json:"securityUpdates"`
}

// SecurityFinding represents a config drift or integrity issue.
type SecurityFinding struct {
	TargetPath string `json:"targetPath"`
	Message    string `json:"message"`
	Severity   string `json:"severity"`
	Expected   string `json:"expected,omitempty"`
	Actual     string `json:"actual,omitempty"`
	Hash       string `json:"hash,omitempty"`
}

// SecurityEvent represents a general security event such as a failed login.
type SecurityEvent struct {
	Type        string            `json:"type"`
	Severity    string            `json:"severity"`
	Message     string            `json:"message"`
	Data        map[string]string `json:"data,omitempty"`
	Fingerprint string            `json:"fingerprint,omitempty"`
}

// Platform is the main interface that each OS must implement.
type Platform interface {
	// ---------- Identity & paths ----------

	// ConfigPath returns the default agent configuration file path.
	ConfigPath() string

	// RuntimePlatform returns the platform identifier ("linux", "windows", …).
	RuntimePlatform() string

	// ---------- Terminal ----------

	// SpawnTerminal starts an interactive shell session and returns a Terminal.
	SpawnTerminal() (Terminal, error)

	// ---------- Command execution ----------

	// ShellCommand returns the command + args used to evaluate a single shell
	// expression, e.g. []string{"/bin/bash", "-c"} for Linux or
	// []string{"powershell.exe", "-Command"} for Windows.
	ShellCommand() []string

	// BackgroundExecCommand returns an *exec.Cmd that runs a command completely
	// detached so it survives the agent process (used for self-update).
	BackgroundExecCommand(scriptPath string) *exec.Cmd

	// DangerousCommands returns glob-like patterns for commands that should be
	// flagged as dangerous (reboot, shutdown, etc.).
	DangerousCommands() []string

	// ---------- OS info ----------

	// GetOSInfo returns operating system identification data.
	GetOSInfo() OSInfo

	// GetOutboundIP returns the primary outbound IP address of the host.
	GetOutboundIP() string

	// ---------- Metrics ----------

	// RootDiskPath returns the disk path used for the primary partition metric
	// (e.g. "/" on Linux, "C:\\" on Windows).
	RootDiskPath() string

	// ---------- Networking ----------

	// CollectPorts returns currently listening TCP/UDP ports.
	CollectPorts() []Port

	// ---------- Packages ----------

	// CollectPackages enumerates installed packages and available updates.
	CollectPackages() ([]PackageInfo, PackageSummary, error)

	// ---------- Security monitoring ----------

	// CriticalFiles returns a list of file paths whose integrity should be
	// monitored for unexpected changes.
	CriticalFiles() []string

	// IntegrityRoots returns root directories to walk for file integrity
	// monitoring.
	IntegrityRoots() []string

	// IntegritySkipDirs returns directories that should be skipped during
	// filesystem integrity walks (procfs, sysfs, etc.).
	IntegritySkipDirs() map[string]bool

	// ConfigExpectations returns per-file expected key-value pairs used to
	// detect configuration drift (e.g. sshd_config settings).
	ConfigExpectations() map[string]map[string]string

	// CheckAuthLogIncremental reads new entries from OS auth/security logs and
	// returns security events. The implementation is responsible for tracking
	// its own read position across calls.
	//
	// failedLoginCounts is a shared map tracking cumulative per-IP failed login
	// counts — the implementation must update it and use it for threshold
	// alerting.
	CheckAuthLogIncremental(failedLoginCounts map[string]int) []SecurityEvent

	// ---------- Self-update ----------

	// GenerateUpdateScript returns a shell script (bash or PowerShell) that
	// performs an out-of-process agent update: stop service → rebuild → replace
	// binary → restart service.
	GenerateUpdateScript(sourceURL, currentBinary string) string

	// ---------- Signal handling ----------

	// ShutdownSignals returns the OS signals the agent should listen for in
	// order to perform a graceful shutdown.
	ShutdownSignals() []os.Signal
}

// Current is the active Platform implementation, set by OS-specific init()
// functions in platform_linux.go / platform_windows.go.
var Current Platform
