'use client'

import { useState, useEffect } from 'react'
import { X, Download, Copy, Check, Terminal, Monitor } from 'lucide-react'
import { useTranslations } from 'next-intl'

interface AddAgentModalProps {
  onClose: () => void
}

type PlatformTab = 'linux' | 'windows'

export default function AddAgentModal({ onClose }: AddAgentModalProps) {
  const t = useTranslations('addAgentModal')
  const [copied, setCopied] = useState(false)
  const [serverUrl, setServerUrl] = useState('localhost:3000')
  const [loading, setLoading] = useState(true)
  const [platform, setPlatform] = useState<PlatformTab>('linux')

  useEffect(() => {
    const loadServerInfo = async () => {
      try {
        const res = await fetch('/api/server-info')
        const data = await res.json()
        const url = data.url.replace('http://', '').replace('https://', '')
        setServerUrl(url)
      } catch (error) {
        console.error('Failed to load server info:', error)
        setServerUrl('localhost:3000')
      } finally {
        setLoading(false)
      }
    }
    loadServerInfo()
  }, [])

  // ─── Linux install script ───
  const linuxInstallScript = `#!/bin/bash
set -e

# Colors
GREEN='\\033[0;32m'
YELLOW='\\033[1;33m'
RED='\\033[0;31m'
NC='\\033[0m'

echo -e "\${GREEN}============================================\${NC}"
echo -e "\${GREEN}  Maintainer Agent Installation\${NC}"
echo -e "\${GREEN}============================================\${NC}"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
  echo -e "\${RED}Error: Please run as root (use sudo)\${NC}"
  exit 1
fi

SERVER_URL="ws://${serverUrl}/ws/agent"

# Generate secret key
SECRET_KEY=$(openssl rand -hex 32)

echo -e "\${YELLOW}Generated Secret Key:\${NC}"
echo -e "\${GREEN}\${SECRET_KEY}\${NC}"
echo ""
echo -e "\${YELLOW}IMPORTANT: Save this key!\${NC}"
echo ""

# Create config directory
mkdir -p /etc/maintainer-agent

# Create config file
cat > /etc/maintainer-agent/config.json <<EOF
{
  "server_url": "\${SERVER_URL}",
  "secret_key": "\${SECRET_KEY}"
}
EOF

chmod 600 /etc/maintainer-agent/config.json

# Download agent binary
echo -e "\${GREEN}Downloading agent binary...\${NC}"
ARCH=$(uname -m)
if [ "\$ARCH" = "x86_64" ]; then
  BINARY="maintainer-agent-linux-amd64"
elif [ "\$ARCH" = "aarch64" ] || [ "\$ARCH" = "arm64" ]; then
  BINARY="maintainer-agent-linux-arm64"
else
  echo -e "\${RED}Unsupported architecture: \$ARCH\${NC}"
  exit 1
fi

wget -O /tmp/maintainer-agent "http://${serverUrl}/downloads/\${BINARY}" || {
  echo -e "\${RED}Failed to download agent. Please download manually.\${NC}"
  echo "Place binary at: /usr/local/bin/maintainer-agent"
  exit 1
}

mv /tmp/maintainer-agent /usr/local/bin/
chmod +x /usr/local/bin/maintainer-agent

# Create systemd service
cat > /etc/systemd/system/maintainer-agent.service <<EOF
[Unit]
Description=Maintainer Agent
After=network.target

[Service]
Type=simple
User=root
ExecStart=/usr/local/bin/maintainer-agent -config /etc/maintainer-agent/config.json
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable maintainer-agent
systemctl start maintainer-agent

echo ""
echo -e "\${GREEN}============================================\${NC}"
echo -e "\${GREEN}  Installation Complete! ✓\${NC}"
echo -e "\${GREEN}============================================\${NC}"
echo ""
echo -e "Secret Key: \${YELLOW}\${SECRET_KEY}\${NC}"
echo ""
echo -e "Check status: \${YELLOW}systemctl status maintainer-agent\${NC}"
echo -e "View logs: \${YELLOW}journalctl -u maintainer-agent -f\${NC}"
echo ""
`

  // ─── Windows install script (PowerShell) ───
  const windowsInstallScript = `#Requires -RunAsAdministrator
# Maintainer Agent — Windows Installer
$ErrorActionPreference = "Stop"

Write-Host "============================================" -ForegroundColor Green
Write-Host "  Maintainer Agent Installation (Windows)"   -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""

$ServerUrl  = "ws://${serverUrl}/ws/agent"
$InstallDir = "$env:ProgramData\\maintainer-agent"
$BinPath    = "$InstallDir\\maintainer-agent.exe"
$ConfigPath = "$InstallDir\\config.json"

# Generate secret key
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$SecretKey = ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""

Write-Host "Generated Secret Key:" -ForegroundColor Yellow
Write-Host $SecretKey -ForegroundColor Green
Write-Host ""
Write-Host "IMPORTANT: Save this key!" -ForegroundColor Yellow
Write-Host ""

# Create install directory
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

# Write config
$configJson = @{
    server_url = $ServerUrl
    secret_key = $SecretKey
} | ConvertTo-Json
# Write WITHOUT BOM — Go's JSON parser cannot handle UTF-8 BOM
[System.IO.File]::WriteAllText($ConfigPath, $configJson)

# Restrict config permissions (use SIDs for locale independence)
$acl = Get-Acl $ConfigPath
$acl.SetAccessRuleProtection($true, $false)
$sidSystem = New-Object System.Security.Principal.SecurityIdentifier("S-1-5-18")
$sidAdmins = New-Object System.Security.Principal.SecurityIdentifier("S-1-5-32-544")
$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($sidSystem,"FullControl","Allow")))
$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($sidAdmins,"FullControl","Allow")))
Set-Acl -Path $ConfigPath -AclObject $acl

# Download agent binary
Write-Host "Downloading agent binary..." -ForegroundColor Green
$arch = if ([Environment]::Is64BitOperatingSystem) { "amd64" } else { "amd64" }
$downloadUrl = "http://${serverUrl}/api/agent-download?os=windows&arch=$arch"
Invoke-WebRequest -Uri $downloadUrl -OutFile $BinPath -UseBasicParsing

# Add Windows Defender exclusions
Write-Host "Configuring Windows Defender exclusions..." -ForegroundColor Green
try {
    Add-MpPreference -ExclusionProcess "$BinPath" -ErrorAction SilentlyContinue
    Add-MpPreference -ExclusionPath "$InstallDir" -ErrorAction SilentlyContinue
    Write-Host "  ✓ Agent added to Windows Defender exclusion list" -ForegroundColor Gray
} catch {
    Write-Host "  ⚠ Could not add Defender exclusions" -ForegroundColor Yellow
}

# Install and start Windows Service
Write-Host "Installing Windows Service..." -ForegroundColor Green
& $BinPath -install -config $ConfigPath
Start-Service MaintainerAgent

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  Installation Complete! ✓"                   -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "Secret Key: $SecretKey" -ForegroundColor Yellow
Write-Host ""
Write-Host "Check status:  Get-Service MaintainerAgent" -ForegroundColor Yellow
Write-Host "View logs:     Get-WinEvent -LogName Application -FilterXPath '*[System[Provider[@Name=\"MaintainerAgent\"]]]' | Select -First 20" -ForegroundColor Yellow
Write-Host ""
`

  const linuxOneLiner = `curl -sSL http://${serverUrl}/install-agent.sh | sudo bash`
  const windowsOneLiner = `irm http://${serverUrl}/install-agent.ps1 | iex`

  const copyToClipboard = async (text: string) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } else {
        const textArea = document.createElement('textarea')
        textArea.value = text
        textArea.style.position = 'fixed'
        textArea.style.left = '-999999px'
        textArea.style.top = '-999999px'
        document.body.appendChild(textArea)
        textArea.focus()
        textArea.select()
        try {
          document.execCommand('copy')
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        } catch (err) {
          console.error('Fallback copy failed:', err)
          alert(t('copyFailed'))
        } finally {
          document.body.removeChild(textArea)
        }
      }
    } catch (err) {
      console.error('Failed to copy:', err)
      alert(t('copyFailed'))
    }
  }

  const downloadScript = () => {
    const isWindows = platform === 'windows'
    const script = isWindows ? windowsInstallScript : linuxInstallScript
    const ext = isWindows ? 'ps1' : 'sh'
    const blob = new Blob([script], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `install-agent.${ext}`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const currentOneLiner = platform === 'windows' ? windowsOneLiner : linuxOneLiner
  const currentScript = platform === 'windows' ? windowsInstallScript : linuxInstallScript

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#0d141b] border border-slate-800 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="bg-cyan-600 p-2 rounded-lg">
              <Terminal className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">{t('title')}</h2>
              <p className="text-sm text-slate-400">{t('subtitle')}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="h-5 w-5 text-slate-400" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Platform Tabs */}
          <div className="flex space-x-2 mb-6">
            <button
              onClick={() => setPlatform('linux')}
              className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-colors text-sm font-medium ${
                platform === 'linux'
                  ? 'bg-cyan-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              <Terminal className="h-4 w-4" />
              <span>Linux / macOS</span>
            </button>
            <button
              onClick={() => setPlatform('windows')}
              className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-colors text-sm font-medium ${
                platform === 'windows'
                  ? 'bg-cyan-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              <Monitor className="h-4 w-4" />
              <span>Windows</span>
            </button>
          </div>

          {/* Quick Install */}
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-white mb-3">
              🚀 {t('quickInstall.title')}
            </h3>
            <p className="text-sm text-slate-400 mb-3">
              {platform === 'windows'
                ? t('quickInstall.descriptionWindows')
                : t('quickInstall.description')}
            </p>
            
            <div className="relative">
              <pre className="bg-[#0f161d] text-cyan-300 p-4 rounded-lg overflow-x-auto text-sm border border-slate-800">
                <code>{currentOneLiner}</code>
              </pre>
              <button
                onClick={() => copyToClipboard(currentOneLiner)}
                className="absolute top-2 right-2 p-2 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-emerald-400" />
                ) : (
                  <Copy className="h-4 w-4 text-slate-300" />
                )}
              </button>
            </div>

            <div className="mt-3 flex space-x-3">
              <button
                onClick={downloadScript}
                className="flex items-center space-x-2 px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 transition-colors"
              >
                <Download className="h-4 w-4" />
                <span>{t('quickInstall.download')}</span>
              </button>
              <button
                onClick={() => copyToClipboard(currentScript)}
                className="flex items-center space-x-2 px-4 py-2 bg-slate-800 text-slate-300 rounded-lg hover:bg-slate-700 transition-colors"
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4 text-emerald-400" />
                    <span>{t('copied')}</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    <span>{t('quickInstall.copyScript')}</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Important Notes */}
          <div className="p-4 bg-amber-900/20 border border-amber-700/50 rounded-lg">
            <h4 className="font-semibold text-amber-400 mb-2">⚠️ {t('notes.title')}</h4>
            <ul className="text-sm text-amber-300/80 space-y-1 list-disc list-inside">
              <li>{platform === 'windows' ? t('notes.runAsAdmin') : t('notes.root')}</li>
              <li>{t('notes.secret')}</li>
              <li>{t('notes.dashboard')}</li>
              <li>{t('notes.port')}</li>
              {platform === 'windows' && (
                <li>{t('notes.windowsService')}</li>
              )}
            </ul>
          </div>

          {/* Windows Troubleshooting */}
          {platform === 'windows' && (
            <div className="mt-6 p-4 bg-slate-800/50 border border-slate-700 rounded-lg">
              <h4 className="font-semibold text-slate-200 mb-2">🔧 {t('troubleshooting.title')}</h4>
              <p className="text-sm text-slate-400 mb-3">{t('troubleshooting.description')}</p>
              
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-slate-400 mb-1">{t('troubleshooting.viewLogs')}</p>
                  <div className="relative">
                    <pre className="bg-[#0f161d] text-cyan-300 p-3 rounded text-xs border border-slate-700 overflow-x-auto">
                      <code>Get-Content C:\ProgramData\maintainer-agent\agent.log -Tail 50</code>
                    </pre>
                    <button
                      onClick={() => copyToClipboard('Get-Content C:\\ProgramData\\maintainer-agent\\agent.log -Tail 50')}
                      className="absolute top-1 right-1 p-1.5 bg-slate-800 hover:bg-slate-700 rounded transition-colors"
                    >
                      {copied ? (
                        <Check className="h-3 w-3 text-emerald-400" />
                      ) : (
                        <Copy className="h-3 w-3 text-slate-300" />
                      )}
                    </button>
                  </div>
                </div>

                <div>
                  <p className="text-xs text-slate-400 mb-1">{t('troubleshooting.checkService')}</p>
                  <div className="relative">
                    <pre className="bg-[#0f161d] text-cyan-300 p-3 rounded text-xs border border-slate-700 overflow-x-auto">
                      <code>Get-Service MaintainerAgent</code>
                    </pre>
                    <button
                      onClick={() => copyToClipboard('Get-Service MaintainerAgent')}
                      className="absolute top-1 right-1 p-1.5 bg-slate-800 hover:bg-slate-700 rounded transition-colors"
                    >
                      {copied ? (
                        <Check className="h-3 w-3 text-emerald-400" />
                      ) : (
                        <Copy className="h-3 w-3 text-slate-300" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-800 flex justify-end space-x-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-slate-300 hover:bg-slate-800 rounded-lg transition-colors"
          >
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  )
}
