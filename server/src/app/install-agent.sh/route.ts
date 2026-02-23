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
      // strip protocol — the shell script builds ws:// itself
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

# Check if agent is already installed
AGENT_INSTALLED=false
PRESERVE_CONFIG=false

if [ -f /usr/local/bin/maintainer-agent ]; then
  AGENT_INSTALLED=true
  echo -e "\${YELLOW}Existing agent installation detected.\${NC}"
fi

if [ -f /etc/maintainer-agent/config.json ]; then
  PRESERVE_CONFIG=true
  echo -e "\${YELLOW}Existing configuration found. Will be preserved.\${NC}"
fi

# Aggressive cleanup of running agent
if [ "$AGENT_INSTALLED" = true ]; then
  echo -e "\${YELLOW}Stopping and cleaning up running agent...\${NC}"
  
  # Disable service first to prevent auto-restart
  systemctl disable maintainer-agent 2>/dev/null || true
  
  # Stop service with force-kill after timeout
  timeout 5 systemctl stop maintainer-agent 2>/dev/null || true
  
  # Kill all agent processes immediately
  pkill -9 -f "maintainer-agent" 2>/dev/null || true
  sleep 1
  
  # Kill again to be absolutely sure
  pkill -9 -f "maintainer-agent" 2>/dev/null || true
  
  # Kill any stuck systemd control processes
  pkill -9 -f "systemctl.*maintainer-agent" 2>/dev/null || true
  
  # Reset failed state
  systemctl reset-failed maintainer-agent 2>/dev/null || true
  
  # Wait for all processes to fully terminate
  sleep 2
  
  echo -e "\${GREEN}Cleanup complete.\${NC}"
fi

SERVER_URL="ws://${serverUrl}/ws/agent"

# Generate or preserve secret key
if [ "$PRESERVE_CONFIG" = true ]; then
  echo -e "\${YELLOW}Checking existing configuration...\${NC}"
  EXISTING_SECRET=$(grep -oP '(?<="secret_key":\\s*")[^"]*' /etc/maintainer-agent/config.json 2>/dev/null || echo "")
  
  # Validate secret key format (must be 64 hex characters)
  if [[ "$EXISTING_SECRET" =~ ^[a-fA-F0-9]{64}$ ]]; then
    echo -e "\${GREEN}✓ Secret key is valid (64 hex chars)\${NC}"
    SECRET_KEY="$EXISTING_SECRET"
  else
    echo -e "\${YELLOW}⚠️  Secret key needs migration (length: \${#EXISTING_SECRET})\${NC}"
    
    if [ -n "$EXISTING_SECRET" ]; then
      echo -e "\${YELLOW}Auto-migrating secret key via SHA-256 hash...\${NC}"
      SECRET_KEY=$(echo -n "$EXISTING_SECRET" | sha256sum | awk '{print $1}')
      echo -e "\${GREEN}✓ Secret key migrated\${NC}"
      echo -e "\${YELLOW}NOTE: The machine must be re-registered in the web UI\${NC}"
    else
      echo -e "\${YELLOW}No secret key found, generating new one...\${NC}"
      SECRET_KEY=$(openssl rand -hex 32)
      echo -e "\${GREEN}✓ New secret key generated\${NC}"
    fi
  fi
  
  # Always update config to ensure server_url is current
  cat > /etc/maintainer-agent/config.json <<EOF
{
  "server_url": "\${SERVER_URL}",
  "secret_key": "\${SECRET_KEY}"
}
EOF
  chmod 600 /etc/maintainer-agent/config.json
  echo ""
else
  # Generate new secret key
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
fi

# ---------- Download pre-compiled binary ----------
echo -e "\${GREEN}Downloading agent binary...\${NC}"

ARCH=$(uname -m)
case $ARCH in
  x86_64)       DL_ARCH="amd64" ;;
  aarch64|arm64) DL_ARCH="arm64" ;;
  *)
    echo -e "\${RED}Unsupported architecture: $ARCH\${NC}"
    exit 1
    ;;
esac

DOWNLOAD_URL="http://${serverUrl}/api/agent-download?os=linux&arch=\${DL_ARCH}"
echo -e "\${YELLOW}URL: \${DOWNLOAD_URL}\${NC}"

# Remove old binary
rm -f /usr/local/bin/maintainer-agent

# Download with curl (fallback to wget)
if command -v curl &> /dev/null; then
  HTTP_CODE=$(curl -sSL -w "%{http_code}" -o /usr/local/bin/maintainer-agent "\${DOWNLOAD_URL}")
  if [ "$HTTP_CODE" != "200" ]; then
    echo ""
    echo -e "\${RED}╔════════════════════════════════════════════════════════════════╗\${NC}"
    echo -e "\${RED}║  ERROR: Agent Binary Not Available (HTTP \${HTTP_CODE})                ║\${NC}"
    echo -e "\${RED}╚════════════════════════════════════════════════════════════════╝\${NC}"
    echo ""
    echo -e "\${YELLOW}The server has not built the agent binaries yet.\${NC}"
    echo ""
    echo -e "\${GREEN}SOLUTION: SSH to the server and run ONE of these:\${NC}"
    echo ""
    echo -e "\${WHITE}  For Docker deployment:\${NC}"
    echo -e "    cd /path/to/Maintainer"
    echo -e "    docker compose build --no-cache server"
    echo -e "    docker compose up -d"
    echo ""
    echo -e "\${WHITE}  For native deployment:\${NC}"
    echo -e "    cd /path/to/Maintainer/agent"
    echo -e "    ./build-agent.sh"
    echo ""
    echo -e "\${CYAN}Then run this install script again.\${NC}"
    echo ""
    rm -f /usr/local/bin/maintainer-agent
    exit 1
  fi
elif command -v wget &> /dev/null; then
  if ! wget -q -O /usr/local/bin/maintainer-agent "\${DOWNLOAD_URL}"; then
    echo ""
    echo -e "\${RED}╔════════════════════════════════════════════════════════════════╗\${NC}"
    echo -e "\${RED}║  ERROR: Agent Binary Download Failed                          ║\${NC}"
    echo -e "\${RED}╚════════════════════════════════════════════════════════════════╝\${NC}"
    echo ""
    echo -e "\${YELLOW}The server has not built the agent binaries yet.\${NC}"
    echo ""
    echo -e "\${GREEN}SOLUTION: SSH to the server and run ONE of these:\${NC}"
    echo ""
    echo -e "\${WHITE}  For Docker deployment:\${NC}"
    echo -e "    cd /path/to/Maintainer"
    echo -e "    docker compose build --no-cache server"
    echo -e "    docker compose up -d"
    echo ""
    echo -e "\${WHITE}  For native deployment:\${NC}"
    echo -e "    cd /path/to/Maintainer/agent"
    echo -e "    ./build-agent.sh"
    echo ""
    echo -e "\${CYAN}Then run this install script again.\${NC}"
    echo ""
    rm -f /usr/local/bin/maintainer-agent
    exit 1
  fi
else
  echo -e "\${RED}Error: Neither curl nor wget found!\${NC}"
  exit 1
fi

# Verify we got a real binary (not an HTML error page)
if file /usr/local/bin/maintainer-agent | grep -qE "ELF|executable"; then
  echo -e "\${GREEN}✓ Agent binary downloaded successfully\${NC}"
else
  echo ""
  echo -e "\${RED}╔════════════════════════════════════════════════════════════════╗\${NC}"
  echo -e "\${RED}║  ERROR: Downloaded File Is Not A Valid Binary                 ║\${NC}"
  echo -e "\${RED}╚════════════════════════════════════════════════════════════════╝\${NC}"
  echo ""
  echo -e "\${YELLOW}The server has not built the agent binaries yet.\${NC}"
  echo ""
  echo -e "\${GREEN}SOLUTION: SSH to the server and run ONE of these:\${NC}"
  echo ""
  echo -e "\${WHITE}  For Docker deployment:\${NC}"
  echo -e "    cd /path/to/Maintainer"
  echo -e "    docker compose build --no-cache server"
  echo -e "    docker compose up -d"
  echo ""
  echo -e "\${WHITE}  For native deployment:\${NC}"
  echo -e "    cd /path/to/Maintainer/agent"
  echo -e "    ./build-agent.sh"
  echo ""
  echo -e "\${CYAN}Then run this install script again.\${NC}"
  echo ""
  rm -f /usr/local/bin/maintainer-agent
  exit 1
fi

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
if [ "$AGENT_INSTALLED" = true ]; then
  echo -e "\${GREEN}  Agent Update Complete! ✓\${NC}"
else
  echo -e "\${GREEN}  Installation Complete! ✓\${NC}"
fi
echo -e "\${GREEN}============================================\${NC}"
echo ""
if [ "$PRESERVE_CONFIG" = false ]; then
  echo -e "Secret Key: \${YELLOW}\${SECRET_KEY}\${NC}"
  echo ""
fi
echo -e "Check status: \${YELLOW}systemctl status maintainer-agent\${NC}"
echo -e "View logs: \${YELLOW}journalctl -u maintainer-agent -f\${NC}"
echo ""
`

    return new NextResponse(installScript, {
      headers: {
        'Content-Type': 'text/x-sh; charset=utf-8',
        'Content-Disposition': 'inline; filename="install-agent.sh"',
      },
    })
  } catch (error) {
    console.error('Failed to generate install script:', error)
    return new NextResponse('Failed to generate install script', { status: 500 })
  }
}
