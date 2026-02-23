# Auto-Build Scripts

## build-agents-if-needed.sh

Automatically builds agent binaries if they don't exist in `public/downloads/`.

**When is this used?**
- **Docker**: Runs automatically on container startup (via `docker-entrypoint.sh`)
- **Native**: Runs automatically after `npm run build` (via `postbuild` script)

**How it works:**
1. Checks if `public/downloads/maintainer-agent-linux-amd64` exists
2. If missing, tries to build using Docker (preferred) or local Go installation
3. Copies binaries to `public/downloads/` for agent installation routes

**Manual build:**
```bash
# From server/ directory
sh scripts/build-agents-if-needed.sh

# Or from agent/ directory
./build-agent.sh
```

**Requirements (native deployments):**
- Either Docker **or** Go 1.21+ installed on the server
- Agent source code in `../agent/` relative to server directory

**On startup, you'll see:**
- ✅ `[agent-build] ✓ Agent binaries found.` — All good, binaries exist
- ⚠️  `[agent-build] ⚠️ Agent binaries missing!` — Will attempt auto-build
- ❌ Critical warning box — Neither Docker nor Go available, manual build required

**If binaries are missing and can't be built:**

The server will still start, but agent installations will fail. To fix:

1. Install Docker or Go 1.21+ on your server
2. Run manually: `cd agent && ./build-agent.sh`
3. Or copy pre-built binaries to `server/public/downloads/`
