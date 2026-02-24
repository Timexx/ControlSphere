#Requires -RunAsAdministrator
# Maintainer Agent - Service Diagnose Tool
# Analysiert warum der Agent nach Reboot nicht startet

$ErrorActionPreference = "Continue"

Write-Host "============================================" -ForegroundColor Green
Write-Host " Maintainer Agent Service Diagnose         " -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""

$AgentPath = "$env:ProgramData\maintainer-agent\maintainer-agent.exe"
$ConfigPath = "$env:ProgramData\maintainer-agent\config.json"
$LogPath = "$env:ProgramData\maintainer-agent\agent.log"

# 1. Binary vorhanden?
Write-Host "[1/6] Checking Agent Binary..." -ForegroundColor Cyan
if (Test-Path $AgentPath) {
    $size = (Get-Item $AgentPath).Length
    Write-Host "  ✓ Agent binary found: $AgentPath ($size bytes)" -ForegroundColor Green
} else {
    Write-Host "  ✗ Agent binary NOT found at $AgentPath" -ForegroundColor Red
    exit 1
}

# 2. Config vorhanden?
Write-Host ""
Write-Host "[2/6] Checking Configuration..." -ForegroundColor Cyan
if (Test-Path $ConfigPath) {
    Write-Host "  ✓ Config file found: $ConfigPath" -ForegroundColor Green
    try {
        $config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
        Write-Host "    Server: $($config.server_url)" -ForegroundColor Gray
        Write-Host "    Key: $($config.secret_key.Substring(0,8))..." -ForegroundColor Gray
    } catch {
        Write-Host "  ⚠ Config file exists but cannot be parsed: $_" -ForegroundColor Yellow
    }
} else {
    Write-Host "  ✗ Config file NOT found at $ConfigPath" -ForegroundColor Red
}

# 3. Service registriert?
Write-Host ""
Write-Host "[3/6] Checking Service Registration..." -ForegroundColor Cyan
$svc = Get-Service -Name MaintainerAgent -ErrorAction SilentlyContinue
if ($svc) {
    Write-Host "  ✓ Service is registered" -ForegroundColor Green
    Write-Host "    Name: $($svc.Name)" -ForegroundColor Gray
    Write-Host "    Status: $($svc.Status)" -ForegroundColor Gray
    Write-Host "    StartType: $($svc.StartType)" -ForegroundColor Gray
    Write-Host "    DisplayName: $($svc.DisplayName)" -ForegroundColor Gray
    
    if ($svc.StartType -ne 'Automatic') {
        Write-Host "  ⚠ WARNING: StartType is $($svc.StartType), should be Automatic!" -ForegroundColor Yellow
        Write-Host "    Fixing..." -ForegroundColor Yellow
        Set-Service -Name MaintainerAgent -StartupType Automatic
        Write-Host "    ✓ Fixed: Set to Automatic" -ForegroundColor Green
    }
} else {
    Write-Host "  ✗ Service NOT registered!" -ForegroundColor Red
    Write-Host "    You need to reinstall the agent or run:" -ForegroundColor Yellow
    Write-Host "    $AgentPath -install -config $ConfigPath" -ForegroundColor Gray
    exit 1
}

# 4. Service Dependencies
Write-Host ""
Write-Host "[4/6] Checking Service Dependencies..." -ForegroundColor Cyan
$dependencies = (Get-Service MaintainerAgent).ServicesDependedOn
if ($dependencies.Count -gt 0) {
    foreach ($dep in $dependencies) {
        $depSvc = Get-Service $dep.Name -ErrorAction SilentlyContinue
        if ($depSvc -and $depSvc.Status -eq 'Running') {
            Write-Host "  ✓ $($dep.Name): Running" -ForegroundColor Green
        } else {
            Write-Host "  ⚠ $($dep.Name): $($depSvc.Status)" -ForegroundColor Yellow
        }
    }
} else {
    Write-Host "  No dependencies configured" -ForegroundColor Gray
}

# 5. Recent Logs
Write-Host ""
Write-Host "[5/6] Checking Recent Logs..." -ForegroundColor Cyan
if (Test-Path $LogPath) {
    Write-Host "  Log file: $LogPath" -ForegroundColor Gray
    Write-Host "  --- Last 15 lines ---" -ForegroundColor Gray
    Get-Content $LogPath -Tail 15 | ForEach-Object {
        if ($_ -match "ERROR|FATAL|panic") {
            Write-Host "    $_" -ForegroundColor Red
        } elseif ($_ -match "WARN|WARNING") {
            Write-Host "    $_" -ForegroundColor Yellow
        } else {
            Write-Host "    $_" -ForegroundColor Gray
        }
    }
} else {
    Write-Host "  ⚠ No log file found yet" -ForegroundColor Yellow
}

# 6. Windows Event Log
Write-Host ""
Write-Host "[6/6] Checking Windows Event Log..." -ForegroundColor Cyan
$events = Get-WinEvent -LogName Application -FilterXPath '*[System[Provider[@Name="MaintainerAgent"]]]' -MaxEvents 5 -ErrorAction SilentlyContinue
if ($events) {
    foreach ($event in $events) {
        $level = switch ($event.Level) {
            1 { "CRITICAL"; "Red" }
            2 { "ERROR"; "Red" }
            3 { "WARNING"; "Yellow" }
            4 { "INFO"; "Green" }
            default { "UNKNOWN"; "Gray" }
        }
        Write-Host "  [$($event.TimeCreated.ToString('yyyy-MM-dd HH:mm:ss'))] $($level[0])" -ForegroundColor $level[1]
        Write-Host "    $($event.Message)" -ForegroundColor Gray
    }
} else {
    Write-Host "  No events found in Application log" -ForegroundColor Gray
}

# 7. Try to start manually
Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host " Manual Start Test                          " -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""

if ($svc.Status -ne 'Running') {
    Write-Host "Attempting to start service..." -ForegroundColor Yellow
    try {
        Start-Service MaintainerAgent -ErrorAction Stop
        Start-Sleep -Seconds 3
        
        $svc = Get-Service -Name MaintainerAgent
        if ($svc.Status -eq 'Running') {
            Write-Host "✓ Service started successfully!" -ForegroundColor Green
            Write-Host ""
            Write-Host "The service should now also start automatically after reboot." -ForegroundColor Cyan
        } else {
            Write-Host "✗ Service did not start. Status: $($svc.Status)" -ForegroundColor Red
            Write-Host ""
            Write-Host "Check the log file for errors:" -ForegroundColor Yellow
            Write-Host "  Get-Content $LogPath -Tail 30" -ForegroundColor Gray
        }
    } catch {
        Write-Host "✗ Failed to start service: $_" -ForegroundColor Red
        Write-Host ""
        Write-Host "Try running the agent manually to see the error:" -ForegroundColor Yellow
        Write-Host "  & '$AgentPath' -config '$ConfigPath'" -ForegroundColor Gray
    }
} else {
    Write-Host "✓ Service is already running!" -ForegroundColor Green
    Write-Host ""
    Write-Host "If it still doesn't start after reboot, check:" -ForegroundColor Cyan
    Write-Host "  1. StartType is Automatic (checked above)" -ForegroundColor Gray
    Write-Host "  2. Network is available before service starts" -ForegroundColor Gray
    Write-Host "  3. No crashes in the logs during startup" -ForegroundColor Gray
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host " Summary                                    " -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "Current Status: $($svc.Status)" -ForegroundColor $(if ($svc.Status -eq 'Running') { 'Green' } else { 'Red' })
Write-Host "StartType: $($svc.StartType)" -ForegroundColor $(if ($svc.StartType -eq 'Automatic') { 'Green' } else { 'Yellow' })
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. If service is running now, reboot to test auto-start" -ForegroundColor Gray
Write-Host "  2. After reboot, check: Get-Service MaintainerAgent" -ForegroundColor Gray
Write-Host "  3. If still not running, run this script again to see errors" -ForegroundColor Gray
Write-Host ""
