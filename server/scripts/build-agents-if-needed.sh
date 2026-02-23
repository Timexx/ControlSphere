#!/bin/sh
# Auto-build agent binaries if they don't exist
# This runs automatically:
#   - Docker: via docker-entrypoint.sh on container start
#   - Native: via npm prestart/predev hooks
set -e

# Detect if we're in Docker or native environment
if [ -d "/app" ] && [ -f "/.dockerenv" ]; then
  IS_DOCKER=true
  DOWNLOADS_DIR="/app/public/downloads"
  AGENT_DIR="/build-context/agent"  # Only available if context was repo root
else
  IS_DOCKER=false
  # Find script directory and derive paths
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  SERVER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
  REPO_ROOT="$(cd "$SERVER_DIR/.." && pwd)"
  DOWNLOADS_DIR="$SERVER_DIR/public/downloads"
  AGENT_DIR="$REPO_ROOT/agent"
fi

# Silent check - only log if binaries are missing
if [ -f "$DOWNLOADS_DIR/maintainer-agent-linux-amd64" ] && \
   [ -f "$DOWNLOADS_DIR/maintainer-agent-windows-amd64.exe" ]; then
  # Binaries exist, silent success
  exit 0
fi

echo ""
echo "[agent-build] ⚠️  Agent binaries missing in: $DOWNLOADS_DIR"
echo "[agent-build] Attempting automatic build..."
echo ""

# Create downloads directory if it doesn't exist
mkdir -p "$DOWNLOADS_DIR"

# Docker environment: Binaries should have been built during image build
# If missing, it means the image was built incorrectly
if [ "$IS_DOCKER" = "true" ]; then
  echo "[agent-build] 🐳 Running in Docker container"
  
  # Check if we have access to agent source (multi-stage build should have copied binaries)
  if [ ! -d "$AGENT_DIR" ]; then
    echo ""
    echo "╔════════════════════════════════════════════════════════════════╗"
    echo "║  WARNING: Agent binaries missing in Docker image              ║"
    echo "╟────────────────────────────────────────────────────────────────╢"
    echo "║  This means the Docker image was not built correctly.         ║"
    echo "║  Agent binaries should be included during image build.        ║"
    echo "║                                                                ║"
    echo "║  TO FIX: Rebuild the image with:                              ║"
    echo "║    docker compose build --no-cache server                     ║"
    echo "║    docker compose up -d                                       ║"
    echo "╚════════════════════════════════════════════════════════════════╝"
    echo ""
    echo "[agent-build] ❌ Cannot auto-build in Docker without agent source"
    echo "[agent-build] Server will start, but agent installations will fail!"
    echo ""
    exit 0  # Don't crash the container
  fi
fi

# Native environment: We can try to build
echo "[agent-build] 📦 Native deployment detected"

# Verify agent source exists
if [ ! -d "$AGENT_DIR" ]; then
  echo ""
  echo "╔════════════════════════════════════════════════════════════════╗"
  echo "║  ERROR: Agent source directory not found                      ║"
  echo "╚════════════════════════════════════════════════════════════════╝"
  echo ""
  echo "Expected location: $AGENT_DIR"
  echo ""
  echo "Make sure you have the complete repository checked out."
  echo "Server will start, but agent installations will fail!"
  echo ""
  exit 0
fi

# Try to build via Docker (preferred method for native deployments)
if command -v docker >/dev/null 2>&1; then
  echo "[agent-build] ✓ Docker found - using golang:1.21-alpine for cross-compilation"
  echo "[agent-build] Building binaries (this may take 30-60 seconds)..."
  echo ""
  
  if docker run --rm \
    -v "$AGENT_DIR":/src \
    -w /src \
    -e CGO_ENABLED=0 \
    golang:1.21-alpine \
    sh -c '
      echo "📦 Updating Go dependencies..."
      go mod tidy || exit 1
      go mod download || exit 1
      
      mkdir -p bin
      
      echo "🐧 Building Linux AMD64..."
      GOOS=linux GOARCH=amd64 go build -o bin/maintainer-agent-linux-amd64 -ldflags="-s -w" . || exit 1
      
      echo "🐧 Building Linux ARM64..."
      GOOS=linux GOARCH=arm64 go build -o bin/maintainer-agent-linux-arm64 -ldflags="-s -w" . || exit 1
      
      echo "🪟 Building Windows AMD64..."
      GOOS=windows GOARCH=amd64 go build -o bin/maintainer-agent-windows-amd64.exe -ldflags="-s -w" . || exit 1
      
      echo "🪟 Building Windows ARM64..."
      GOOS=windows GOARCH=arm64 go build -o bin/maintainer-agent-windows-arm64.exe -ldflags="-s -w" . || exit 1
      
      echo "📋 Creating default symlink..."
      cp bin/maintainer-agent-linux-amd64 bin/maintainer-agent
      
      echo ""
      echo "✅ All binaries built successfully"
    '; then
    
    # Copy binaries to downloads directory
    echo ""
    echo "[agent-build] 📤 Copying binaries to $DOWNLOADS_DIR..."
    cp "$AGENT_DIR/bin/"* "$DOWNLOADS_DIR/" || {
      echo "[agent-build] ❌ Failed to copy binaries!"
      exit 0
    }
    
    echo "[agent-build] ✅ Agent binaries ready:"
    ls -lh "$DOWNLOADS_DIR" | grep maintainer-agent || true
    echo ""
    exit 0
  else
    echo ""
    echo "[agent-build] ❌ Docker build failed!"
    echo "[agent-build] Trying with local Go installation..."
    echo ""
  fi
fi

# Try to build with local Go installation
if command -v go >/dev/null 2>&1; then
  echo "[agent-build] ✓ Go found: $(go version)"
  echo "[agent-build] Building binaries..."
  echo ""
  
  (
    cd "$AGENT_DIR" || exit 1
    
    echo "📦 Updating Go dependencies..."
    go mod tidy || exit 1
    go mod download || exit 1
    
    mkdir -p bin
    
    echo "🐧 Building Linux AMD64..."
    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o bin/maintainer-agent-linux-amd64 -ldflags="-s -w" . || exit 1
    
    echo "🐧 Building Linux ARM64..."
    CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -o bin/maintainer-agent-linux-arm64 -ldflags="-s -w" . || exit 1
    
    echo "🪟 Building Windows AMD64..."
    CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -o bin/maintainer-agent-windows-amd64.exe -ldflags="-s -w" . || exit 1
    
    echo "🪟 Building Windows ARM64..."
    CGO_ENABLED=0 GOOS=windows GOARCH=arm64 go build -o bin/maintainer-agent-windows-arm64.exe -ldflags="-s -w" . || exit 1
    
    echo "📋 Creating default symlink..."
    cp bin/maintainer-agent-linux-amd64 bin/maintainer-agent
    
    echo ""
    echo "✅ All binaries built successfully"
  ) && {
    echo ""
    echo "[agent-build] 📤 Copying binaries to $DOWNLOADS_DIR..."
    cp "$AGENT_DIR/bin/"* "$DOWNLOADS_DIR/" || {
      echo "[agent-build] ❌ Failed to copy binaries!"
      exit 0
    }
    
    echo "[agent-build] ✅ Agent binaries ready:"
    ls -lh "$DOWNLOADS_DIR" | grep maintainer-agent || true
    echo ""
    exit 0
  }
  
  echo ""
  echo "[agent-build] ❌ Go build failed!"
fi

# If we reached here, all build attempts failed
HAS_DOCKER=false
HAS_GO=false

command -v docker >/dev/null 2>&1 && HAS_DOCKER=true
command -v go >/dev/null 2>&1 && HAS_GO=true

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  CRITICAL: Cannot build agent binaries                        ║"
echo "╟────────────────────────────────────────────────────────────────╢"

if [ "$HAS_DOCKER" = "false" ] && [ "$HAS_GO" = "false" ]; then
  echo "║  Neither Docker nor Go is available on this system.           ║"
  echo "║                                                                ║"
  echo "║  TO FIX: Install one of these:                                ║"
  echo "║    - Docker (recommended): https://docs.docker.com/install    ║"
  echo "║    - Go 1.21+: https://go.dev/doc/install                     ║"
else
  echo "║  Build tools are available but the build failed.              ║"
  echo "║  See error messages above for details.                        ║"
  echo "║                                                                ║"
  echo "║  Common fixes:                                                ║"
  echo "║    - Check agent source code is complete (go.mod, *.go)       ║"
  echo "║    - Ensure go.mod dependencies are correct                   ║"
  echo "║    - Try manual build: cd agent && ./build-agent.sh           ║"
fi

echo "║                                                                ║"
echo "║  Agent installation will FAIL for all clients until fixed.    ║"
echo "║                                                                ║"
echo "║  Manual build command:                                        ║"
echo "║    cd $AGENT_DIR"
echo "║    ./build-agent.sh                                           ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Don't crash the server - let it start but warn
exit 0
