//go:build windows
// +build windows

package main

import (
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime/debug"
	"time"

	"github.com/maintainer/agent/platform"
	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/eventlog"
	"golang.org/x/sys/windows/svc/mgr"
)

const serviceName = "MaintainerAgent"
const serviceDisplayName = "Maintainer Monitoring Agent"
const serviceDescription = "Monitors system health, security, and packages for the Maintainer dashboard."

// maintainerService implements svc.Handler.
type maintainerService struct {
	stopCh chan struct{}
}

// Execute is the main service entry point called by the Windows SCM.
func (s *maintainerService) Execute(args []string, r <-chan svc.ChangeRequest, changes chan<- svc.Status) (ssec bool, errno uint32) {
	const cmdsAccepted = svc.AcceptStop | svc.AcceptShutdown

	changes <- svc.Status{State: svc.StartPending}
	log.Println("Service Execute: state = StartPending")

	// Start the agent in a goroutine with panic recovery
	s.stopCh = make(chan struct{})
	agentDone := make(chan struct{})
	go func() {
		defer close(agentDone)
		defer func() {
			if r := recover(); r != nil {
				log.Printf("FATAL: runAgent panicked: %v\n%s", r, debug.Stack())
			}
		}()
		log.Println("Service Execute: calling runAgent()")
		runAgent()
		log.Println("Service Execute: runAgent() returned")
	}()

	changes <- svc.Status{State: svc.Running, Accepts: cmdsAccepted}
	log.Println("Service Execute: state = Running")

	for {
		select {
		case c := <-r:
			switch c.Cmd {
			case svc.Interrogate:
				changes <- c.CurrentStatus
				time.Sleep(100 * time.Millisecond)
				changes <- c.CurrentStatus
			case svc.Stop, svc.Shutdown:
				log.Println("Service stop/shutdown requested")
				changes <- svc.Status{State: svc.StopPending}
				close(s.stopCh)
				return
			default:
				log.Printf("Unexpected service control request #%d", c)
			}
		case <-agentDone:
			// runAgent exited unexpectedly (panic, fatal, etc.)
			log.Println("WARNING: runAgent goroutine exited — service will stop")
			changes <- svc.Status{State: svc.StopPending}
			return false, 1
		case <-s.stopCh:
			return
		}
	}
}

// runAsService detects whether we're running as a Windows Service and, if so,
// dispatches into the SCM handler. Returns true if service mode was detected.
func runAsService() bool {
	isService, err := svc.IsWindowsService()
	if err != nil {
		log.Printf("Failed to check if running as service: %v", err)
		return false
	}
	if !isService {
		return false
	}

	// --- Set up logging BEFORE anything else ---
	// Always write to a log file (Event Log may fail, and stderr is nowhere for services)
	pd := os.Getenv("ProgramData")
	if pd == "" {
		pd = `C:\ProgramData`
	}
	logDir := filepath.Join(pd, "maintainer-agent")
	if mkErr := os.MkdirAll(logDir, 0755); mkErr != nil {
		// Last resort: try writing next to the executable
		if exePath, exeErr := os.Executable(); exeErr == nil {
			logDir = filepath.Dir(exePath)
		}
	}
	logPath := filepath.Join(logDir, "agent.log")

	// Rotate log if it exceeds 10 MB to prevent unbounded growth
	if info, statErr := os.Stat(logPath); statErr == nil && info.Size() > 10*1024*1024 {
		oldLog := logPath + ".old"
		os.Remove(oldLog)          // remove previous rotation
		os.Rename(logPath, oldLog) // current → .old
	}

	var writers []io.Writer

	logFile, fileErr := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if fileErr == nil {
		writers = append(writers, logFile)
	}

	elog, elogErr := eventlog.Open(serviceName)
	if elogErr == nil {
		writers = append(writers, &eventLogWriter{elog: elog})
	}

	if len(writers) > 0 {
		log.SetOutput(io.MultiWriter(writers...))
	}

	log.Printf("=== Maintainer Agent Service Starting (PID %d) ===", os.Getpid())
	log.Printf("Log file: %s", logPath)
	if fileErr != nil {
		log.Printf("WARNING: could not open log file: %v", fileErr)
	}
	if elogErr != nil {
		log.Printf("WARNING: could not open Event Log: %v", elogErr)
	}

	err = svc.Run(serviceName, &maintainerService{})

	log.Println("=== Maintainer Agent Service Stopped ===")

	if elog != nil {
		elog.Close()
	}
	if logFile != nil {
		logFile.Close()
	}

	if err != nil {
		log.Fatalf("Service run failed: %v", err)
	}
	return true
}

// eventLogWriter adapts Windows Event Log to io.Writer for log.SetOutput.
type eventLogWriter struct {
	elog *eventlog.Log
}

func (w *eventLogWriter) Write(p []byte) (n int, err error) {
	err = w.elog.Info(1, string(p))
	if err != nil {
		return 0, err
	}
	return len(p), nil
}

// installService registers the agent as a Windows Service.
func installService() error {
	exePath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("cannot find executable path: %w", err)
	}
	exePath, err = filepath.Abs(exePath)
	if err != nil {
		return fmt.Errorf("cannot resolve executable path: %w", err)
	}

	m, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("cannot connect to service manager: %w", err)
	}
	defer m.Disconnect()

	// Determine config path to pass as service argument
	configPath := platform.Current.ConfigPath()

	// If service already exists, remove it first (upgrade scenario)
	if existing, openErr := m.OpenService(serviceName); openErr == nil {
		fmt.Println("Service already exists — removing for reinstall...")
		
		// Try to stop the service (ignore error if already stopped)
		if _, err := existing.Control(svc.Stop); err != nil {
			fmt.Printf("Note: Could not stop service (may already be stopped): %v\n", err)
		}
		time.Sleep(2 * time.Second)
		
		// Delete the service
		if err := existing.Delete(); err != nil {
			existing.Close()
			return fmt.Errorf("failed to delete existing service: %w", err)
		}
		existing.Close()
		
		// Remove event log source (ignore error if doesn't exist)
		if err := eventlog.Remove(serviceName); err != nil {
			fmt.Printf("Note: Could not remove event log source: %v\n", err)
		}
		time.Sleep(1 * time.Second)
		fmt.Println("Existing service removed")
	}

	s, err := m.CreateService(serviceName, exePath, mgr.Config{
		DisplayName:  serviceDisplayName,
		Description:  serviceDescription,
		StartType:    mgr.StartAutomatic,
		Dependencies: []string{"Tcpip", "Dnscache"},
	}, "-config", configPath)
	if err != nil {
		return fmt.Errorf("cannot create service: %w", err)
	}
	defer s.Close()

	// Configure service recovery: restart after failures
	if recErr := s.SetRecoveryActions([]mgr.RecoveryAction{
		{Type: mgr.ServiceRestart, Delay: 5 * time.Second},
		{Type: mgr.ServiceRestart, Delay: 10 * time.Second},
		{Type: mgr.ServiceRestart, Delay: 30 * time.Second},
	}, uint32(86400)); recErr != nil { // Reset failure count after 24h
		log.Printf("Warning: could not set recovery actions: %v", recErr)
	}

	// Set up the event log source (ignore error if already exists)
	err = eventlog.InstallAsEventCreate(serviceName, eventlog.Error|eventlog.Warning|eventlog.Info)
	if err != nil {
		fmt.Printf("Note: Event log source setup: %v (may already exist)\n", err)
	}

	// Add Windows Defender exclusions via PowerShell
	fmt.Println("Configuring Windows Defender exclusions...")
	installDir := filepath.Dir(exePath)
	
	// Build PowerShell command to add exclusions
	psCmd := fmt.Sprintf(`Add-MpPreference -ExclusionProcess '%s' -ErrorAction SilentlyContinue; Add-MpPreference -ExclusionPath '%s' -ErrorAction SilentlyContinue`, 
		exePath, installDir)
	
	cmd := exec.Command("powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", psCmd)
	if psErr := cmd.Run(); psErr != nil {
		fmt.Printf("Note: Could not add Windows Defender exclusions: %v\n", psErr)
		fmt.Printf("You may need to add exclusions manually:\n")
		fmt.Printf("  Add-MpPreference -ExclusionPath '%s'\n", installDir)
	} else {
		fmt.Println("✓ Windows Defender exclusions configured")
	}

	fmt.Printf("Service %s installed successfully\n", serviceName)
	return nil
}

// uninstallService removes the Windows Service registration.
func uninstallService() error {
	m, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("cannot connect to service manager: %w", err)
	}
	defer m.Disconnect()

	s, err := m.OpenService(serviceName)
	if err != nil {
		return fmt.Errorf("service %s is not installed: %w", serviceName, err)
	}
	defer s.Close()

	err = s.Delete()
	if err != nil {
		return fmt.Errorf("cannot delete service: %w", err)
	}

	err = eventlog.Remove(serviceName)
	if err != nil {
		log.Printf("Warning: failed to remove event log source: %v", err)
	}

	log.Printf("Service %s uninstalled successfully", serviceName)
	return nil
}
