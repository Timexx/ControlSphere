#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$SCRIPT_DIR/../server"

echo "🔨 Building Maintainer Agent..."

# Create bin directory
mkdir -p bin

# Get dependencies
echo "📦 Getting dependencies..."
go mod tidy

# Build for Linux AMD64
echo "🐧 Building for Linux AMD64..."
GOOS=linux GOARCH=amd64 go build -o bin/maintainer-agent-linux-amd64 -ldflags="-s -w" .

# Build for Linux ARM64
echo "🐧 Building for Linux ARM64..."
GOOS=linux GOARCH=arm64 go build -o bin/maintainer-agent-linux-arm64 -ldflags="-s -w" .

# Create symlink/copy for the default binary name (used by update mechanism)
echo "📋 Creating default binary (linux-amd64)..."
cp bin/maintainer-agent-linux-amd64 bin/maintainer-agent

echo ""
echo "✅ Build complete!"
echo ""
echo "Binaries created:"
ls -lh bin/
echo ""

# Copy to server downloads directory for auto-update feature
if [ -d "$SERVER_DIR" ]; then
    echo "📤 Copying binary to server downloads..."
    mkdir -p "$SERVER_DIR/public/downloads"
    cp bin/maintainer-agent "$SERVER_DIR/public/downloads/"
    echo "✅ Binary available at: $SERVER_DIR/public/downloads/maintainer-agent"
    echo ""
fi

echo "To deploy manually:"
echo "  scp bin/maintainer-agent-linux-amd64 user@vm:/tmp/"
echo "  ssh user@vm 'sudo mv /tmp/maintainer-agent-linux-amd64 /usr/local/bin/maintainer-agent && sudo chmod +x /usr/local/bin/maintainer-agent'"
echo ""
echo "Or use the 'Update Agent' function in the web UI!"
