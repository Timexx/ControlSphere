#!/usr/bin/env bash
# Builds all agent binaries into server/public/downloads (with manifest).
# Thin wrapper: always forces a rebuild via the server build script.
# Set AGENT_VERSION to override the embedded version.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/../server/scripts/build-agents-if-needed.sh" --force "$@"
