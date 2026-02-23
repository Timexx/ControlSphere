#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$SCRIPT_DIR/../server"

echo "🔨 Building Maintainer Agent..."
echo ""

# Create bin directory
mkdir -p "$SCRIPT_DIR/bin"

# ---------- Detect build method ----------
USE_DOCKER=false

if command -v go &> /dev/null; then
  echo "✓ Go found: $(go version)"
elif command -v docker &> /dev/null; then
  echo "⚠️  Go not found — using Docker for cross-compilation"
  USE_DOCKER=true
else
  echo "❌ Neither Go nor Docker found. Install one of them."
  exit 1
fi

if [ "$USE_DOCKER" = true ]; then
  echo ""
  echo "🐳 Building via Docker (golang:1.21-alpine)..."
  echo ""

  docker run --rm \
    -v "$SCRIPT_DIR":/src \
    -w /src \
    -e CGO_ENABLED=0 \
    golang:1.21-alpine \
    sh -c '
      set -e
      echo "📦 Downloading dependencies..."
      go mod tidy

      echo ""
      echo "🐧 Building Linux AMD64..."
      GOOS=linux GOARCH=amd64 go build -o bin/maintainer-agent-linux-amd64 -ldflags="-s -w" .

      echo "🐧 Building Linux ARM64..."
      GOOS=linux GOARCH=arm64 go build -o bin/maintainer-agent-linux-arm64 -ldflags="-s -w" .

      echo "🪟 Building Windows AMD64..."
      GOOS=windows GOARCH=amd64 go build -o bin/maintainer-agent-windows-amd64.exe -ldflags="-s -w" .

      echo "🪟 Building Windows ARM64..."
      GOOS=windows GOARCH=arm64 go build -o bin/maintainer-agent-windows-arm64.exe -ldflags="-s -w" .

      echo ""
      echo "📋 Creating default binary symlink (linux-amd64)..."
      cp bin/maintainer-agent-linux-amd64 bin/maintainer-agent
    '
else
  # Native Go build
  echo ""
  echo "📦 Getting dependencies..."
  cd "$SCRIPT_DIR"
  go mod tidy

  echo ""
  echo "🐧 Building for Linux AMD64..."
  CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o bin/maintainer-agent-linux-amd64 -ldflags="-s -w" .

  echo "🐧 Building for Linux ARM64..."
  CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -o bin/maintainer-agent-linux-arm64 -ldflags="-s -w" .

  echo "🪟 Building for Windows AMD64..."
  CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -o bin/maintainer-agent-windows-amd64.exe -ldflags="-s -w" .

  echo "🪟 Building for Windows ARM64..."
  CGO_ENABLED=0 GOOS=windows GOARCH=arm64 go build -o bin/maintainer-agent-windows-arm64.exe -ldflags="-s -w" .

  echo ""
  echo "📋 Creating default binary (linux-amd64)..."
  cp bin/maintainer-agent-linux-amd64 bin/maintainer-agent
fi

echo ""
echo "✅ Build complete!"
echo ""
echo "Binaries created:"
ls -lh "$SCRIPT_DIR/bin/"
echo ""

# Copy to server downloads directory
if [ -d "$SERVER_DIR" ]; then
  echo "📤 Copying binaries to server downloads..."
  mkdir -p "$SERVER_DIR/public/downloads"
  cp "$SCRIPT_DIR/bin/maintainer-agent" "$SERVER_DIR/public/downloads/"
  cp "$SCRIPT_DIR/bin/maintainer-agent-linux-amd64" "$SERVER_DIR/public/downloads/"
  cp "$SCRIPT_DIR/bin/maintainer-agent-linux-arm64" "$SERVER_DIR/public/downloads/"
  cp "$SCRIPT_DIR/bin/maintainer-agent-windows-amd64.exe" "$SERVER_DIR/public/downloads/"
  cp "$SCRIPT_DIR/bin/maintainer-agent-windows-arm64.exe" "$SERVER_DIR/public/downloads/"
  echo "✅ Binaries available at: $SERVER_DIR/public/downloads/"
  echo ""
fi

echo "To install on Linux:"
echo "  curl -sSL http://YOUR-SERVER:3000/install-agent.sh | sudo bash"
echo ""
echo "To install on Windows (elevated PowerShell):"
echo "  irm http://YOUR-SERVER:3000/install-agent.ps1 | iex"
echo ""
