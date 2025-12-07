#!/bin/bash
set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  MaintainerWeb Agent Build${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""

cd "$(dirname "$0")/agent"

# Check Go
if ! command -v go &> /dev/null; then
    echo -e "${YELLOW}Go not found. Please install Go 1.21+ first.${NC}"
    exit 1
fi

echo -e "${GREEN}Downloading dependencies...${NC}"
go mod download

echo -e "${GREEN}Building agent...${NC}"
go build -o maintainer-agent

echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  Build Complete! ✓${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo -e "Binary created: ${YELLOW}agent/maintainer-agent${NC}"
echo ""
echo -e "Test the agent with:"
echo -e "${YELLOW}  ./agent/maintainer-agent -server ws://localhost:3000/ws/agent -key test-key${NC}"
echo ""

# Cross-compile
echo -e "${GREEN}Building cross-platform binaries...${NC}"
GOOS=linux GOARCH=amd64 go build -o maintainer-agent-linux-amd64
GOOS=linux GOARCH=arm64 go build -o maintainer-agent-linux-arm64

echo -e "${GREEN}Cross-platform binaries created:${NC}"
echo -e "  - ${YELLOW}maintainer-agent-linux-amd64${NC} (most Linux servers)"
echo -e "  - ${YELLOW}maintainer-agent-linux-arm64${NC} (Raspberry Pi, ARM servers)"
echo ""
