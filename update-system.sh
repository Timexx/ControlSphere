#!/bin/bash
# NOTE: Do NOT use "set -e" here — the agent build (step 4) may fail
# on machines without Go installed, and the server must still restart.

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# ── Detect the project root ──
# The execute route passes CS_INSTALL_DIR (most reliable).
# Fallback: if the script runs from a directory whose basename is "logs",
# go up one level.  Direct invocation uses the script's own directory.
if [ -n "$CS_INSTALL_DIR" ]; then
    INSTALL_DIR="$CS_INSTALL_DIR"
else
    SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
    if [ "$(basename "$SCRIPT_DIR")" = "logs" ]; then
        INSTALL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
    else
        INSTALL_DIR="$SCRIPT_DIR"
    fi
fi

# ── Status file for UI feedback ──────────────────────────────────────────
STATUS_FILE="$INSTALL_DIR/logs/update-status.json"
mkdir -p "$INSTALL_DIR/logs" 2>/dev/null || true

write_status() {
    local phase="$1"
    local message="${2:-}"
    local tmp="${STATUS_FILE}.tmp"
    local timestamp
    timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date +%s)
    printf '{"phase":"%s","message":"%s","timestamp":"%s","pid":%d}\n' \
        "$phase" "$message" "$timestamp" $$ > "$tmp" 2>/dev/null
    mv "$tmp" "$STATUS_FILE" 2>/dev/null || true
}

# ── Logging ───────────────────────────────────────────────────────────────────
if [ -f "$INSTALL_DIR/scripts/log-helper.sh" ]; then
    source "$INSTALL_DIR/scripts/log-helper.sh"
    init_log "update"
    rotate_logs "update" 10
    enable_logging
    trap 'ec=$?; if [ $ec -ne 0 ] && [ "$UPDATE_COMPLETED" != "true" ]; then write_status "failed" "Script exited with code $ec"; fi; finalize_log $ec' EXIT
    echo -e "${BLUE}Log: ${LOG_FILE}${NC}"
    echo ""
else
    trap 'ec=$?; if [ $ec -ne 0 ] && [ "$UPDATE_COMPLETED" != "true" ]; then write_status "failed" "Script exited with code $ec"; fi' EXIT
fi

echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  ControlSphere System Update${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""

echo -e "${BLUE}Working directory: ${INSTALL_DIR}${NC}"
cd "$INSTALL_DIR"

# ── Pre-flight: check write access ────────────────────────────────────────
if ! touch "$INSTALL_DIR/.write-test" 2>/dev/null; then
    echo -e "${RED}ERROR: Install directory is read-only!${NC}"
    echo -e "${YELLOW}This usually means the systemd unit has ReadWritePaths set too narrowly.${NC}"
    echo -e "${YELLOW}Run the following command on the server to fix it:${NC}"
    echo ""
    echo -e "  sudo sed -i 's|ReadWritePaths=.*|ReadWritePaths=${INSTALL_DIR}|' /etc/systemd/system/controlsphere.service && sudo systemctl daemon-reload && sudo systemctl restart controlsphere.service"
    echo ""
    write_status "failed" "Install directory is read-only (systemd ProtectSystem). Fix ReadWritePaths in controlsphere.service."
    exit 1
fi
rm -f "$INSTALL_DIR/.write-test"

# Ensure this is a git repository (handle installs via archive/scp)
REPO_URL="https://github.com/timexx/controlsphere.git"
if [ ! -d ".git" ]; then
    echo -e "${YELLOW}No .git directory found – initialising repository...${NC}"
    git init -b main
    git remote add origin "$REPO_URL"
    git fetch origin main
    echo -e "${GREEN}Git repository initialised${NC}"
fi

# ── Step 1: Stop services & free port ──────────────────────────────────────
echo ""
echo -e "${BLUE}[1/7] Stopping services...${NC}"
write_status "stopping" "Stopping services..."

if [[ "$OSTYPE" == "linux"* ]]; then
    if systemctl list-units --type=service 2>/dev/null | grep -q controlsphere; then
        sudo systemctl stop controlsphere.service 2>/dev/null || true
        echo -e "${GREEN}Service stopped${NC}"
    fi
    # Graceful shutdown: SIGTERM first, then force after 10s
    PIDS=$(sudo lsof -ti:3000 2>/dev/null || true)
    if [ -n "$PIDS" ]; then
        echo "$PIDS" | xargs sudo kill -15 2>/dev/null || true
        for i in $(seq 1 10); do
            if ! sudo lsof -ti:3000 &>/dev/null; then break; fi
            sleep 1
        done
        # Force kill only if still running
        PIDS=$(sudo lsof -ti:3000 2>/dev/null || true)
        if [ -n "$PIDS" ]; then
            echo "$PIDS" | xargs sudo kill -9 2>/dev/null || true
            sleep 1
        fi
    fi
elif [[ "$OSTYPE" == "darwin"* ]]; then
    PLIST_FILE="$HOME/Library/LaunchAgents/com.controlsphere.server.plist"
    if [ -f "$PLIST_FILE" ]; then
        launchctl unload "$PLIST_FILE" 2>/dev/null || true
        echo -e "${GREEN}Service stopped (launchd)${NC}"
    fi
    PIDS=$(lsof -ti:3000 2>/dev/null || true)
    if [ -n "$PIDS" ]; then
        echo "$PIDS" | xargs kill -15 2>/dev/null || true
        for i in $(seq 1 10); do
            if ! lsof -ti:3000 &>/dev/null; then break; fi
            sleep 1
        done
        PIDS=$(lsof -ti:3000 2>/dev/null || true)
        if [ -n "$PIDS" ]; then
            echo "$PIDS" | xargs kill -9 2>/dev/null || true
            sleep 1
        fi
    fi
fi
echo -e "${GREEN}Port 3000 is free${NC}"

# ── Step 2: Pull latest code (in-place, no copy) ──────────────────────────
echo ""
echo -e "${BLUE}[2/7] Updating repository (in-place)...${NC}"
write_status "pulling" "Fetching latest code..."

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

if ! git reset --hard "origin/${BRANCH}"; then
    write_status "failed" "git reset --hard failed"
    echo -e "${RED}git reset failed${NC}"
    exit 1
fi
echo -e "${GREEN}Repository updated to latest origin/${BRANCH}${NC}"

# Re-apply stashed changes (restores .env etc.)
git stash pop 2>/dev/null || true

# Fix ownership if prior root run left artifacts
CURRENT_USER="${SUDO_USER:-$(whoami)}"
if [ -d "server/node_modules" ]; then
    OWNER=$(stat -c '%U' server/node_modules 2>/dev/null || stat -f '%Su' server/node_modules 2>/dev/null || echo "")
    if [ -n "$OWNER" ] && [ "$OWNER" != "$CURRENT_USER" ]; then
        sudo chown -R "$CURRENT_USER":"$CURRENT_USER" server/node_modules server/.next 2>/dev/null || true
        echo -e "${GREEN}Fixed file ownership${NC}"
    fi
fi

# ── Step 3: Clean old agent binaries ──────────────────────────────────────
echo ""
echo -e "${BLUE}[3/7] Cleaning old agent binaries...${NC}"
write_status "building_agents" "Cleaning old agent binaries..."

CURRENT_USER="${SUDO_USER:-$(whoami)}"
if [ -d "agent/bin" ]; then
    sudo rm -f agent/bin/maintainer-agent* 2>/dev/null || rm -f agent/bin/maintainer-agent* 2>/dev/null || true
    # Fix ownership so the normal user can write new binaries
    sudo chown -R "$CURRENT_USER":"$CURRENT_USER" agent/bin 2>/dev/null || true
    echo -e "${GREEN}Old binaries deleted from agent/bin${NC}"
fi
if [ -d "server/public/downloads" ]; then
    sudo rm -f server/public/downloads/maintainer-agent* 2>/dev/null || true
    sudo chown -R "$CURRENT_USER":"$CURRENT_USER" server/public/downloads 2>/dev/null || true
    echo -e "${GREEN}Old binaries deleted from downloads directory${NC}"
fi
if [ -d "server/public/download" ]; then
    sudo rm -f server/public/download/maintainer-agent* 2>/dev/null || true
    sudo chown -R "$CURRENT_USER":"$CURRENT_USER" server/public/download 2>/dev/null || true
    echo -e "${GREEN}Old binaries deleted from download directory${NC}"
fi

# ── Step 4: Rebuild agent binaries ────────────────────────────────────────
echo ""
echo -e "${BLUE}[4/7] Rebuilding agent binaries...${NC}"
write_status "building_agents" "Rebuilding agent binaries..."

if [ -f "server/scripts/build-agents-if-needed.sh" ]; then
    chmod +x server/scripts/build-agents-if-needed.sh
    if ./server/scripts/build-agents-if-needed.sh; then
        echo -e "${GREEN}Agent binaries rebuilt${NC}"
    else
        echo -e "${YELLOW}Agent build finished with warnings – check output above${NC}"
    fi
elif [ -f "agent/build-agent.sh" ]; then
    chmod +x agent/build-agent.sh
    if (cd agent && ./build-agent.sh); then
        echo -e "${GREEN}Agent binaries rebuilt${NC}"
    else
        echo -e "${YELLOW}Agent build finished with warnings${NC}"
    fi
else
    echo -e "${YELLOW}No agent build script found, skipping agent rebuild${NC}"
fi

# ── Step 5: Build server ─────────────────────────────────────────────────
echo ""
echo -e "${BLUE}[5/7] Building server...${NC}"

cd "$INSTALL_DIR/server"

# 5a: Install/update dependencies (devDeps needed for build + ts-node at runtime)
write_status "building" "Installing dependencies..."
echo -e "${YELLOW}Installing dependencies...${NC}"
if ! npm install 2>&1; then
    write_status "failed" "npm install failed"
    echo -e "${RED}npm install failed${NC}"
    exit 1
fi
echo -e "${GREEN}Dependencies installed${NC}"

# 5b: Apply database migrations
write_status "building" "Applying database migrations..."
echo -e "${YELLOW}Applying database migrations...${NC}"
if ! npx prisma migrate deploy 2>&1; then
    write_status "failed" "Database migration failed"
    echo -e "${RED}Prisma migration failed${NC}"
    exit 1
fi
echo -e "${GREEN}Database migrations applied${NC}"

# 5c: Build Next.js (includes prisma generate via package.json build script)
write_status "building" "Building application..."
echo -e "${YELLOW}Building application...${NC}"
if ! npm run build 2>&1; then
    write_status "failed" "npm run build failed"
    echo -e "${RED}Build failed${NC}"
    exit 1
fi

# 5d: Verify build output
if [ ! -d ".next" ] || [ ! -f ".next/BUILD_ID" ]; then
    write_status "failed" "Build output missing (.next directory)"
    echo -e "${RED}Build output not found${NC}"
    exit 1
fi
echo -e "${GREEN}Server built successfully${NC}"
cd "$INSTALL_DIR"

# ── Step 6: Start service ────────────────────────────────────────────────
echo ""
echo -e "${BLUE}[6/7] Starting service...${NC}"
write_status "starting" "Starting service..."

if [[ "$OSTYPE" == "linux"* ]]; then
    sudo systemctl daemon-reload
    sudo systemctl restart controlsphere.service
    sleep 2
    if sudo systemctl is-active --quiet controlsphere.service 2>/dev/null; then
        echo -e "${GREEN}ControlSphere service started${NC}"
    else
        echo -e "${YELLOW}Service may still be starting...${NC}"
    fi
elif [[ "$OSTYPE" == "darwin"* ]]; then
    PLIST_FILE="$HOME/Library/LaunchAgents/com.controlsphere.server.plist"
    if [ -f "$PLIST_FILE" ]; then
        launchctl load "$PLIST_FILE" 2>/dev/null || true
        echo -e "${GREEN}ControlSphere service started (launchd)${NC}"
    else
        echo -e "${YELLOW}No launchd plist found – starting server manually...${NC}"
        cd "$INSTALL_DIR/server"
        NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 nohup npm start > "$INSTALL_DIR/logs/server-stdout.log" 2>&1 &
        cd "$INSTALL_DIR"
    fi
fi

# ── Step 7: Health check ─────────────────────────────────────────────────
echo ""
echo -e "${BLUE}[7/7] Verifying server health...${NC}"
write_status "health_check" "Waiting for server to respond..."

SERVICE_OK=false
PORT_OK=false

if [[ "$OSTYPE" == "linux"* ]]; then
    # Wait up to 30s for systemd to confirm service is active
    for i in $(seq 1 15); do
        if sudo systemctl is-active --quiet controlsphere.service 2>/dev/null; then
            SERVICE_OK=true
            break
        fi
        sleep 2
    done

    if [ "$SERVICE_OK" = "false" ]; then
        echo -e "${RED}Service failed to start${NC}"
        sudo journalctl -u controlsphere --no-pager -n 30 2>/dev/null || true
        write_status "failed" "Service failed to start"
        exit 1
    fi

    # Service is active — additionally verify port is open (informational, non-fatal)
    for i in $(seq 1 10); do
        if ss -tlnp 2>/dev/null | grep -q ':3000 '; then
            PORT_OK=true
            break
        fi
        sleep 2
    done

elif [[ "$OSTYPE" == "darwin"* ]]; then
    sleep 5
    if lsof -ti:3000 &>/dev/null; then
        SERVICE_OK=true
        PORT_OK=true
    fi
fi

if [ "$SERVICE_OK" = "true" ]; then
    UPDATE_COMPLETED=true
    if [ "$PORT_OK" = "true" ]; then
        write_status "completed" "Update successful"
        echo -e "${GREEN}Server is running and port 3000 is open${NC}"
    else
        write_status "completed" "Update successful (service active)"
        echo -e "${GREEN}Service is active${NC}"
        echo -e "${YELLOW}Note: Port 3000 not yet visible via ss — service may still be initializing${NC}"
    fi
else
    write_status "failed" "Service not active after restart"
    echo -e "${RED}Service is not active after restart${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  System update completed!${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""

# Show web interface URL
SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || ipconfig getifaddr en0 2>/dev/null || echo "localhost")
echo -e "${BLUE}Web interface:${NC}"
echo -e "  ${GREEN}http://localhost:3000${NC}"
echo -e "  ${GREEN}http://$SERVER_IP:3000${NC}"
echo ""
echo -e "${YELLOW}Note: If the agent binary was updated, you may need to update the agents on all connected clients.${NC}"
echo -e "${YELLOW}  Agents can be updated from the web interface or by re-running the install script on each client.${NC}"
echo ""

# ── Auto-fix: ensure systemd ReadWritePaths covers the full install dir ───
if [[ "$OSTYPE" == "linux"* ]] && [ -f /etc/systemd/system/controlsphere.service ]; then
    CURRENT_RW=$(grep -oP 'ReadWritePaths=\K.*' /etc/systemd/system/controlsphere.service 2>/dev/null || true)
    if [ -n "$CURRENT_RW" ] && [ "$CURRENT_RW" != "$INSTALL_DIR" ]; then
        echo -e "${YELLOW}Fixing systemd ReadWritePaths ($CURRENT_RW → $INSTALL_DIR)...${NC}"
        if sudo sed -i "s|ReadWritePaths=.*|ReadWritePaths=${INSTALL_DIR}|" /etc/systemd/system/controlsphere.service 2>/dev/null; then
            sudo systemctl daemon-reload 2>/dev/null || true
            echo -e "${GREEN}systemd unit updated — next restart will have full write access${NC}"
        else
            echo -e "${YELLOW}Could not auto-fix ReadWritePaths (no sudo access). Run manually:${NC}"
            echo -e "  sudo sed -i 's|ReadWritePaths=.*|ReadWritePaths=${INSTALL_DIR}|' /etc/systemd/system/controlsphere.service && sudo systemctl daemon-reload"
        fi
    fi
fi
