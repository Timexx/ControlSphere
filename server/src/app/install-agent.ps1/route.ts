import { NextResponse } from 'next/server'
import { networkInterfaces } from 'os'
import { prisma } from '@/lib/prisma'
import { readAgentManifest } from '@/lib/agent-manifest'

// Prevent static generation — this route reads files from disk at runtime
export const dynamic = 'force-dynamic'

// Only characters that are harmless inside a double-quoted PowerShell string.
const HOST_RE = /^[A-Za-z0-9._:\[\]-]+$/
const SHA_RE = /^[a-f0-9]{64}$/
const VERSION_RE = /^[A-Za-z0-9._+-]{1,64}$/

function safeSha(value: string | undefined): string {
  return value && SHA_RE.test(value) ? value : ''
}

function safeSize(value: number | undefined): string {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? String(value) : ''
}

export async function GET() {
  try {
    let hostPart: string
    let secure = false

    // 1. Prefer admin-configured URL from DB (keep its scheme: https -> https/wss)
    const config = await prisma.serverConfig.findUnique({ where: { id: 'global' } })
    if (config?.serverUrl) {
      const raw = config.serverUrl.trim()
      secure = /^(https|wss):\/\//i.test(raw)
      hostPart = raw.replace(/^[A-Za-z][A-Za-z0-9+.-]*:\/\//, '').split(/[/?#]/)[0]
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
      hostPart = `${serverIp}:${process.env.PORT || 3000}`
    }

    if (!HOST_RE.test(hostPart)) {
      throw new Error('Configured server URL contains unexpected characters')
    }

    const baseUrl = `${secure ? 'https' : 'http'}://${hostPart}`
    const defaultWsUrl = `${secure ? 'wss' : 'ws'}://${hostPart}/ws/agent`

    // Manifest (validated by readAgentManifest; values re-checked before embedding)
    const manifest = await readAgentManifest()
    const amd64 = manifest?.binaries['windows-amd64']
    const arm64 = manifest?.binaries['windows-arm64']
    const expectedVersion = manifest && VERSION_RE.test(manifest.version) ? manifest.version : ''
    const shaAmd64 = safeSha(amd64?.sha256)
    const shaArm64 = safeSha(arm64?.sha256)
    const sizeAmd64 = safeSize(amd64?.size)
    const sizeArm64 = safeSize(arm64?.size)

    const installScript = `#Requires -RunAsAdministrator
# Maintainer Agent — Windows Installer
# Run in an elevated PowerShell: irm ${baseUrl}/install-agent.ps1 | iex
$ErrorActionPreference = "Stop"

# Values embedded by the server (empty = no valid manifest on the server)
$ExpectedVersion = "${expectedVersion}"
$ShaAmd64  = "${shaAmd64}"
$ShaArm64  = "${shaArm64}"
$SizeAmd64 = "${sizeAmd64}"
$SizeArm64 = "${sizeArm64}"
$BaseUrl   = "${baseUrl}"
$DefaultWsUrl = "${defaultWsUrl}"

Write-Host "============================================" -ForegroundColor Green
Write-Host "  Maintainer Agent Installation (Windows)"   -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""

$InstallDir = "$env:ProgramData\\maintainer-agent"
$BinPath    = "$InstallDir\\maintainer-agent.exe"
$ConfigPath = "$InstallDir\\config.json"
$TmpPath    = "$InstallDir\\maintainer-agent.download.exe"
$PrevPath   = "$InstallDir\\maintainer-agent.previous.exe"
$ConfigTmp  = "$InstallDir\\config.json.tmp"
$ServiceName = "MaintainerAgent"

function Fail-Install([string]$Message) {
    Remove-Item -Path $TmpPath -Force -ErrorAction SilentlyContinue
    Remove-Item -Path $ConfigTmp -Force -ErrorAction SilentlyContinue
    Write-Host ""
    Write-Host "ERROR: $Message" -ForegroundColor Red
    Write-Host "Aborted. The running agent was not changed." -ForegroundColor Red
    Write-Host ""
    exit 1
}

# ---------- 1. manifest present? architecture ----------
if (-not $ExpectedVersion) {
    Fail-Install "Agent-Binaries fehlen auf dem Server: dort scripts/deploy.sh bzw. server/scripts/build-agents-if-needed.sh ausfuehren"
}

$arch = if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq [System.Runtime.InteropServices.Architecture]::Arm64) { "arm64" } else { "amd64" }
if ($arch -eq "arm64") { $ExpectedSha = $ShaArm64; $ExpectedSize = $SizeArm64 } else { $ExpectedSha = $ShaAmd64; $ExpectedSize = $SizeAmd64 }
if (-not $ExpectedSha -or -not $ExpectedSize) {
    Fail-Install "Agent-Binaries fehlen auf dem Server (windows-$arch): dort scripts/deploy.sh bzw. server/scripts/build-agents-if-needed.sh ausfuehren"
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

# ---------- Windows Defender exclusions (before the download is executed) ----------
try {
    Add-MpPreference -ExclusionPath "$InstallDir" -ErrorAction SilentlyContinue
    Add-MpPreference -ExclusionProcess "$BinPath" -ErrorAction SilentlyContinue
} catch {
    Write-Host "Could not add Defender exclusions: $_" -ForegroundColor Yellow
}

# ---------- 2. download to a temp file ----------
$downloadUrl = "$BaseUrl/api/agent-download?os=windows&arch=$arch"
Write-Host "Downloading agent $ExpectedVersion (windows-$arch) from $downloadUrl" -ForegroundColor Green
Remove-Item -Path $TmpPath -Force -ErrorAction SilentlyContinue

try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $downloadUrl -OutFile $TmpPath -UseBasicParsing -ErrorAction Stop
} catch {
    Fail-Install "Download failed: $_. Agent-Binaries fehlen auf dem Server: dort scripts/deploy.sh bzw. server/scripts/build-agents-if-needed.sh ausfuehren"
}

# ---------- 3. verify the download ----------
try {
    $gotSize = (Get-Item -Path $TmpPath).Length
    if ([string]$gotSize -ne $ExpectedSize) {
        throw "Size mismatch: got $gotSize bytes, expected $ExpectedSize"
    }

    $gotSha = (Get-FileHash -Path $TmpPath -Algorithm SHA256).Hash
    if ($gotSha.ToLowerInvariant() -ne $ExpectedSha.ToLowerInvariant()) {
        throw "SHA-256 mismatch: got $gotSha, expected $ExpectedSha"
    }

    $head = New-Object byte[] 2
    $fs = [System.IO.File]::OpenRead($TmpPath)
    try { [void]$fs.Read($head, 0, 2) } finally { $fs.Close() }
    if ($head[0] -ne 0x4D -or $head[1] -ne 0x5A) {
        throw "Downloaded file is not a Windows executable (missing MZ header)"
    }

    $prevPref = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try { $gotVersion = (& $TmpPath -version 2>&1 | Out-String).Trim() } finally { $ErrorActionPreference = $prevPref }
    if ($gotVersion -ne $ExpectedVersion) {
        throw "Version mismatch: binary reports '$gotVersion', expected '$ExpectedVersion'"
    }
} catch {
    Fail-Install "$_"
}
Write-Host "Binary verified (size, sha256, MZ, version $gotVersion)" -ForegroundColor Green

# ---------- 4. configuration (secret_key is always preserved) ----------
$SecretKey = $null
$ServerUrl = $DefaultWsUrl
$NewInstall = $true

if (Test-Path $ConfigPath) {
    $NewInstall = $false
    $rawConfig = ""
    try { $rawConfig = Get-Content $ConfigPath -Raw } catch {}
    $existingConfig = $null
    try { $existingConfig = $rawConfig | ConvertFrom-Json } catch {}

    if ($existingConfig -and $existingConfig.secret_key) {
        $SecretKey = [string]$existingConfig.secret_key
        Write-Host "Preserving existing secret key." -ForegroundColor Yellow
    } elseif ($rawConfig -match "secret_key") {
        Fail-Install "Existing config contains a secret_key that could not be read; refusing to overwrite it"
    } else {
        $NewInstall = $true
    }

    if ($existingConfig -and $existingConfig.server_url -and ([string]$existingConfig.server_url) -match '^wss?://[A-Za-z0-9._:/@%?=&+~-]+$') {
        $ServerUrl = [string]$existingConfig.server_url
        Write-Host "Keeping existing server_url: $ServerUrl" -ForegroundColor Yellow
    }

    Copy-Item -Path $ConfigPath -Destination "$ConfigPath.bak" -Force -ErrorAction SilentlyContinue
}

if (-not $SecretKey) {
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $SecretKey = ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
}

$configJson = @{
    server_url = $ServerUrl
    secret_key = $SecretKey
} | ConvertTo-Json
# Write WITHOUT BOM — Go's JSON parser cannot handle UTF-8 BOM
[System.IO.File]::WriteAllText($ConfigTmp, $configJson)

# Restrict config ACL to SYSTEM + Administrators only (use SIDs for locale independence)
$acl = Get-Acl $ConfigTmp
$acl.SetAccessRuleProtection($true, $false)
$sidSystem = New-Object System.Security.Principal.SecurityIdentifier("S-1-5-18")
$sidAdmins = New-Object System.Security.Principal.SecurityIdentifier("S-1-5-32-544")
$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($sidSystem,"FullControl","Allow")))
$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($sidAdmins,"FullControl","Allow")))
Set-Acl -Path $ConfigTmp -AclObject $acl
Move-Item -Path $ConfigTmp -Destination $ConfigPath -Force

# ---------- 5. replace the binary (first time the running agent is touched) ----------
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue

if (Test-Path $BinPath) {
    Copy-Item -Path $BinPath -Destination $PrevPath -Force -ErrorAction SilentlyContinue
}

if ($svc) {
    Write-Host "Stopping service $ServiceName..." -ForegroundColor Yellow
    try {
        Stop-Service -Name $ServiceName -Force -ErrorAction Stop
        (Get-Service -Name $ServiceName).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
    } catch {
        Write-Host "Could not stop service cleanly: $_" -ForegroundColor Yellow
    }
}

$moved = $false
for ($i = 0; $i -lt 10 -and -not $moved; $i++) {
    try {
        Move-Item -Path $TmpPath -Destination $BinPath -Force -ErrorAction Stop
        $moved = $true
    } catch {
        Start-Sleep -Seconds 2
    }
}
if (-not $moved) {
    # old binary is still in place; bring the old service back up
    if ($svc) { try { Start-Service -Name $ServiceName -ErrorAction SilentlyContinue } catch {} }
    Fail-Install "Could not replace $BinPath (file locked?)"
}

foreach ($leftover in @("maintainer-agent.bak", "maintainer-agent.new.exe", "maintainer-agent.exe.bak", "update-pending")) {
    Remove-Item -Path (Join-Path $InstallDir $leftover) -Force -ErrorAction SilentlyContinue
}

# ---------- 6. service installation + recovery ----------
if (-not $svc) {
    Write-Host "Installing Windows Service..." -ForegroundColor Green
    try {
        $installOutput = & $BinPath -install -config $ConfigPath 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0) {
            throw "Service installation failed with exit code $($LASTEXITCODE). Output: $installOutput"
        }
        Write-Host $installOutput -ForegroundColor Gray
    } catch {
        Write-Host "ERROR: Service installation failed: $_" -ForegroundColor Red
        Write-Host "Try manually: $BinPath -install -config $ConfigPath" -ForegroundColor Gray
        exit 1
    }
}

& sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/5000/restart/5000 | Out-Null
& sc.exe failureflag $ServiceName 1 | Out-Null

# ---------- 7. start + verify ----------
Write-Host "Starting service..." -ForegroundColor Green
$running = $false
try {
    Start-Service -Name $ServiceName -ErrorAction Stop
    for ($i = 1; $i -le 15; $i++) {
        Start-Sleep -Seconds 1
        if ((Get-Service -Name $ServiceName).Status -eq 'Running') { $running = $true; break }
    }
    if ($running) {
        Start-Sleep -Seconds 3
        $running = ((Get-Service -Name $ServiceName).Status -eq 'Running')
    }
} catch {
    Write-Host "Failed to start service: $_" -ForegroundColor Yellow
}

if (-not $running) {
    Write-Host "Agent is not running after the update." -ForegroundColor Red
    if (Test-Path $PrevPath) {
        Write-Host "Restoring the previous binary..." -ForegroundColor Yellow
        try { Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue } catch {}
        Start-Sleep -Seconds 2
        Move-Item -Path $PrevPath -Destination $BinPath -Force -ErrorAction SilentlyContinue
        try { Start-Service -Name $ServiceName -ErrorAction SilentlyContinue } catch {}
    }
    if (Test-Path "$InstallDir\\agent.log") {
        Get-Content "$InstallDir\\agent.log" -Tail 20 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }
    }
    exit 1
}

Remove-Item -Path $PrevPath -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  Agent $gotVersion is running"               -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
if ($NewInstall) {
    Write-Host "Secret Key: $SecretKey" -ForegroundColor Yellow
    Write-Host "IMPORTANT: Save this key!" -ForegroundColor Yellow
    Write-Host ""
}
Write-Host "Useful commands:" -ForegroundColor Cyan
Write-Host "  Get-Service MaintainerAgent"
Write-Host "  Restart-Service MaintainerAgent"
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
