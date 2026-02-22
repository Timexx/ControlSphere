import { NextResponse } from 'next/server'
import { networkInterfaces } from 'os'
import fs from 'fs'
import path from 'path'
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

    const rootDir = path.join(process.cwd(), '..')
    const agentMainPath = path.join(rootDir, 'agent', 'main.go')
    const agentGoModPath = path.join(rootDir, 'agent', 'go.mod')

    let mainGo = ''
    let goMod = ''

    try {
      mainGo = await fs.promises.readFile(agentMainPath, 'utf8')
    } catch (err) {
      console.error('Failed to read agent main.go:', err)
      return new NextResponse('Failed to read agent source', { status: 500 })
    }

    try {
      goMod = await fs.promises.readFile(agentGoModPath, 'utf8')
    } catch (err) {
      console.error('Failed to read agent go.mod:', err)
      return new NextResponse('Failed to read agent source', { status: 500 })
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

# Install wget if not present
if ! command -v wget &> /dev/null; then
  echo -e "\${YELLOW}wget not found. Installing wget...\${NC}"
  
  if [ -f /etc/debian_version ]; then
    apt-get update -qq
    apt-get install -y wget
  elif [ -f /etc/redhat-release ]; then
    yum install -y wget
  elif [ -f /etc/arch-release ]; then
    pacman -S --noconfirm wget
  fi
fi

# Install Go if not present or version is too old
GO_REQUIRED_VERSION="1.21"
GO_VERSION=""

if command -v go &> /dev/null; then
  GO_VERSION=$(go version | awk '{print $3}' | sed 's/go//')
fi

# Check if Go version is sufficient
need_install=false
if [ -z "$GO_VERSION" ]; then
  need_install=true
elif [ "$(printf '%s\n' "$GO_REQUIRED_VERSION" "$GO_VERSION" | sort -V | head -n1)" != "$GO_REQUIRED_VERSION" ]; then
  need_install=true
fi

if [ "$need_install" = true ]; then
  if [ -n "$GO_VERSION" ]; then
    echo -e "\${YELLOW}Go version $GO_VERSION found, but version $GO_REQUIRED_VERSION or higher is required.\${NC}"
    echo -e "\${YELLOW}Upgrading Go...\${NC}"
  else
    echo -e "\${YELLOW}Go not found. Installing Go...\${NC}"
  fi
  
  # Detect architecture
  ARCH=$(uname -m)
  case $ARCH in
    x86_64)
      GO_ARCH="amd64"
      ;;
    aarch64|arm64)
      GO_ARCH="arm64"
      ;;
    armv7l)
      GO_ARCH="armv6l"
      ;;
    *)
      echo -e "\${RED}Unsupported architecture: $ARCH\${NC}"
      exit 1
      ;;
  esac
  
  # Download and install Go 1.21
  GO_TARBALL="go1.21.0.linux-$GO_ARCH.tar.gz"
  echo -e "\${YELLOW}Downloading Go 1.21...\${NC}"
  
  cd /tmp
  wget --timeout=60 --tries=2 -q "https://go.dev/dl/$GO_TARBALL"
  
  if [ $? -ne 0 ]; then
    echo -e "\${RED}Failed to download Go. Please check your internet connection.\${NC}"
    exit 1
  fi
  
  # Remove old Go installation
  rm -rf /usr/local/go
  
  # Extract new Go
  tar -C /usr/local -xzf "$GO_TARBALL"
  rm "$GO_TARBALL"
  
  # Add Go to PATH if not already there
  if ! grep -q "/usr/local/go/bin" /etc/profile; then
    echo 'export PATH=$PATH:/usr/local/go/bin' >> /etc/profile
  fi
  
  # Add to current session
  export PATH=$PATH:/usr/local/go/bin
  
  echo -e "\${GREEN}Go installed successfully: $(/usr/local/go/bin/go version)\${NC}"
else
  echo -e "\${GREEN}Go is already installed: $(go version)\${NC}"
fi

SERVER_URL="ws://${serverUrl}/ws/agent"

# Generate or preserve secret key
if [ "$PRESERVE_CONFIG" = true ]; then
  echo -e "\${YELLOW}Checking existing configuration...\${NC}"
  EXISTING_SECRET=$(grep -oP '(?<="secret_key": ")[^"]*' /etc/maintainer-agent/config.json 2>/dev/null || echo "")
  
  # Validate secret key format (must be 64 hex characters)
  if [[ "$EXISTING_SECRET" =~ ^[a-fA-F0-9]{64}$ ]]; then
    echo -e "\${GREEN}✓ Secret key is valid (64 hex chars)\${NC}"
    SECRET_KEY="$EXISTING_SECRET"
  else
    echo -e "\${YELLOW}⚠️  Secret key needs migration (length: \${#EXISTING_SECRET})\${NC}"
    
    if [ -n "$EXISTING_SECRET" ]; then
      # Migrate old key via SHA-256 hash
      echo -e "\${BLUE}Auto-migrating secret key via SHA-256 hash...\${NC}"
      SECRET_KEY=$(echo -n "$EXISTING_SECRET" | sha256sum | awk '{print $1}')
      echo -e "\${GREEN}✓ Secret key migrated\${NC}"
      echo -e "\${YELLOW}NOTE: The machine must be re-registered in the web UI\${NC}"
    else
      # Generate new key if none exists
      echo -e "\${YELLOW}No secret key found, generating new one...\${NC}"
      SECRET_KEY=$(openssl rand -hex 32)
      echo -e "\${GREEN}✓ New secret key generated\${NC}"
    fi
    
    # Update config with migrated/new key
    cat > /etc/maintainer-agent/config.json <<EOF
{
  "server_url": "\${SERVER_URL}",
  "secret_key": "\${SECRET_KEY}"
}
EOF
    chmod 600 /etc/maintainer-agent/config.json
  fi
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

# Download and build agent
echo -e "\${GREEN}Building agent binary...\${NC}"

# Create temporary build directory (use unique name without 'maintainer-agent' to avoid pkill issues)
BUILD_DIR="/tmp/magent-build-$$"
mkdir -p "\$BUILD_DIR"
cd "\$BUILD_DIR"

# Create agent source code
echo -e "\${YELLOW}Creating agent source code...\${NC}"

cat > main.go << 'GOCODE'
${mainGo}
GOCODE

cat > go.mod << 'GOMOD'
${goMod}
GOMOD

# Build the agent
echo -e "\${YELLOW}Compiling agent...\${NC}"

# Remove old binary if exists
rm -f /usr/local/bin/maintainer-agent

# Detect Go binary location
GO_BIN=""
if [ -x "/usr/local/go/bin/go" ]; then
  GO_BIN="/usr/local/go/bin/go"
  export PATH=/usr/local/go/bin:$PATH
  export GOROOT=/usr/local/go
elif command -v go &> /dev/null; then
  GO_BIN=$(which go)
else
  echo -e "\${RED}Error: Go binary not found!\${NC}"
  exit 1
fi

# Verify Go version
echo "Using Go: $($GO_BIN version)"

echo -e "\${YELLOW}Downloading dependencies...\${NC}"
timeout 120 $GO_BIN mod tidy 2>&1 || {
  echo -e "\${RED}Failed to download dependencies (timeout or error)\${NC}"
  exit 1
}

echo -e "\${YELLOW}Building binary...\${NC}"
timeout 120 $GO_BIN build -o /usr/local/bin/maintainer-agent -ldflags="-s -w" . 2>&1 || {
  echo -e "\${RED}Failed to build agent\${NC}"
  exit 1
}

# Cleanup
cd /
rm -rf "\$BUILD_DIR"

chmod +x /usr/local/bin/maintainer-agent
echo -e "\${GREEN}Agent binary built successfully!\${NC}"

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
