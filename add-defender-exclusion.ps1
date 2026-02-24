#Requires -RunAsAdministrator
# Maintainer Agent - Windows Defender Exclusion Tool
# This script adds the Maintainer Agent to Windows Defender exclusion list

$ErrorActionPreference = "Stop"

Write-Host "============================================" -ForegroundColor Green
Write-Host " Windows Defender Exclusion Tool           " -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""

$AgentPath = "$env:ProgramData\maintainer-agent\maintainer-agent.exe"
$InstallDir = "$env:ProgramData\maintainer-agent"

# Check if agent exists
if (-not (Test-Path $AgentPath)) {
    Write-Host "ERROR: Agent not found at $AgentPath" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please ensure the agent is installed first." -ForegroundColor Yellow
    exit 1
}

Write-Host "Agent found at: $AgentPath" -ForegroundColor Cyan
Write-Host ""

# Add exclusions
Write-Host "Adding Windows Defender exclusions..." -ForegroundColor Yellow

try {
    # Add process exclusion
    Add-MpPreference -ExclusionProcess $AgentPath -ErrorAction Stop
    Write-Host "  ✓ Process exclusion added: $AgentPath" -ForegroundColor Green
} catch {
    Write-Host "  ⚠ Could not add process exclusion: $_" -ForegroundColor Yellow
}

try {
    # Add path exclusion
    Add-MpPreference -ExclusionPath $InstallDir -ErrorAction Stop
    Write-Host "  ✓ Path exclusion added: $InstallDir" -ForegroundColor Green
} catch {
    Write-Host "  ⚠ Could not add path exclusion: $_" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host " Verification                               " -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""

# Verify exclusions
Write-Host "Current Exclusion Paths:" -ForegroundColor Cyan
$paths = Get-MpPreference | Select-Object -ExpandProperty ExclusionPath
if ($paths -contains $InstallDir) {
    Write-Host "  ✓ $InstallDir" -ForegroundColor Green
} else {
    Write-Host "  ✗ $InstallDir (NOT FOUND)" -ForegroundColor Red
}

Write-Host ""
Write-Host "Current Exclusion Processes:" -ForegroundColor Cyan
$processes = Get-MpPreference | Select-Object -ExpandProperty ExclusionProcess
if ($processes -contains $AgentPath) {
    Write-Host "  ✓ $AgentPath" -ForegroundColor Green
} else {
    Write-Host "  ✗ $AgentPath (NOT FOUND)" -ForegroundColor Red
}

Write-Host ""
Write-Host "Done! You can now restart the service:" -ForegroundColor Cyan
Write-Host "  Restart-Service MaintainerAgent" -ForegroundColor Gray
Write-Host ""
