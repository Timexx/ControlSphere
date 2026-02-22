#!/bin/bash
set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

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
            sed -i.bak "s|^${key}=.*|${key}=${value}|" "$file" && rm -f "${file}.bak"
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
            echo -e "${YELLOW}Install failed, cleaning cache and retrying...${NC}"
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
npm run prisma:migrate

echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  Setup Complete! ✓${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo -e "Start the server with:"
echo -e "${YELLOW}  cd server && npm run dev${NC}"
echo ""
echo -e "Access the dashboard at:"
echo -e "${YELLOW}  http://localhost:3000${NC}"
echo ""
