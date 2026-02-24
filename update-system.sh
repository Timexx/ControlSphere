#!/bin/bash
set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  ControlSphere System Update${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""

# Repository URL
REPO_URL="https://github.com/timexx/controlsphere.git"
INSTALL_DIR="${HOME}/controlsphere"
BACKUP_DIR="${HOME}/controlsphere-backup-$(date +%Y%m%d-%H%M%S)"

# Check if already in controlsphere directory
if [[ $(basename "$PWD") == "controlsphere" ]] || [[ $(basename $(dirname "$PWD")) == "controlsphere" ]]; then
    echo -e "${YELLOW}⚠️  You are already in the controlsphere directory.${NC}"
    echo -e "${YELLOW}Update will be performed in the parent directory.${NC}"
    cd "$HOME"
fi

# Step 1: Clone or Update Repository
echo -e "${BLUE}[1/5] Updating repository...${NC}"
if [ -d "$INSTALL_DIR" ]; then
    echo -e "${YELLOW}Directory already exists. Creating backup...${NC}"
    
    # Backup current installation
    cp -r "$INSTALL_DIR" "$BACKUP_DIR"
    echo -e "${GREEN}✓ Backup created: $BACKUP_DIR${NC}"
    
    # Update existing repository
    cd "$INSTALL_DIR"
    echo "Updating repository..."
    git fetch origin
    git reset --hard origin/main || git reset --hard origin/master
    git pull
    echo -e "${GREEN}✓ Repository updated${NC}"
else
    echo "Cloning repository..."
    git clone "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
    echo -e "${GREEN}✓ Repository cloned${NC}"
fi

# Step 2: Clean old agent binaries
echo ""
echo -e "${BLUE}[2/5] Cleaning old agent binaries...${NC}"
if [ -d "agent/bin" ]; then
    rm -f agent/bin/maintainer-agent*
    echo -e "${GREEN}✓ Old binaries deleted from agent/bin${NC}"
else
    echo -e "${YELLOW}⚠️  agent/bin directory not found${NC}"
fi

# Also clean download directory if it exists
if [ -d "server/public/download" ]; then
    rm -f server/public/download/maintainer-agent*
    echo -e "${GREEN}✓ Old binaries deleted from download directory${NC}"
fi

# Step 3: Run server setup
echo ""
echo -e "${BLUE}[3/5] Running server setup...${NC}"
if [ -f "setup-server.sh" ]; then
    chmod +x setup-server.sh
    sudo ./setup-server.sh
    echo -e "${GREEN}✓ Server setup completed${NC}"
else
    echo -e "${RED}✗ setup-server.sh not found!${NC}"
    exit 1
fi

# Step 4: Rebuild agents
echo ""
echo -e "${BLUE}[4/5] Rebuilding agent binaries...${NC}"
if [ -f "build-agent.sh" ]; then
    chmod +x build-agent.sh
    ./build-agent.sh
    echo -e "${GREEN}✓ Agent binaries rebuilt${NC}"
elif [ -f "agent/build-agent.sh" ]; then
    chmod +x agent/build-agent.sh
    cd agent
    ./build-agent.sh
    cd ..
    echo -e "${GREEN}✓ Agent binaries rebuilt${NC}"
else
    echo -e "${YELLOW}⚠️  Build script not found. Binaries will be built automatically on next start.${NC}"
fi

# Step 5: Restart services
echo ""
echo -e "${BLUE}[5/5] Restarting services...${NC}"
if [[ "$OSTYPE" == "linux"* ]]; then
    if systemctl list-units --type=service | grep -q controlsphere; then
        sudo systemctl daemon-reload
        sudo systemctl restart controlsphere.service
        sleep 2
        if sudo systemctl is-active --quiet controlsphere.service; then
            echo -e "${GREEN}✓ ControlSphere service restarted successfully${NC}"
        else
            echo -e "${RED}✗ Service failed to start. Check logs: sudo journalctl -u controlsphere -f${NC}"
        fi
    else
        echo -e "${YELLOW}⚠️  No controlsphere systemd service found. Setup will create it.${NC}"
    fi
elif [[ "$OSTYPE" == "darwin"* ]]; then
    PLIST_FILE="$HOME/Library/LaunchAgents/com.controlsphere.server.plist"
    if [ -f "$PLIST_FILE" ]; then
        launchctl unload "$PLIST_FILE" 2>/dev/null || true
        launchctl load "$PLIST_FILE"
        echo -e "${GREEN}✓ ControlSphere service restarted (launchd)${NC}"
    else
        echo -e "${YELLOW}⚠️  No launchd service found.${NC}"
    fi
fi

echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  ✓ System update completed!${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""

# Show web interface URL
SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || ipconfig getifaddr en0 2>/dev/null || echo "localhost")
echo -e "${BLUE}Web interface:${NC}"
echo -e "  ${GREEN}http://localhost:3000${NC}"
echo -e "  ${GREEN}http://$SERVER_IP:3000${NC}"
echo ""
echo -e "${YELLOW}⚠️  Note: If the agent binary was updated, you may need to update the agents on all connected clients.${NC}"
echo -e "${YELLOW}   Agents can be updated from the web interface or by re-running the install script on each client.${NC}"
echo ""
