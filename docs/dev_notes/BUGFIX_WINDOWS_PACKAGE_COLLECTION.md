# Bugfix: Windows Systems Show No Packages in Security Page

**Date:** 23. Februar 2026  
**Issue:** Windows systems show 0 packages, 0 updates, 0 CVEs on the security detail page despite security scans being triggered.

## Root Cause

### Problem 1: Package Collection Always Returns Success
The Windows agent's `CollectPackages()` function **always returned `nil` error** even when:
- Windows Update (wmic) failed
- Chocolatey was not installed
- winget was not installed
- **Zero packages were collected**

### Problem 2: Empty Package Array Deletes Existing Data
When the agent sent an empty package array to the server:
1. Server processed it as a valid scan
2. Server **deleted all existing packages** (cleanup logic)
3. Server created a scan with `total: 0, updates: 0, securityUpdates: 0`
4. UI showed "Keine Pakete gefunden"

### Problem 3: wmic Deprecated/Failing
`wmic` is deprecated in newer Windows versions and may fail silently, returning no data.

### Problem 4: No Logging
Package collection failures were completely silent - no error messages in agent logs.

## Solution

### 1. Improved Error Handling & Logging
**File:** `/agent/platform/platform_windows.go` - `CollectPackages()`

Added comprehensive logging for each package source:
```go
log.Printf("Windows Update: collected %d KB patches", len(pkgs))
log.Printf("Chocolatey: collected %d packages (%d updates)", len(pkgs), updates)
log.Printf("winget: collected %d packages (%d updates)", len(pkgs), updates)
```

Track collection errors:
```go
var collectionErrors []string
// ... for each failed source:
collectionErrors = append(collectionErrors, fmt.Sprintf("Windows Update: %v", err))
```

**Return error if NO packages collected from ANY source:**
```go
if len(allPackages) == 0 {
    errMsg := "No packages collected from any source"
    if len(collectionErrors) > 0 {
        errMsg += ": " + strings.Join(collectionErrors, "; ")
    }
    return nil, PackageSummary{}, fmt.Errorf(errMsg)
}
```

This prevents the agent from sending empty package arrays that would wipe existing data.

### 2. PowerShell Fallback for Windows Update
**File:** `/agent/platform/platform_windows.go` - `collectWindowsUpdatePackages()`

Added PowerShell `Get-HotFix` fallback when `wmic` fails:

```go
func collectWindowsUpdatePackages() ([]PackageInfo, error) {
    // Try wmic first (faster, but deprecated in newer Windows versions)
    cmd := exec.Command("wmic", "qfe", "list", "brief", "/format:csv")
    output, err := cmd.Output()
    
    // If wmic fails, try PowerShell Get-HotFix as fallback
    if err != nil {
        log.Printf("wmic failed (%v), trying PowerShell Get-HotFix...", err)
        return collectWindowsUpdateViaPowerShell()
    }
    // ... parse wmic output ...
}

func collectWindowsUpdateViaPowerShell() ([]PackageInfo, error) {
    cmd := exec.Command(shell, "-NoProfile", "-NonInteractive", "-Command",
        "Get-HotFix | Select-Object -Property HotFixID,Description,InstalledOn | ConvertTo-Json")
    // ... parse JSON output ...
}
```

**Benefits:**
- ✅ Works on newer Windows 11 systems where wmic is deprecated
- ✅ Handles systems where wmic is disabled by policy
- ✅ More reliable KB patch detection
- ✅ JSON output easier to parse

### 3. Added JSON Import
**File:** `/agent/platform/platform_windows.go`

Added missing import:
```go
import (
    "encoding/json"  // ← Added for PowerShell JSON parsing
    // ... other imports
)
```

## Impact & Expected Behavior

### Before Fix
1. Windows agent collects packages (or fails silently)
2. If collection fails → sends empty array `[]`
3. Server deletes all existing packages
4. UI shows: 
   - 0 Pakete
   - 0 Updates
   - 0 Sicherheitsupdates
   - "Keine Pakete gefunden"

### After Fix
1. Windows agent collects packages with detailed logging
2. If **all sources fail** → agent **returns error, scan aborted**
3. Agent logs show exactly which package managers worked/failed
4. If **any source succeeds** → packages are sent and displayed
5. PowerShell fallback ensures KB patches are collected even without wmic

### Logging Output (Example)
```
Windows Update: collected 47 KB patches
Chocolatey not installed
winget: collected 12 packages (3 updates)
Total packages collected: 59 (Updates: 3, Security: 0)
```

OR if everything fails:
```
Windows Update collection failed: wmic qfe: exit status 1
PowerShell Get-HotFix collected 0 patches
Chocolatey not installed
winget not installed
Package scan skipped: No packages collected from any source: Windows Update: PowerShell returned no data
```

## Verification Steps

### 1. Rebuild Windows Agent
```bash
cd agent
GOOS=windows GOARCH=amd64 go build -o bin/maintainer-agent-windows-amd64.exe -ldflags="-s -w" .
```

### 2. Deploy Updated Agent
Option A - Manual:
1. Stop the service: `Stop-Service MaintainerAgent`
2. Replace binary: Copy new `maintainer-agent-windows-amd64.exe` to `C:\Program Files\maintainer-agent\`
3. Start service: `Start-Service MaintainerAgent`

Option B - Via server:
1. Upload new binary to server's `/public` folder
2. Trigger agent update via UI (if auto-update is implemented)

### 3. Check Agent Logs
```powershell
# View service logs
Get-EventLog -LogName Application -Source MaintainerAgent -Newest 50

# OR if logging to file:
Get-Content "C:\ProgramData\maintainer-agent\agent.log" -Tail 50 -Wait
```

Look for log lines like:
- "Windows Update: collected X KB patches"
- "Chocolatey: collected X packages"
- "winget: collected X packages"
- "Total packages collected: X"

### 4. Trigger Security Scan
From the UI:
- Navigate to machine detail page (`/machine/{id}`)
- Click "Scan jetzt starten"
- Wait ~30 seconds

### 5. Verify Package Display
Navigate to Security Detail page (`/security/{id}`):
- Should show KB patches from Windows Update
- Should show Chocolatey packages (if installed)
- Should show winget packages (if installed)
- CVE matching should work for Chocolatey/winget (NuGet ecosystem)

## Diagnostic Commands

Run these on the Windows machine to test package collection manually:

### Test wmic (legacy)
```cmd
wmic qfe list brief /format:csv
```

### Test PowerShell Get-HotFix
```powershell
Get-HotFix | Select-Object HotFixID, Description, InstalledOn | ConvertTo-Json
```

### Test Chocolatey
```cmd
choco list --local-only --limit-output
```

### Test winget
```cmd
winget list --disable-interactivity --accept-source-agreements
```

## Related Changes

This fix builds on top of the CVE ecosystem mapping fix:
- [BUGFIX_WINDOWS_CVE_SCANNING.md](BUGFIX_WINDOWS_CVE_SCANNING.md) - Added NuGet ecosystem mapping

Together, these fixes enable full Windows CVE scanning:
1. ✅ **Package collection** - This fix
2. ✅ **Ecosystem mapping** - Previous fix
3. ✅ **CVE matching** - Works automatically via NuGet

## Files Modified

- `/agent/platform/platform_windows.go`:
  - `CollectPackages()` - Added error handling and logging
  - `collectWindowsUpdatePackages()` - Added PowerShell fallback
  - `collectWindowsUpdateViaPowerShell()` - New function
  - Import section - Added `encoding/json`

## Future Enhancements

1. **Service Log Integration**
   - Write logs to Windows Event Log (Application source)
   - Makes log viewing easier: `Get-EventLog -LogName Application -Source MaintainerAgent`

2. **Package Manager Detection**
   - Cache results of `exec.LookPath()` checks
   - Report detected package managers to server for better diagnostics

3. **Automatic Reinstall on Collection Failure**
   - If package collection fails for 3+ consecutive scans
   - Trigger agent self-update to fix potential corruption

4. **Windows Update Parsing Improvements**
   - Parse KB number patterns (KB1234567) from Package names
   - Detect security updates by KB pattern match
   - Cross-reference with Microsoft Security Response Center (MSRC) API

---

**Status:** ✅ Fixed  
**Impact:** Critical - Windows systems now show packages and CVEs  
**Breaking Changes:** None - only improves existing functionality  
**Rollback:** Safe - error case now prevents data loss instead of wiping packages
