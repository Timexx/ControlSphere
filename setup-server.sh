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

# Fix database permissions - SQLite needs write access to both the file and directory
echo -e "${GREEN}Setting database permissions...${NC}"
DB_FILE="./prisma/dev.db"
DB_DIR="./prisma"

if [ -f "$DB_FILE" ]; then
    chmod 664 "$DB_FILE" 2>/dev/null || sudo chmod 664 "$DB_FILE" 2>/dev/null || true
    chmod 664 "${DB_FILE}-journal" 2>/dev/null || true
    chmod 664 "${DB_FILE}-wal" 2>/dev/null || true
    chmod 664 "${DB_FILE}-shm" 2>/dev/null || true
    echo -e "${GREEN}Database file permissions set ✓${NC}"
fi

# Ensure the prisma directory is writable (SQLite needs this for journal files)
if [ -d "$DB_DIR" ]; then
    chmod 775 "$DB_DIR" 2>/dev/null || sudo chmod 775 "$DB_DIR" 2>/dev/null || true
    echo -e "${GREEN}Database directory permissions set ✓${NC}"
fi

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
