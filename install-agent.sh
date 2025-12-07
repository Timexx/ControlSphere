#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Determine server URL from script source
SCRIPT_SOURCE="${BASH_SOURCE[0]}"
if [[ "$SCRIPT_SOURCE" =~ http://([^:/]+):([0-9]+) ]]; then
    SERVER_HOST="${BASH_REMATCH[1]}"
    SERVER_PORT="${BASH_REMATCH[2]}"
else
    # Fallback if we can't determine from source
    SERVER_HOST="${1:-localhost}"
    SERVER_PORT="3000"
fi

SERVER_URL="ws://${SERVER_HOST}:${SERVER_PORT}/ws/agent"
DOWNLOAD_URL="http://${SERVER_HOST}:${SERVER_PORT}/downloads/maintainer-agent"

echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  Maintainer Agent - Smart Install/Update${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
  echo -e "${RED}Error: Please run as root (use sudo)${NC}"
  exit 1
fi

# Detect if this is an update or fresh install
IS_UPDATE=false
if [ -f "/usr/local/bin/maintainer-agent" ]; then
    IS_UPDATE=true
    echo -e "${BLUE}[INFO] Existing agent detected - performing UPDATE${NC}"
else
    echo -e "${BLUE}[INFO] No existing agent - performing FRESH INSTALL${NC}"
fi
echo ""

# Stop existing agent if running
if systemctl is-active --quiet maintainer-agent 2>/dev/null; then
    echo -e "${YELLOW}[1/7] Stopping existing agent...${NC}"
    systemctl stop maintainer-agent
    echo -e "${GREEN}✓ Agent stopped${NC}"
else
    echo -e "${YELLOW}[1/7] No running agent to stop${NC}"
fi
echo ""

# Backup existing binary if exists
if [ "$IS_UPDATE" = true ]; then
    echo -e "${YELLOW}[2/7] Backing up existing binary...${NC}"
    BACKUP_FILE="/usr/local/bin/maintainer-agent.backup-$(date +%Y%m%d-%H%M%S)"
    cp /usr/local/bin/maintainer-agent "$BACKUP_FILE"
    echo -e "${GREEN}✓ Backup created: $BACKUP_FILE${NC}"
else
    echo -e "${YELLOW}[2/7] No existing binary to backup${NC}"
fi
echo ""

# Download new agent binary
echo -e "${YELLOW}[3/7] Downloading new agent binary...${NC}"
echo -e "${BLUE}   URL: $DOWNLOAD_URL${NC}"

if curl -f -L -o /usr/local/bin/maintainer-agent "$DOWNLOAD_URL" 2>/dev/null; then
    chmod +x /usr/local/bin/maintainer-agent
    BINARY_SIZE=$(ls -lh /usr/local/bin/maintainer-agent | awk '{print $5}')
    echo -e "${GREEN}✓ Binary downloaded ($BINARY_SIZE)${NC}"
else
    echo -e "${RED}✗ Download failed!${NC}"
    
    if [ "$IS_UPDATE" = true ] && [ -f "$BACKUP_FILE" ]; then
        echo -e "${YELLOW}Restoring backup...${NC}"
        mv "$BACKUP_FILE" /usr/local/bin/maintainer-agent
        systemctl start maintainer-agent
    fi
    
    echo -e "${RED}Error: Could not download agent from $DOWNLOAD_URL${NC}"
    echo -e "${YELLOW}Please check:${NC}"
    echo -e "  1. Server is running"
    echo -e "  2. Binary exists in server/public/downloads/"
    echo -e "  3. Network connectivity"
    exit 1
fi
echo ""

# Handle configuration
echo -e "${YELLOW}[4/7] Handling configuration...${NC}"

CONFIG_FILE="/etc/maintainer-agent/config.json"
CONFIG_DIR="/etc/maintainer-agent"

# Create config directory if needed
mkdir -p "$CONFIG_DIR"

if [ -f "$CONFIG_FILE" ]; then
    echo -e "${BLUE}   Existing config found${NC}"
    
    # Read existing config
    EXISTING_SECRET=$(grep -Po '"secret_key"\s*:\s*"\K[^"]+' "$CONFIG_FILE" 2>/dev/null || echo "")
    EXISTING_SERVER=$(grep -Po '"server_url"\s*:\s*"\K[^"]+' "$CONFIG_FILE" 2>/dev/null || echo "")
    
    if [ -n "$EXISTING_SECRET" ]; then
        echo -e "${BLUE}   Found existing secret key (length: ${#EXISTING_SECRET})${NC}"
        
        # Check if secret key needs migration (not 64 hex chars)
        if [[ ! "$EXISTING_SECRET" =~ ^[a-fA-F0-9]{64}$ ]]; then
            echo -e "${YELLOW}   ⚠️  Secret key needs migration (invalid format)${NC}"
            echo -e "${BLUE}   Auto-migrating secret key via SHA-256 hash...${NC}"
            
            # The agent will auto-migrate on startup via normalizeSecretKey()
            # But we can also do it here for immediate visibility
            MIGRATED_SECRET=$(echo -n "$EXISTING_SECRET" | sha256sum | awk '{print $1}')
            
            # Update config with migrated key
            cat > "$CONFIG_FILE" <<EOF
{
  "server_url": "${EXISTING_SERVER:-$SERVER_URL}",
  "secret_key": "$MIGRATED_SECRET"
}
EOF
            chmod 600 "$CONFIG_FILE"
            
            echo -e "${GREEN}✓ Secret key migrated: ${MIGRATED_SECRET:0:16}...${NC}"
            echo -e "${YELLOW}   NOTE: The OLD key was hashed to create a NEW key${NC}"
            echo -e "${YELLOW}   You must register this machine again in the web UI${NC}"
        else
            echo -e "${GREEN}✓ Secret key is valid (64 hex chars)${NC}"
            
            # Just update server URL if different
            if [ "$EXISTING_SERVER" != "$SERVER_URL" ]; then
                echo -e "${YELLOW}   Updating server URL to: $SERVER_URL${NC}"
                cat > "$CONFIG_FILE" <<EOF
{
  "server_url": "$SERVER_URL",
  "secret_key": "$EXISTING_SECRET"
}
EOF
                chmod 600 "$CONFIG_FILE"
            fi
        fi
        
        SECRET_KEY="$EXISTING_SECRET"
    else
        echo -e "${YELLOW}   Config exists but no secret key found${NC}"
        SECRET_KEY=$(openssl rand -hex 32)
        
        cat > "$CONFIG_FILE" <<EOF
{
  "server_url": "$SERVER_URL",
  "secret_key": "$SECRET_KEY"
}
EOF
        chmod 600 "$CONFIG_FILE"
        
        echo -e "${GREEN}✓ New secret key generated${NC}"
    fi
else
    echo -e "${BLUE}   No existing config - creating new${NC}"
    
    # Generate new secret key (already 64 hex chars)
    SECRET_KEY=$(openssl rand -hex 32)
    
    cat > "$CONFIG_FILE" <<EOF
{
  "server_url": "$SERVER_URL",
  "secret_key": "$SECRET_KEY"
}
EOF
    chmod 600 "$CONFIG_FILE"
    
    echo -e "${GREEN}✓ Config created${NC}"
    echo -e "${GREEN}✓ Secret key: ${SECRET_KEY}${NC}"
fi
echo ""

# Create/update systemd service
echo -e "${YELLOW}[5/7] Setting up systemd service...${NC}"
cat > /etc/systemd/system/maintainer-agent.service <<EOF
[Unit]
Description=Maintainer Agent - VM Monitoring and Management
After=network.target

[Service]
Type=simple
User=root
ExecStart=/usr/local/bin/maintainer-agent -config /etc/maintainer-agent/config.json
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable maintainer-agent
echo -e "${GREEN}✓ Service configured${NC}"
echo ""

# Start service
echo -e "${YELLOW}[6/7] Starting agent service...${NC}"
systemctl start maintainer-agent
sleep 2
echo ""

# Check status
echo -e "${YELLOW}[7/7] Verifying service status...${NC}"
if systemctl is-active --quiet maintainer-agent; then
    echo -e "${GREEN}✓ Agent is running${NC}"
    echo ""
    
    # Show recent logs
    echo -e "${BLUE}Recent logs:${NC}"
    journalctl -u maintainer-agent -n 10 --no-pager | tail -n 5
    echo ""
    
    echo -e "${GREEN}============================================${NC}"
    if [ "$IS_UPDATE" = true ]; then
        echo -e "${GREEN}  Update Successful! ✓${NC}"
    else
        echo -e "${GREEN}  Installation Successful! ✓${NC}"
    fi
    echo -e "${GREEN}============================================${NC}"
    echo ""
    echo -e "Server:     ${YELLOW}${SERVER_URL}${NC}"
    echo -e "Secret Key: ${YELLOW}${SECRET_KEY:0:16}...${NC} (64 chars)"
    echo ""
    echo -e "${GREEN}The agent is now running and will connect to the server.${NC}"
    echo ""
    echo -e "${BLUE}Useful commands:${NC}"
    echo -e "  Status:  ${YELLOW}sudo systemctl status maintainer-agent${NC}"
    echo -e "  Logs:    ${YELLOW}sudo journalctl -u maintainer-agent -f${NC}"
    echo -e "  Restart: ${YELLOW}sudo systemctl restart maintainer-agent${NC}"
    echo ""
    
    if [ "$IS_UPDATE" = true ]; then
        echo -e "${YELLOW}NOTE: If this was a protocol update, the agent will:${NC}"
        echo -e "  1. Auto-migrate secret key format (if needed)"
        echo -e "  2. Use new protocol with 'type' fields"
        echo -e "  3. Register with server automatically"
        echo ""
    fi
else
    echo -e "${RED}✗ Service failed to start${NC}"
    echo ""
    echo -e "${RED}============================================${NC}"
    if [ "$IS_UPDATE" = true ]; then
        echo -e "${RED}  Update Failed${NC}"
    else
        echo -e "${RED}  Installation Failed${NC}"
    fi
    echo -e "${RED}============================================${NC}"
    echo ""
    echo -e "${RED}The service failed to start. Check logs:${NC}"
    echo -e "${YELLOW}sudo journalctl -u maintainer-agent -xe${NC}"
    echo ""
    
    if [ "$IS_UPDATE" = true ] && [ -f "$BACKUP_FILE" ]; then
        echo -e "${YELLOW}Backup available at: $BACKUP_FILE${NC}"
        echo -e "${YELLOW}To restore: sudo mv $BACKUP_FILE /usr/local/bin/maintainer-agent${NC}"
        echo ""
    fi
    
    exit 1
fi
