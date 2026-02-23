//go:build !windows
// +build !windows

package main

import "fmt"

// runAsService is a no-op on non-Windows platforms.
func runAsService() bool {
	return false
}

// installService is a no-op on non-Windows platforms.
func installService() error {
	return fmt.Errorf("service installation is only supported on Windows")
}

// uninstallService is a no-op on non-Windows platforms.
func uninstallService() error {
	return fmt.Errorf("service uninstallation is only supported on Windows")
}
