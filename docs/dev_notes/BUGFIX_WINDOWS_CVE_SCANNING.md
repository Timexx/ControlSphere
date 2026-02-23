# Bugfix: Windows Systems Not Detected in CVE Scanning

**Date:** 23. Februar 2026  
**Issue:** Windows systems were not being detected and checked during CVE scans. The security overview showed only 1 ecosystem instead of including Windows/.NET packages.

## Root Cause

The Windows package managers (`choco`, `winget`, `windows_update`) were being collected by the Windows agent but were **not mapped to any OSV ecosystem** in the server's `mapManagerToEcosystem()` function. This caused all Windows packages to be ignored during CVE matching.

### Package Collection (Agent Side) ✅
The Windows agent correctly collects packages from three sources:
1. **Windows Update patches** → `manager: "windows_update"` (KB numbers)
2. **Chocolatey** → `manager: "choco"`
3. **winget** → `manager: "winget"`

### Ecosystem Mapping (Server Side) ❌
The vulnerability scanner's `mapManagerToEcosystem()` function had no mappings for:
- `choco`
- `winget`  
- `windows_update`

Result: All Windows packages returned `undefined` ecosystem → skipped during CVE scan.

## Solution

Added Windows package manager mappings to the `mapManagerToEcosystem()` function in `/server/src/services/vulnerability-scanner.ts`:

```typescript
case 'choco':
case 'chocolatey':
case 'winget':
case 'nuget':
  return 'NuGet'
```

### Why NuGet?

- **NuGet** is the official .NET package ecosystem supported by OSV.dev
- Many Chocolatey and winget packages are .NET-based or overlap with NuGet packages
- NuGet is already in the `DEFAULT_ECOSYSTEMS` list for CVE mirroring
- This provides the best coverage for Windows application vulnerabilities

### Windows Update Limitation

Windows Update patches (`windows_update` manager) are **OS-level patches (KB numbers)** and do not have a corresponding OSV ecosystem. These will not be CVE-matched until:
1. OSV adds a Windows Update ecosystem, OR
2. We implement a separate Windows Update vulnerability source (e.g., Microsoft Security Response Center)

## Changes Made

### 1. Updated vulnerability-scanner.ts
**File:** `/server/src/services/vulnerability-scanner.ts`

Added mappings for `choco`, `chocolatey`, `winget`, and `nuget` to the NuGet ecosystem.

### 2. Updated Tests
**File:** `/server/src/services/vulnerability-scanner.test.ts`

Added test cases:
```typescript
expect(mapManagerToEcosystem('choco')).toBe('NuGet')
expect(mapManagerToEcosystem('winget')).toBe('NuGet')
expect(mapManagerToEcosystem('nuget')).toBe('NuGet')
expect(mapManagerToEcosystem('windows_update')).toBe(undefined) // OS-level, no ecosystem
```

## Expected Behavior After Fix

### Before Fix
- **Ecosystems detected:** 1 (only Linux/npm/etc)
- **CVEs scanned:** Only non-Windows packages
- **Windows packages:** Collected but ignored

### After Fix
- **Ecosystems detected:** 2+ (includes NuGet)
- **CVEs scanned:** Windows packages via NuGet ecosystem
- **Windows packages:** Chocolatey and winget packages now matched against NuGet CVE database

## Verification Steps

1. **Trigger CVE Sync:**
   - Navigate to Security Overview page
   - Click "CVE-Sync jetzt starten" / "Run CVE sync now"
   - Wait for sync to complete

2. **Check Ecosystem Count:**
   - Should now show at least 2 ecosystems (if Windows machines are present)
   - NuGet should appear in the ecosystem list

3. **Verify Package Detection:**
   - Navigate to a Windows machine's security detail page
   - Packages from Chocolatey/winget should appear in the package list
   - Vulnerability matches should now appear for known CVEs

4. **Check CVE Count:**
   - After sync, total CVE count should increase (NuGet has many CVEs)
   - Windows machines should show vulnerability matches if outdated packages exist

## Migration Notes

### For Existing Systems
- Existing Windows machines will automatically benefit from this fix
- Trigger a manual CVE sync to populate NuGet CVEs
- Next scheduled agent scan will match packages against the new CVE database

### Coverage Expectations
- ✅ **Full coverage:** Chocolatey packages that exist in NuGet
- ✅ **Full coverage:** winget packages that exist in NuGet
- ⚠️ **Partial coverage:** Chocolatey/winget packages not in NuGet (non-.NET software)
- ❌ **No coverage:** Windows Update patches (KB numbers) - requires future enhancement

## Related Files
- `/server/src/services/vulnerability-scanner.ts` - Ecosystem mapping logic
- `/server/src/services/vulnerability-scanner.test.ts` - Tests
- `/server/src/services/cve-mirror.ts` - CVE sync service (NuGet already in DEFAULT_ECOSYSTEMS)
- `/agent/platform/platform_windows.go` - Windows package collection

## Future Enhancements

1. **Windows Update CVE Matching**
   - Implement Microsoft Security Response Center (MSRC) API integration
   - Map KB patch numbers to CVE IDs
   - Add separate Windows Update vulnerability source

2. **Improved Package Manager Coverage**
   - Consider adding Scoop package manager support
   - Evaluate Winget manifest matching for better accuracy
   - Track non-NuGet packages separately

3. **Ecosystem Expansion**
   - Monitor OSV.dev for Windows-specific ecosystem additions
   - Evaluate alternative vulnerability databases for Windows

## Testing

Run vulnerability scanner tests:
```bash
cd server
npm test -- src/services/vulnerability-scanner.test.ts
```

All tests should pass, including new Windows manager mappings.

---

**Status:** ✅ Fixed  
**Impact:** High - Windows systems now participate in CVE scanning  
**Risk:** Low - Only adds new mappings, doesn't change existing behavior
