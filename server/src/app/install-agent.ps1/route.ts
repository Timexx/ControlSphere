import { NextResponse } from 'next/server'
import { networkInterfaces } from 'os'
import { prisma } from '@/lib/prisma'

// Prevent static generation — this route reads files from disk at runtime
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    let serverUrl: string

    // 1. Prefer admin-configured URL from DB
    const config = await prisma.serverConfig.findUnique({ where: { id: 'global' } })
    if (config?.serverUrl) {
      serverUrl = config.serverUrl.replace(/^https?:\/\//, '')
    } else {
      // 2. Fallback: auto-detect LAN IP
      const nets = networkInterfaces()
      let serverIp = 'localhost'
      for (const name of Object.keys(nets)) {
        const netInfo = nets[name]
        if (!netInfo) continue
        for (const net of netInfo) {
          const familyV4Value = typeof net.family === 'string' ? 'IPv4' : 4
          if (net.family === familyV4Value && !net.internal) {
            serverIp = net.address
            break
          }
        }
        if (serverIp !== 'localhost') break
      }
      serverUrl = `${serverIp}:${process.env.PORT || 3000}`
    }

    const installScript = `#Requires -RunAsAdministrator
# Maintainer Agent — Windows Installer
# Run in an elevated PowerShell: irm http://${serverUrl}/install-agent.ps1 | iex
$ErrorActionPreference = "Stop"

Write-Host "============================================" -ForegroundColor Green
Write-Host "  Maintainer Agent Installation (Windows)"   -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""

$ServerUrl  = "ws://${serverUrl}/ws/agent"
$InstallDir = "$env:ProgramData\\maintainer-agent"
$BinPath    = "$InstallDir\\maintainer-agent.exe"
$ConfigPath = "$InstallDir\\config.json"

# ---------- Check for existing install ----------
if (Test-Path $BinPath) {
    Write-Host "Existing agent detected — upgrading..." -ForegroundColor Yellow
    try { Stop-Service MaintainerAgent -ErrorAction SilentlyContinue } catch {}
    Start-Sleep -Seconds 2
}

# ---------- Create install directory ----------
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

# ---------- Generate secret key (preserve existing) ----------
$SecretKey = $null
if (Test-Path $ConfigPath) {
    try {
        $existingConfig = Get-Content $ConfigPath -Raw | ConvertFrom-Json
        if ($existingConfig.secret_key) {
            $SecretKey = $existingConfig.secret_key
            Write-Host "Preserving existing secret key." -ForegroundColor Yellow
        }
    } catch {}
}

if (-not $SecretKey) {
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $SecretKey = ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
}

Write-Host ""
Write-Host "Secret Key: $SecretKey" -ForegroundColor Green
Write-Host "IMPORTANT: Save this key!" -ForegroundColor Yellow
Write-Host ""

# ---------- Write config ----------
$configJson = @{
    server_url = $ServerUrl
    secret_key = $SecretKey
} | ConvertTo-Json
# Write WITHOUT BOM — Go's JSON parser cannot handle UTF-8 BOM
[System.IO.File]::WriteAllText($ConfigPath, $configJson)

# Restrict config ACL to SYSTEM + Administrators only (use SIDs for locale independence)
$acl = Get-Acl $ConfigPath
$acl.SetAccessRuleProtection($true, $false)
$sidSystem = New-Object System.Security.Principal.SecurityIdentifier("S-1-5-18")
$sidAdmins = New-Object System.Security.Principal.SecurityIdentifier("S-1-5-32-544")
$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($sidSystem,"FullControl","Allow")))
$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($sidAdmins,"FullControl","Allow")))
Set-Acl -Path $ConfigPath -AclObject $acl

# ---------- Download binary ----------
Write-Host "Downloading agent binary..." -ForegroundColor Green
$arch = if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq [System.Runtime.InteropServices.Architecture]::Arm64) { "arm64" } else { "amd64" }
$downloadUrl = "http://${serverUrl}/api/agent-download?os=windows&arch=$arch"

try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $downloadUrl -OutFile $BinPath -UseBasicParsing -ErrorAction Stop
    
    # Verify the download is a valid Windows PE binary
    $bytes = [System.IO.File]::ReadAllBytes($BinPath)
    if ($bytes.Length -lt 1024) {
        throw "Downloaded file is too small ($($bytes.Length) bytes)"
    }
    if ($bytes[0] -ne 0x4D -or $bytes[1] -ne 0x5A) {
        throw "Downloaded file is not a valid Windows executable (missing MZ header). The server may have served the wrong binary."
    }
} catch {
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Red
    Write-Host "  ERROR: Agent Binary Not Available        " -ForegroundColor Red
    Write-Host "============================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "Download failed: $_" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "The server has not built the agent binaries yet." -ForegroundColor Cyan
    Write-Host ""
    Write-Host "SOLUTION: SSH to the server and run ONE of these:" -ForegroundColor Green
    Write-Host ""
    Write-Host "  For Docker deployment:" -ForegroundColor White
    Write-Host "    cd /path/to/Maintainer" -ForegroundColor Gray
    Write-Host "    docker compose build --no-cache server" -ForegroundColor Gray
    Write-Host "    docker compose up -d" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  For native deployment:" -ForegroundColor White
    Write-Host "    cd /path/to/Maintainer/agent" -ForegroundColor Gray
    Write-Host "    ./build-agent.sh" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Then run this install script again." -ForegroundColor Cyan
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

# ---------- Install Windows Service ----------
Write-Host "Installing Windows Service..." -ForegroundColor Green

# Stop existing service if running
try { Stop-Service MaintainerAgent -Force -ErrorAction SilentlyContinue } catch {}
Start-Sleep -Seconds 2

try {
    $installOutput = & $BinPath -install -config $ConfigPath 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) {
        throw "Service installation failed with exit code $($LASTEXITCODE). Output: $installOutput"
    }
    Write-Host $installOutput -ForegroundColor Gray
} catch {
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Red
    Write-Host "  ERROR: Service Installation Failed"        -ForegroundColor Red  
    Write-Host "============================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "$_" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Try running manually:" -ForegroundColor Cyan
    Write-Host "  $BinPath -install -config $ConfigPath" -ForegroundColor Gray
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

# Start the service and verify it's running
Write-Host "Starting service..." -ForegroundColor Green
try {
    Start-Service MaintainerAgent -ErrorAction Stop
    
    # Wait up to 10 seconds for service to start
    $timeout = 10
    $elapsed = 0
    $started = $false
    
    while ($elapsed -lt $timeout) {
        Start-Sleep -Seconds 1
        $elapsed++
        $svcStatus = (Get-Service MaintainerAgent).Status
        
        if ($svcStatus -eq 'Running') {
            Write-Host "Service started successfully after $elapsed seconds" -ForegroundColor Green
            $started = $true
            break
        }
        
        Write-Host "  Waiting for service to start... ($elapsed/$timeout)" -ForegroundColor Gray
    }
    
    if (-not $started) {
        $svcStatus = (Get-Service MaintainerAgent).Status
        Write-Host ""
        Write-Host "WARNING: Service status is '$svcStatus' after $timeout seconds" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Troubleshooting steps:" -ForegroundColor Cyan
        Write-Host "  1. Check the log file: $InstallDir\\agent.log" -ForegroundColor Gray
        Write-Host "  2. Verify server URL is reachable: $ServerURL" -ForegroundColor Gray
        Write-Host "  3. Check Windows Event Viewer > Application logs" -ForegroundColor Gray
        Write-Host "  4. Try manual start: Start-Service MaintainerAgent" -ForegroundColor Gray
        Write-Host ""
        Write-Host "Recent log entries (if available):" -ForegroundColor Cyan
        if (Test-Path "$InstallDir\\agent.log") {
            Get-Content "$InstallDir\\agent.log" -Tail 20 -ErrorAction SilentlyContinue | ForEach-Object {
                Write-Host "  $_" -ForegroundColor Gray
            }
        }
        Write-Host ""
    }
} catch {
    Write-Host ""
    Write-Host "WARNING: Failed to start service: $_" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Troubleshooting steps:" -ForegroundColor Cyan
    Write-Host "  1. Check the log file: $InstallDir\\agent.log" -ForegroundColor Gray
    Write-Host "  2. Verify server URL is reachable: $ServerURL" -ForegroundColor Gray
    Write-Host "  3. Check Windows Event Viewer > Application logs" -ForegroundColor Gray
    Write-Host "  4. Run PowerShell as Administrator" -ForegroundColor Gray
    Write-Host ""
    if (Test-Path "$InstallDir\\agent.log") {
        Write-Host "Recent log entries:" -ForegroundColor Cyan
        Get-Content "$InstallDir\\agent.log" -Tail 20 -ErrorAction SilentlyContinue | ForEach-Object {
            Write-Host "  $_" -ForegroundColor Gray
        }
    }
    Write-Host ""
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  Installation Complete!                    " -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "Secret Key: $SecretKey" -ForegroundColor Yellow
Write-Host ""
Write-Host "Useful commands:" -ForegroundColor Cyan
Write-Host "  Get-Service MaintainerAgent                         # Check status"
Write-Host "  Restart-Service MaintainerAgent                     # Restart"
Write-Host "  Get-Content $ConfigPath                             # View config"
Write-Host ""
`

    return new NextResponse(installScript, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
      },
    })
  } catch (error) {
    console.error('Failed to generate Windows install script:', error)
    return new NextResponse('Failed to generate install script', { status: 500 })
  }
}
