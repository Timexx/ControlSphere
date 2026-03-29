#!/bin/bash
set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# ── Logging ───────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$SCRIPT_DIR/scripts/log-helper.sh" ]; then
    source "$SCRIPT_DIR/scripts/log-helper.sh"
    init_log "setup"
    rotate_logs "setup" 10
    enable_logging
    trap 'finalize_log $?' EXIT
    echo -e "${BLUE}📄 Log: ${LOG_FILE}${NC}"
    echo ""
fi

echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  MaintainerWeb Server Setup${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""

# Detect OS
detect_os() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "macos"
    elif [ -f /etc/debian_version ]; then
        echo "debian"
    elif [ -f /etc/redhat-release ]; then
        echo "redhat"
    elif [ -f /etc/alpine-release ]; then
        echo "alpine"
    else
        echo "unknown"
    fi
}

# Install PostgreSQL automatically
install_postgresql() {
    local os=$(detect_os)
    echo -e "${BLUE}Installing PostgreSQL...${NC}"
    case $os in
        macos)
            if command -v brew &> /dev/null; then
                brew install postgresql@16 2>/dev/null || true
                brew services start postgresql@16 2>/dev/null || true
                export PATH="/opt/homebrew/opt/postgresql@16/bin:/usr/local/opt/postgresql@16/bin:$PATH"
            else
                echo -e "${RED}Homebrew not found – cannot auto-install PostgreSQL on macOS.${NC}"
                echo -e "${YELLOW}Install Homebrew first: https://brew.sh${NC}"
                exit 1
            fi
            ;;
        debian)
            sudo apt-get update -qq
            sudo apt-get install -y postgresql postgresql-contrib
            sudo systemctl enable postgresql
            sudo systemctl start postgresql
            ;;
        redhat)
            sudo yum install -y postgresql-server postgresql-contrib 2>/dev/null || \
                sudo dnf install -y postgresql-server postgresql-contrib
            sudo postgresql-setup --initdb 2>/dev/null || true
            sudo systemctl enable postgresql
            sudo systemctl start postgresql
            ;;
        alpine)
            sudo apk add --update postgresql postgresql-contrib
            sudo rc-service postgresql setup 2>/dev/null || true
            sudo rc-service postgresql start
            ;;
        *)
            echo -e "${RED}Cannot auto-install PostgreSQL on unknown OS. Please install it manually.${NC}"
            exit 1
            ;;
    esac
    echo -e "${GREEN}PostgreSQL installed \u2713${NC}"
}

# Run a SQL command as the postgres superuser (cross-platform)
run_psql() {
    local os=$(detect_os)
    if [ "$os" = "macos" ]; then
        psql postgres -c "$1" 2>/dev/null
    else
        sudo -u postgres psql -c "$1" 2>/dev/null
    fi
}

# Create DB user + database if they don't exist; set/update password
setup_postgresql_db() {
    local db_user="maintainer"
    local db_name="maintainer"
    local db_password="$1"

    echo -e "${BLUE}Configuring PostgreSQL user and database...${NC}"

    # Create user if missing, then (re-)set password
    run_psql "DO \$\$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$db_user') THEN
        CREATE USER $db_user WITH PASSWORD '$db_password';
      ELSE
        ALTER USER $db_user WITH PASSWORD '$db_password';
      END IF;
    END \$\$;" || { echo -e "${RED}Failed to create PostgreSQL user.${NC}"; exit 1; }

    # Create database if missing
    run_psql "SELECT 'CREATE DATABASE $db_name OWNER $db_user'
      WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$db_name')\\gexec" 2>/dev/null || \
    run_psql "CREATE DATABASE $db_name OWNER $db_user" 2>/dev/null || true

    run_psql "GRANT ALL PRIVILEGES ON DATABASE $db_name TO $db_user;" || true

    # CREATEDB is required for 'prisma migrate dev' (shadow database).
    # Safe to grant — the user is already the DB owner.
    run_psql "ALTER USER $db_user CREATEDB;" || true

    echo -e "${GREEN}Database '$db_name' ready \u2713${NC}"
}

# Generate a secure random string using openssl (falls back to Node.js)
gen_secret_base64() {
    openssl rand -base64 64 2>/dev/null | tr -d '\n' || \
        node -e "process.stdout.write(require('crypto').randomBytes(64).toString('base64'))"
}

gen_secret_hex32() {
    openssl rand -hex 32 2>/dev/null || \
        node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"
}

gen_password() {
    openssl rand -base64 24 2>/dev/null | tr -d '+/=' | head -c 32 || \
        node -e "process.stdout.write(require('crypto').randomBytes(24).toString('hex').slice(0,32))"
}

# Install Node.js automatically
install_nodejs() {
    local os=$(detect_os)
    local is_upgrade=${1:-false}
    echo -e "${BLUE}Detected OS: ${os}${NC}"
    echo -e "${YELLOW}Installing Node.js 20 LTS...${NC}"
    
    case $os in
        macos)
            # Check for Homebrew
            if command -v brew &> /dev/null; then
                echo -e "${BLUE}Using Homebrew to install Node.js...${NC}"
                if [ "$is_upgrade" = true ]; then
                    # Upgrade existing Node.js
                    brew upgrade node 2>/dev/null || brew install node@20
                else
                    brew install node@20
                fi
                brew link node@20 --overwrite --force 2>/dev/null || true
            else
                echo -e "${YELLOW}Homebrew not found. Installing Homebrew first...${NC}"
                /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
                # Add Homebrew to PATH for this session
                if [[ -f /opt/homebrew/bin/brew ]]; then
                    eval "$(/opt/homebrew/bin/brew shellenv)"
                elif [[ -f /usr/local/bin/brew ]]; then
                    eval "$(/usr/local/bin/brew shellenv)"
                fi
                brew install node@20
                brew link node@20 --overwrite --force 2>/dev/null || true
            fi
            ;;
        debian)
            echo -e "${BLUE}Using NodeSource repository for Debian/Ubuntu...${NC}"
            # Install prerequisites
            sudo apt-get update
            sudo apt-get install -y ca-certificates curl gnupg
            # Setup NodeSource repository
            sudo mkdir -p /etc/apt/keyrings
            curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
            echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | sudo tee /etc/apt/sources.list.d/nodesource.list
            sudo apt-get update
            if [ "$is_upgrade" = true ]; then
                sudo apt-get upgrade -y nodejs
            else
                sudo apt-get install -y nodejs
            fi
            ;;
        redhat)
            echo -e "${BLUE}Using NodeSource repository for RHEL/CentOS/Fedora...${NC}"
            # Setup NodeSource repository
            curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
            if [ "$is_upgrade" = true ]; then
                sudo yum upgrade -y nodejs 2>/dev/null || sudo dnf upgrade -y nodejs
            else
                sudo yum install -y nodejs || sudo dnf install -y nodejs
            fi
            ;;
        alpine)
            echo -e "${BLUE}Using apk to install Node.js...${NC}"
            if [ "$is_upgrade" = true ]; then
                sudo apk upgrade nodejs npm
            else
                sudo apk add --update nodejs npm
            fi
            ;;
        *)
            echo -e "${RED}Unknown operating system. Please install Node.js 18+ manually:${NC}"
            echo -e "${YELLOW}  https://nodejs.org/en/download/${NC}"
            exit 1
            ;;
    esac
    
    # Verify installation
    if command -v node &> /dev/null; then
        echo -e "${GREEN}Node.js installed successfully!${NC}"
        node --version
    else
        echo -e "${RED}Node.js installation failed. Please install manually.${NC}"
        exit 1
    fi
}

# Install Go automatically
install_go() {
    local os=$(detect_os)
    echo -e "${BLUE}Detected OS: ${os}${NC}"
    echo -e "${YELLOW}Installing Go 1.21+...${NC}"
    
    case $os in
        macos)
            if command -v brew &> /dev/null; then
                echo -e "${BLUE}Using Homebrew to install Go...${NC}"
                brew install go 2>/dev/null || true
            else
                echo -e "${YELLOW}Downloading Go for macOS...${NC}"
                local arch=$(uname -m)
                if [ "$arch" = "arm64" ]; then
                    GO_TARBALL="go1.21.6.darwin-arm64.tar.gz"
                else
                    GO_TARBALL="go1.21.6.darwin-amd64.tar.gz"
                fi
                curl -L "https://go.dev/dl/$GO_TARBALL" -o "/tmp/$GO_TARBALL"
                sudo tar -C /usr/local -xzf "/tmp/$GO_TARBALL"
                rm "/tmp/$GO_TARBALL"
                export PATH="/usr/local/go/bin:$PATH"
                # Add to shell profile
                if [ -f "$HOME/.zshrc" ]; then
                    echo 'export PATH="/usr/local/go/bin:$PATH"' >> "$HOME/.zshrc"
                elif [ -f "$HOME/.bash_profile" ]; then
                    echo 'export PATH="/usr/local/go/bin:$PATH"' >> "$HOME/.bash_profile"
                fi
            fi
            ;;
        debian)
            echo -e "${BLUE}Installing Go for Debian/Ubuntu...${NC}"
            # Remove old Go
            sudo rm -rf /usr/local/go
            # Download and install
            local arch=$(dpkg --print-architecture)
            if [ "$arch" = "arm64" ]; then
                GO_TARBALL="go1.21.6.linux-arm64.tar.gz"
            else
                GO_TARBALL="go1.21.6.linux-amd64.tar.gz"
            fi
            curl -L "https://go.dev/dl/$GO_TARBALL" -o "/tmp/$GO_TARBALL"
            sudo tar -C /usr/local -xzf "/tmp/$GO_TARBALL"
            rm "/tmp/$GO_TARBALL"
            export PATH="/usr/local/go/bin:$PATH"
            # Add to profile
            if ! grep -q '/usr/local/go/bin' /etc/profile; then
                echo 'export PATH=$PATH:/usr/local/go/bin' | sudo tee -a /etc/profile
            fi
            ;;
        redhat)
            echo -e "${BLUE}Installing Go for RHEL/CentOS/Fedora...${NC}"
            # Remove old Go
            sudo rm -rf /usr/local/go
            # Download and install
            local arch=$(uname -m)
            if [ "$arch" = "aarch64" ]; then
                GO_TARBALL="go1.21.6.linux-arm64.tar.gz"
            else
                GO_TARBALL="go1.21.6.linux-amd64.tar.gz"
            fi
            curl -L "https://go.dev/dl/$GO_TARBALL" -o "/tmp/$GO_TARBALL"
            sudo tar -C /usr/local -xzf "/tmp/$GO_TARBALL"
            rm "/tmp/$GO_TARBALL"
            export PATH="/usr/local/go/bin:$PATH"
            # Add to profile
            if ! grep -q '/usr/local/go/bin' /etc/profile; then
                echo 'export PATH=$PATH:/usr/local/go/bin' | sudo tee -a /etc/profile
            fi
            ;;
        alpine)
            echo -e "${BLUE}Using apk to install Go...${NC}"
            sudo apk add --update go
            ;;
        *)
            echo -e "${RED}Unknown operating system. Please install Go 1.21+ manually:${NC}"
            echo -e "${YELLOW}  https://go.dev/doc/install${NC}"
            return 1
            ;;
    esac
    
    # Verify installation
    if command -v go &> /dev/null; then
        echo -e "${GREEN}Go installed successfully!${NC}"
        go version
        return 0
    else
        echo -e "${RED}Go installation failed. Please install manually.${NC}"
        return 1
    fi
}

# Check minimum Node.js version (18+)
check_node_version() {
    local node_version=$(node --version 2>/dev/null | cut -d'v' -f2 | cut -d'.' -f1)
    if [ -n "$node_version" ] && [ "$node_version" -ge 18 ]; then
        return 0
    else
        return 1
    fi
}

# Check Node.js and install if missing or outdated
if ! command -v node &> /dev/null; then
    echo -e "${YELLOW}Node.js not found.${NC}"
    echo -e "${BLUE}Attempting automatic installation...${NC}"
    echo ""
    install_nodejs false
elif ! check_node_version; then
    current_version=$(node --version 2>/dev/null || echo "unknown")
    echo -e "${YELLOW}Node.js version ${current_version} is too old (need 18+).${NC}"
    echo -e "${BLUE}Attempting to upgrade Node.js...${NC}"
    echo ""
    install_nodejs true
else
    echo -e "${GREEN}Node.js $(node --version) found ✓${NC}"
fi

# Check npm
if ! command -v npm &> /dev/null; then
    echo -e "${RED}npm not found. This should have been installed with Node.js.${NC}"
    echo -e "${YELLOW}Please reinstall Node.js from https://nodejs.org/${NC}"
    exit 1
fi

echo -e "${GREEN}npm $(npm --version) found ✓${NC}"
echo ""

cd "$(dirname "$0")/server"

# ── PostgreSQL + .env auto-setup ───────────────────────────────────────────
# Check if .env already has a DATABASE_URL configured
env_has_db_url() {
    [ -f ".env" ] && grep -qE '^DATABASE_URL=.+' .env
}

if env_has_db_url; then
    echo -e "${GREEN}server/.env with DATABASE_URL found ✓${NC}"
else
    echo -e "${YELLOW}No DATABASE_URL configured – setting up PostgreSQL automatically...${NC}"
    echo ""

    # Install PostgreSQL if psql is not available
    if ! command -v psql &> /dev/null; then
        install_postgresql
    else
        echo -e "${GREEN}PostgreSQL $(psql --version 2>/dev/null | head -1) found ✓${NC}"
    fi

    # Generate credentials
    DB_PASSWORD=$(gen_password)
    JWT_SECRET=$(gen_secret_base64)
    SESSION_TOKEN_SECRET=$(gen_secret_hex32)
    DB_URL="postgresql://maintainer:${DB_PASSWORD}@localhost:5432/maintainer?schema=public&connection_limit=20"

    # Create user + database
    setup_postgresql_db "$DB_PASSWORD"

    # Copy .env.example if .env doesn't exist yet
    if [ ! -f ".env" ] && [ -f ".env.example" ]; then
        cp .env.example .env
    elif [ ! -f ".env" ]; then
        touch .env
    fi

    # Write / update the three generated values in .env
    # (replaces existing lines if present, appends if missing)
    update_env() {
        local key="$1" value="$2" file=".env"
        if grep -qE "^${key}=" "$file"; then
            # Escape sed-special characters in replacement string:
            # '\' must become '\\', '&' must become '\&'
            local escaped_value="${value//\\/\\\\}"
            escaped_value="${escaped_value//&/\\&}"
            sed -i.bak "s|^${key}=.*|${key}=${escaped_value}|" "$file" && rm -f "${file}.bak"
        else
            echo "${key}=${value}" >> "$file"
        fi
    }

    update_env "DATABASE_URL" "\"${DB_URL}\""
    update_env "JWT_SECRET" "${JWT_SECRET}"
    update_env "SESSION_TOKEN_SECRET" "${SESSION_TOKEN_SECRET}"

    echo ""
    echo -e "${GREEN}server/.env configured automatically ✓${NC}"
    echo -e "${YELLOW}  DATABASE_URL set to: postgresql://maintainer:****@localhost:5432/maintainer${NC}"
    echo -e "${YELLOW}  JWT_SECRET and SESSION_TOKEN_SECRET generated${NC}"
    echo ""
fi

echo -e "${GREEN}Installing dependencies...${NC}"
echo -e "${YELLOW}This may take a few minutes...${NC}"

# Try npm install with retries
MAX_RETRIES=3
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    echo -e "${YELLOW}Attempt $((RETRY_COUNT + 1)) of $MAX_RETRIES...${NC}"
    
    if npm install --loglevel=error; then
        echo -e "${GREEN}Dependencies installed successfully!${NC}"
        break
    else
        RETRY_COUNT=$((RETRY_COUNT + 1))
        if [ $RETRY_COUNT -lt $MAX_RETRIES ]; then
            echo -e "${YELLOW}Install failed, removing node_modules and cleaning cache before retry...${NC}"
            rm -rf node_modules 2>/dev/null || true
            npm cache clean --force 2>/dev/null
            sleep 2
        else
            echo -e "${RED}Failed to install dependencies after $MAX_RETRIES attempts.${NC}"
            echo -e "${YELLOW}Try running manually:${NC}"
            echo -e "  cd server"
            echo -e "  npm cache clean --force"
            echo -e "  npm install --legacy-peer-deps"
            exit 1
        fi
    fi
done

echo -e "${GREEN}Generating Prisma client...${NC}"
npm run prisma:generate

echo -e "${GREEN}Running database migrations...${NC}"
npx prisma migrate deploy

# ── Check if Go or Docker is available for agent builds ────────────────────
echo ""
echo -e "${BLUE}Checking build tools for agent binaries...${NC}"

HAS_DOCKER=false
HAS_GO=false

command -v docker &> /dev/null && HAS_DOCKER=true
command -v go &> /dev/null && HAS_GO=true

if [ "$HAS_DOCKER" = "true" ]; then
    echo -e "${GREEN}Docker found ✓ - will use for cross-compilation${NC}"
elif [ "$HAS_GO" = "true" ]; then
    echo -e "${GREEN}Go $(go version | awk '{print $3}') found ✓${NC}"
else
    echo -e "${YELLOW}Neither Docker nor Go found.${NC}"
    echo -e "${YELLOW}Agent binaries cannot be built without one of them.${NC}"
    echo -e "${BLUE}Installing Go automatically...${NC}"
    echo ""
    
    if install_go; then
        echo -e "${GREEN}Go installation successful! ✓${NC}"
    else
        echo -e "${YELLOW}⚠️  Warning: Go installation failed.${NC}"
        echo -e "${YELLOW}Agent installation will fail for all clients.${NC}"
        echo -e "${YELLOW}Please install Docker or Go manually:${NC}"
        echo -e "  - Docker: https://docs.docker.com/install${NC}"
        echo -e "  - Go: https://go.dev/doc/install${NC}"
        echo ""
        echo -e "${BLUE}Continuing with server setup...${NC}"
    fi
fi

echo ""
echo -e "${GREEN}Building production server...${NC}"
# Resolve the repo root (one level above server/)
REPO_DIR="$(dirname "$(realpath "$0")")"
# Git 2.35.2+ rejects repos owned by a different user (e.g. root running on a
# user-owned repo). Allow it temporarily so rev-parse works inside the build.
git config --global --add safe.directory "$REPO_DIR" 2>/dev/null || true
export BUILD_SHA
BUILD_SHA=$(git -C "$REPO_DIR" rev-parse --short HEAD 2>/dev/null || echo '')
npm run build

# ── Create system service (systemd / launchd) ──────────────────────────────
echo ""
echo -e "${BLUE}Setting up system service...${NC}"

# Determine the user who should run the service (not root)
if [ "$SUDO_USER" ]; then
    SERVICE_USER="$SUDO_USER"
else
    SERVICE_USER="$(whoami)"
fi

# Get absolute paths (we're already in the server/ directory from line 249)
SERVER_DIR="$(pwd)"
NPM_PATH="$(which npm)"
NODE_PATH="$(which node)"

# Detect OS and server IP
OS_TYPE=$(detect_os)
SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || ipconfig getifaddr en0 2>/dev/null || echo "localhost")

if [ "$OS_TYPE" = "macos" ]; then
    # ── macOS: launchd service ──────────────────────────────────────────────
    PLIST_FILE="$HOME/Library/LaunchAgents/com.controlsphere.server.plist"
    mkdir -p "$HOME/Library/LaunchAgents"
    
    cat > "$PLIST_FILE" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.controlsphere.server</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NPM_PATH</string>
        <string>start</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$SERVER_DIR</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>NODE_ENV</key>
        <string>production</string>
        <key>HOSTNAME</key>
        <string>0.0.0.0</string>
        <key>PORT</key>
        <string>3000</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$HOME/Library/Logs/controlsphere-stdout.log</string>
    <key>StandardErrorPath</key>
    <string>$HOME/Library/Logs/controlsphere-stderr.log</string>
</dict>
</plist>
EOF
    
    launchctl unload "$PLIST_FILE" 2>/dev/null || true
    launchctl load "$PLIST_FILE"
    sleep 2
    
    if launchctl list | grep -q com.controlsphere.server; then
        echo -e "${GREEN}Service started successfully ✓${NC}"
    else
        echo -e "${YELLOW}Service may still be starting...${NC}"
    fi
    
    SERVICE_CMD_STATUS="launchctl list | grep controlsphere"
    SERVICE_CMD_RESTART="launchctl unload $PLIST_FILE && launchctl load $PLIST_FILE"
    SERVICE_CMD_STOP="launchctl unload $PLIST_FILE"
    SERVICE_CMD_LOGS="tail -f $HOME/Library/Logs/controlsphere-stderr.log"
    
else
    # ── Linux: systemd service ──────────────────────────────────────────────
    sudo tee /etc/systemd/system/controlsphere.service > /dev/null <<EOF
[Unit]
Description=ControlSphere Server
Documentation=https://github.com/timexx/controlsphere
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$SERVER_DIR
Environment="NODE_ENV=production"
Environment="HOSTNAME=0.0.0.0"
Environment="PORT=3000"
ExecStart=$NPM_PATH start
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=controlsphere

# Security hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=$(dirname "$SERVER_DIR")

[Install]
WantedBy=multi-user.target
EOF

    sudo systemctl daemon-reload
    sudo systemctl enable controlsphere.service
    sudo systemctl start controlsphere.service
    sleep 2

    if sudo systemctl is-active --quiet controlsphere.service; then
        echo -e "${GREEN}Service started successfully ✓${NC}"
    else
        echo -e "${YELLOW}Service may still be starting... Check status with:${NC}"
        echo -e "  sudo systemctl status controlsphere"
    fi

    # ── Sudoers: allow service user to manage controlsphere without a password ──
    # Required so the in-app update function can restart the server after building
    # (update runs detached without a TTY, so interactive sudo would always fail)
    SUDOERS_FILE="/etc/sudoers.d/controlsphere"
    SYSTEMCTL_PATH="$(which systemctl 2>/dev/null || echo /usr/bin/systemctl)"
    sudo tee "$SUDOERS_FILE" > /dev/null <<EOF
# ControlSphere: passwordless service management for $SERVICE_USER
# Required for the web-triggered update function (runs without a TTY)
$SERVICE_USER ALL=(ALL) NOPASSWD: $SYSTEMCTL_PATH daemon-reload
$SERVICE_USER ALL=(ALL) NOPASSWD: $SYSTEMCTL_PATH start controlsphere.service
$SERVICE_USER ALL=(ALL) NOPASSWD: $SYSTEMCTL_PATH stop controlsphere.service
$SERVICE_USER ALL=(ALL) NOPASSWD: $SYSTEMCTL_PATH restart controlsphere.service
$SERVICE_USER ALL=(ALL) NOPASSWD: $SYSTEMCTL_PATH is-active controlsphere.service
$SERVICE_USER ALL=(ALL) NOPASSWD: $SYSTEMCTL_PATH list-units --type\=service
EOF
    sudo chmod 440 "$SUDOERS_FILE"
    if sudo visudo -cf "$SUDOERS_FILE" > /dev/null 2>&1; then
        echo -e "${GREEN}Passwordless service management configured ✓${NC}"
    else
        echo -e "${YELLOW}Warning: sudoers syntax check failed – removing file${NC}"
        sudo rm -f "$SUDOERS_FILE"
    fi

    SERVICE_CMD_STATUS="sudo systemctl status controlsphere"
    SERVICE_CMD_RESTART="sudo systemctl restart controlsphere"
    SERVICE_CMD_STOP="sudo systemctl stop controlsphere"
    SERVICE_CMD_LOGS="sudo journalctl -u controlsphere -f"
fi

echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  Setup Complete! ✓${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo -e "${GREEN}ControlSphere is now running as a system service.${NC}"
echo ""
echo -e "Access the dashboard at:"
echo -e "${YELLOW}  http://localhost:3000${NC}"
echo -e "${YELLOW}  http://$SERVER_IP:3000${NC}"
echo ""
echo -e "Useful commands:"
echo -e "  ${BLUE}$SERVICE_CMD_STATUS${NC}   # check service status"
echo -e "  ${BLUE}$SERVICE_CMD_RESTART${NC}  # restart service"
echo -e "  ${BLUE}$SERVICE_CMD_STOP${NC}     # stop service"
echo -e "  ${BLUE}$SERVICE_CMD_LOGS${NC}   # view live logs"
echo ""
