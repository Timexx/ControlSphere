'use client'

import { useState, useEffect } from 'react'
import { X, Download, Copy, Check, Terminal } from 'lucide-react'
import { useTranslations } from 'next-intl'

interface AddAgentModalProps {
  onClose: () => void
}

export default function AddAgentModal({ onClose }: AddAgentModalProps) {
  const t = useTranslations('addAgentModal')
  const [copied, setCopied] = useState(false)
  const [serverUrl, setServerUrl] = useState('localhost:3000')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Lade Server-Info automatisch
    const loadServerInfo = async () => {
      try {
        const res = await fetch('/api/server-info')
        const data = await res.json()
        // Entferne http:// und verwende nur host:port
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

  const installScript = `#!/bin/bash
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

# Replace with your actual download URL
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

# Start service
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

  const manualSteps = `# Manual Installation Steps

## 1. Download Agent Binary
Download the appropriate binary for your system:
- Linux AMD64: maintainer-agent-linux-amd64
- Linux ARM64: maintainer-agent-linux-arm64

## 2. Install Binary
\`\`\`bash
sudo mv maintainer-agent-* /usr/local/bin/maintainer-agent
sudo chmod +x /usr/local/bin/maintainer-agent
\`\`\`

## 3. Create Configuration
\`\`\`bash
sudo mkdir -p /etc/maintainer-agent

# Generate secret key
SECRET_KEY=$(openssl rand -hex 32)

# Create config
sudo tee /etc/maintainer-agent/config.json > /dev/null <<EOF
{
  "server_url": "ws://${serverUrl}/ws/agent",
  "secret_key": "$SECRET_KEY"
}
EOF

sudo chmod 600 /etc/maintainer-agent/config.json
\`\`\`

## 4. Create Systemd Service
\`\`\`bash
sudo tee /etc/systemd/system/maintainer-agent.service > /dev/null <<EOF
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
\`\`\`

## 5. Start Service
\`\`\`bash
sudo systemctl daemon-reload
sudo systemctl enable maintainer-agent
sudo systemctl start maintainer-agent
sudo systemctl status maintainer-agent
\`\`\`

## 6. Save Your Secret Key!
Make sure to save the SECRET_KEY from step 3.
`

  const copyToClipboard = async (text: string) => {
    try {
      // Prüfe ob Clipboard API verfügbar ist
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } else {
        // Fallback für ältere Browser oder unsichere Kontexte
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
    const blob = new Blob([installScript], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'install-agent.sh'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

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
          {/* Quick Install */}
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-white mb-3">
              🚀 {t('quickInstall.title')}
            </h3>
            <p className="text-sm text-slate-400 mb-3">
              {t('quickInstall.description')}
            </p>
            
            <div className="relative">
              <pre className="bg-[#0f161d] text-cyan-300 p-4 rounded-lg overflow-x-auto text-sm border border-slate-800">
                <code>curl -sSL http://{serverUrl}/install-agent.sh | sudo bash</code>
              </pre>
              <button
                onClick={() => copyToClipboard(`curl -sSL http://${serverUrl}/install-agent.sh | sudo bash`)}
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
                onClick={() => copyToClipboard(installScript)}
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
              <li>{t('notes.root')}</li>
              <li>{t('notes.secret')}</li>
              <li>{t('notes.dashboard')}</li>
              <li>{t('notes.port')}</li>
            </ul>
          </div>
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
