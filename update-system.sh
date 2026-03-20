#!/bin/bash
set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# ── Detect the directory where THIS script lives ──
# This ensures we always update in-place, no matter where we run from
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="$SCRIPT_DIR"

# ── Logging ───────────────────────────────────────────────────────────────────
if [ -f "$INSTALL_DIR/scripts/log-helper.sh" ]; then
    source "$INSTALL_DIR/scripts/log-helper.sh"
    init_log "update"
    rotate_logs "update" 10
    enable_logging
    trap 'finalize_log $?' EXIT
    echo -e "${BLUE}📄 Log: ${LOG_FILE}${NC}"
    echo ""
fi

echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  ControlSphere System Update${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""

echo -e "${BLUE}Working directory: ${INSTALL_DIR}${NC}"
cd "$INSTALL_DIR"

# Ensure this is a git repository (handle installs via archive/scp)
REPO_URL="https://github.com/timexx/controlsphere.git"
if [ ! -d ".git" ]; then
    echo -e "${YELLOW}⚠ No .git directory found – initialising repository...${NC}"
    git init -b main
    git remote add origin "$REPO_URL"
    # Perform an initial fetch so we have a valid origin/main ref
    git fetch origin main
    echo -e "${GREEN}✓ Git repository initialised${NC}"
fi

# ── Step 1: Stop services & free port ──────────────────────────────────────
echo ""
echo -e "${BLUE}[1/6] Stopping services...${NC}"
if [[ "$OSTYPE" == "linux"* ]]; then
    if systemctl list-units --type=service 2>/dev/null | grep -q controlsphere; then
        sudo systemctl stop controlsphere.service 2>/dev/null || true
        echo -e "${GREEN}✓ Service stopped${NC}"
    fi
    # Kill any leftover process on port 3000
    sudo lsof -ti:3000 2>/dev/null | xargs sudo kill -9 2>/dev/null || true
elif [[ "$OSTYPE" == "darwin"* ]]; then
    PLIST_FILE="$HOME/Library/LaunchAgents/com.controlsphere.server.plist"
    if [ -f "$PLIST_FILE" ]; then
        launchctl unload "$PLIST_FILE" 2>/dev/null || true
        echo -e "${GREEN}✓ Service stopped (launchd)${NC}"
    fi
    lsof -ti:3000 2>/dev/null | xargs kill -9 2>/dev/null || true
fi
sleep 1
echo -e "${GREEN}✓ Port 3000 is free${NC}"

# ── Step 2: Pull latest code (in-place, no copy) ──────────────────────────
echo ""
echo -e "${BLUE}[2/6] Updating repository (in-place)...${NC}"

# Stash any local changes (e.g. .env modifications) so git pull works
git stash --include-untracked 2>/dev/null || true

# Ensure remote points to the correct URL
if git remote get-url origin &>/dev/null; then
    git remote set-url origin "$REPO_URL"
else
    git remote add origin "$REPO_URL"
fi
BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "main")

echo -e "${YELLOW}Fetching updates from ${REPO_URL}...${NC}"
git fetch "$REPO_URL" "${BRANCH}:refs/remotes/origin/${BRANCH}" 2>/dev/null || \
    git fetch "$REPO_URL" "main:refs/remotes/origin/main" 2>/dev/null || \
    git fetch origin

git reset --hard "origin/${BRANCH}"
echo -e "${GREEN}✓ Repository updated to latest origin/${BRANCH}${NC}"

# Re-apply stashed changes (restores .env etc.)
git stash pop 2>/dev/null || true

# ── Step 3: Clean old agent binaries ──────────────────────────────────────
echo ""
echo -e "${BLUE}[3/6] Cleaning old agent binaries...${NC}"
if [ -d "agent/bin" ]; then
    sudo rm -f agent/bin/maintainer-agent* 2>/dev/null || rm -f agent/bin/maintainer-agent* 2>/dev/null || true
    echo -e "${GREEN}✓ Old binaries deleted from agent/bin${NC}"
fi
if [ -d "server/public/downloads" ]; then
    sudo rm -f server/public/downloads/maintainer-agent* 2>/dev/null || true
    echo -e "${GREEN}✓ Old binaries deleted from downloads directory${NC}"
fi
if [ -d "server/public/download" ]; then
    sudo rm -f server/public/download/maintainer-agent* 2>/dev/null || true
    echo -e "${GREEN}✓ Old binaries deleted from download directory${NC}"
fi

# ── Step 4: Rebuild agent binaries ────────────────────────────────────────
echo ""
echo -e "${BLUE}[4/6] Rebuilding agent binaries...${NC}"
if [ -f "server/scripts/build-agents-if-needed.sh" ]; then
    chmod +x server/scripts/build-agents-if-needed.sh
    if ./server/scripts/build-agents-if-needed.sh; then
        echo -e "${GREEN}✓ Agent binaries rebuilt${NC}"
    else
        echo -e "${YELLOW}⚠ Agent build finished with warnings – check output above${NC}"
    fi
elif [ -f "agent/build-agent.sh" ]; then
    chmod +x agent/build-agent.sh
    if (cd agent && ./build-agent.sh); then
        echo -e "${GREEN}✓ Agent binaries rebuilt${NC}"
    else
        echo -e "${YELLOW}⚠ Agent build finished with warnings${NC}"
    fi
else
    echo -e "${YELLOW}⚠ No agent build script found, skipping agent rebuild${NC}"
fi

# ── Step 5: Run server setup ──────────────────────────────────────────────
echo ""
echo -e "${BLUE}[5/6] Running server setup...${NC}"
if [ -f "setup-server.sh" ]; then
    chmod +x setup-server.sh
    sudo ./setup-server.sh
    echo -e "${GREEN}✓ Server setup completed${NC}"

    # Fix file ownership (setup runs as root, service runs as user)
    CURRENT_USER="${SUDO_USER:-$(whoami)}"
    if [ -d "server/node_modules" ]; then
        sudo chown -R "$CURRENT_USER":"$CURRENT_USER" server/node_modules 2>/dev/null || true
        sudo chown -R "$CURRENT_USER":"$CURRENT_USER" server/.next 2>/dev/null || true
        echo -e "${GREEN}✓ File permissions fixed${NC}"
    fi
else
    echo -e "${RED}✗ setup-server.sh not found!${NC}"
    exit 1
fi

# ── Step 6: Ensure service is running ─────────────────────────────────────
echo ""
echo -e "${BLUE}[6/6] Starting service...${NC}"

# setup-server.sh already starts the service, but verify it's running
sleep 3
if [[ "$OSTYPE" == "linux"* ]]; then
    if sudo systemctl is-active --quiet controlsphere.service 2>/dev/null; then
        echo -e "${GREEN}✓ ControlSphere service is running${NC}"
    else
        echo -e "${YELLOW}Restarting service...${NC}"
        sudo systemctl daemon-reload
        sudo systemctl restart controlsphere.service
        sleep 3
        if sudo systemctl is-active --quiet controlsphere.service; then
            echo -e "${GREEN}✓ ControlSphere service restarted successfully${NC}"
        else
            echo -e "${RED}✗ Service failed to start. Check logs:${NC}"
            echo -e "  sudo journalctl -u controlsphere -f"
        fi
    fi
elif [[ "$OSTYPE" == "darwin"* ]]; then
    PLIST_FILE="$HOME/Library/LaunchAgents/com.controlsphere.server.plist"
    if [ -f "$PLIST_FILE" ]; then
        launchctl load "$PLIST_FILE" 2>/dev/null || true
        echo -e "${GREEN}✓ ControlSphere service started (launchd)${NC}"
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
