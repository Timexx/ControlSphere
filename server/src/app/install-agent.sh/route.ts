import { NextResponse } from 'next/server'
import { networkInterfaces } from 'os'
import { prisma } from '@/lib/prisma'
import { readAgentManifest } from '@/lib/agent-manifest'

// Prevent static generation — this route reads files from disk at runtime
export const dynamic = 'force-dynamic'

// Only characters that are harmless inside a double-quoted shell string.
const HOST_RE = /^[A-Za-z0-9._:\[\]-]+$/
const SHA_RE = /^[a-f0-9]{64}$/
const VERSION_RE = /^[A-Za-z0-9._+-]{1,64}$/

function safeSha(value: string | undefined): string {
  return value && SHA_RE.test(value) ? value : ''
}

function safeSize(value: number | undefined): string {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? String(value) : ''
}

export async function GET() {
  try {
    let hostPart: string
    let secure = false

    // 1. Prefer admin-configured URL from DB (keep its scheme: https -> https/wss)
    const config = await prisma.serverConfig.findUnique({ where: { id: 'global' } })
    if (config?.serverUrl) {
      const raw = config.serverUrl.trim()
      secure = /^(https|wss):\/\//i.test(raw)
      hostPart = raw.replace(/^[A-Za-z][A-Za-z0-9+.-]*:\/\//, '').split(/[/?#]/)[0]
    } else {
      // 2. Fallback: auto-detect LAN IP
      const nets = networkInterfaces()
      let serverIp = 'localhost'
      for (const name of Object.keys(nets)) {
        const netInfo = nets[name]
        if (!netInfo) continue
        for (const net of netInfo) {
          const familyV4Value = typeof net.family === 'string' ? 'IPv4' : 4
          if (net.family === familyV4Value && !net.internal) {
            serverIp = net.address
            break
          }
        }
        if (serverIp !== 'localhost') break
      }
      hostPart = `${serverIp}:${process.env.PORT || 3000}`
    }

    if (!HOST_RE.test(hostPart)) {
      throw new Error('Configured server URL contains unexpected characters')
    }

    const baseUrl = `${secure ? 'https' : 'http'}://${hostPart}`
    const defaultWsUrl = `${secure ? 'wss' : 'ws'}://${hostPart}/ws/agent`

    // Manifest (validated by readAgentManifest; values re-checked before embedding)
    const manifest = await readAgentManifest()
    const amd64 = manifest?.binaries['linux-amd64']
    const arm64 = manifest?.binaries['linux-arm64']
    const expectedVersion = manifest && VERSION_RE.test(manifest.version) ? manifest.version : ''
    const shaAmd64 = safeSha(amd64?.sha256)
    const shaArm64 = safeSha(arm64?.sha256)
    const sizeAmd64 = safeSize(amd64?.size)
    const sizeArm64 = safeSize(arm64?.size)

    const installScript = `#!/bin/bash
set -e

# Values embedded by the server (empty = no valid manifest on the server)
EXPECTED_VERSION="${expectedVersion}"
SHA_AMD64="${shaAmd64}"
SHA_ARM64="${shaArm64}"
SIZE_AMD64="${sizeAmd64}"
SIZE_ARM64="${sizeArm64}"
BASE_URL="${baseUrl}"
DEFAULT_WS_URL="${defaultWsUrl}"

BIN=/usr/local/bin/maintainer-agent
TMP=/usr/local/bin/.maintainer-agent.download
PREV=/usr/local/bin/.maintainer-agent.previous
CONFIG_DIR=/etc/maintainer-agent
CONFIG_FILE=/etc/maintainer-agent/config.json
CONFIG_TMP=/etc/maintainer-agent/config.json.tmp
SERVICE=maintainer-agent

# Colors
GREEN='\\033[0;32m'
YELLOW='\\033[1;33m'
RED='\\033[0;31m'
NC='\\033[0m'

ok()   { echo -e "$GREEN$1$NC"; }
warn() { echo -e "$YELLOW$1$NC"; }
fail() {
  echo ""
  echo -e "$RED""ERROR: $1$NC"
  echo -e "$RED""Aborted. The running agent was not changed.$NC"
  exit 1
}

# Remove temporary files on any exit (the old agent stays untouched until step 5)
cleanup() {
  rm -f "$TMP" "$CONFIG_TMP"
}
trap cleanup EXIT

ok "============================================"
ok "  Maintainer Agent Installation"
ok "============================================"
echo ""

# ---------- 1. root check, architecture, expected checksum ----------
if [ "$(id -u)" -ne 0 ]; then
  fail "Please run as root (use sudo)"
fi

if [ -z "$EXPECTED_VERSION" ]; then
  fail "Agent-Binaries fehlen auf dem Server: dort scripts/deploy.sh bzw. server/scripts/build-agents-if-needed.sh ausfuehren"
fi

ARCH=$(uname -m)
case "$ARCH" in
  x86_64)
    DL_ARCH="amd64"
    EXPECTED_SHA="$SHA_AMD64"
    EXPECTED_SIZE="$SIZE_AMD64"
    ;;
  aarch64|arm64)
    DL_ARCH="arm64"
    EXPECTED_SHA="$SHA_ARM64"
    EXPECTED_SIZE="$SIZE_ARM64"
    ;;
  *)
    fail "Unsupported architecture: $ARCH"
    ;;
esac

if [ -z "$EXPECTED_SHA" ] || [ -z "$EXPECTED_SIZE" ]; then
  fail "Agent-Binaries fehlen auf dem Server (linux-$DL_ARCH): dort scripts/deploy.sh bzw. server/scripts/build-agents-if-needed.sh ausfuehren"
fi

if command -v sha256sum >/dev/null 2>&1; then
  SHA_CMD="sha256sum"
elif command -v shasum >/dev/null 2>&1; then
  SHA_CMD="shasum -a 256"
else
  fail "Neither sha256sum nor shasum found"
fi

mkdir -p /usr/local/bin

# ---------- 2. download to a temp file next to the target ----------
DOWNLOAD_URL="$BASE_URL/api/agent-download?os=linux&arch=$DL_ARCH"
warn "Downloading agent $EXPECTED_VERSION (linux-$DL_ARCH) from $DOWNLOAD_URL"

rm -f "$TMP"
if command -v curl >/dev/null 2>&1; then
  if ! curl -fsSL -o "$TMP" "$DOWNLOAD_URL" </dev/null; then
    fail "Download failed. Agent-Binaries fehlen auf dem Server: dort scripts/deploy.sh bzw. server/scripts/build-agents-if-needed.sh ausfuehren"
  fi
elif command -v wget >/dev/null 2>&1; then
  if ! wget -q -O "$TMP" "$DOWNLOAD_URL" </dev/null; then
    fail "Download failed. Agent-Binaries fehlen auf dem Server: dort scripts/deploy.sh bzw. server/scripts/build-agents-if-needed.sh ausfuehren"
  fi
else
  fail "Neither curl nor wget found"
fi

# ---------- 3. verify the download ----------
GOT_SIZE=$(wc -c < "$TMP" | tr -d '[:space:]')
if [ "$GOT_SIZE" != "$EXPECTED_SIZE" ]; then
  fail "Size mismatch: got $GOT_SIZE bytes, expected $EXPECTED_SIZE"
fi

GOT_SHA=$($SHA_CMD "$TMP" | awk '{print $1}')
if [ "$GOT_SHA" != "$EXPECTED_SHA" ]; then
  fail "SHA-256 mismatch: got $GOT_SHA, expected $EXPECTED_SHA"
fi

MAGIC=$(head -c 4 "$TMP" | od -An -tx1 | tr -d '[:space:]')
if [ "$MAGIC" != "7f454c46" ]; then
  fail "Downloaded file is not an ELF binary"
fi

chmod 755 "$TMP"

if command -v timeout >/dev/null 2>&1; then
  GOT_VERSION=$(timeout 10 "$TMP" -version 2>&1 </dev/null || true)
else
  GOT_VERSION=$("$TMP" -version 2>&1 </dev/null || true)
fi
GOT_VERSION=$(printf '%s' "$GOT_VERSION" | tr -d '\\r')
if [ "$GOT_VERSION" != "$EXPECTED_VERSION" ]; then
  fail "Version mismatch: binary reports '$GOT_VERSION', expected '$EXPECTED_VERSION'"
fi
ok "Binary verified (size, sha256, ELF, version $GOT_VERSION)"

# ---------- 4. configuration (secret_key is always preserved) ----------
NEW_INSTALL=false
if [ -f "$CONFIG_FILE" ]; then
  warn "Existing configuration found. Secret key will be preserved."

  read_json_value() {
    local key="$1" val=""
    val=$(grep -oP '"'"$key"'"[[:space:]]*:[[:space:]]*"\\K[^"]*' "$CONFIG_FILE" 2>/dev/null | head -n 1 || true)
    if [ -z "$val" ]; then
      val=$(sed -n 's/.*"'"$key"'"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p' "$CONFIG_FILE" 2>/dev/null | head -n 1 || true)
    fi
    printf '%s' "$val"
  }

  EXISTING_SECRET=$(read_json_value secret_key)
  EXISTING_URL=$(read_json_value server_url)

  HEX_RE='^[a-fA-F0-9]{64}$'
  WS_RE='^wss?://[A-Za-z0-9._:/@%?=&+~-]+$'

  if [ -n "$EXISTING_SECRET" ]; then
    if [[ "$EXISTING_SECRET" =~ $HEX_RE ]]; then
      ok "Secret key is valid (64 hex chars)"
      SECRET_KEY="$EXISTING_SECRET"
    else
      warn "Secret key needs migration (length: \${#EXISTING_SECRET}), hashing via SHA-256"
      SECRET_KEY=$(printf '%s' "$EXISTING_SECRET" | $SHA_CMD | awk '{print $1}')
      warn "NOTE: The machine must be re-registered in the web UI"
    fi
  elif grep -q 'secret_key' "$CONFIG_FILE" 2>/dev/null; then
    fail "Existing config contains a secret_key that could not be read; refusing to overwrite it"
  else
    warn "No secret key in existing config, generating new one..."
    SECRET_KEY=$(openssl rand -hex 32)
    NEW_INSTALL=true
  fi

  if [[ "$EXISTING_URL" =~ $WS_RE ]]; then
    SERVER_URL="$EXISTING_URL"
    warn "Keeping existing server_url: $SERVER_URL"
  else
    SERVER_URL="$DEFAULT_WS_URL"
  fi

  cp -p "$CONFIG_FILE" "$CONFIG_FILE.bak" 2>/dev/null || true
else
  NEW_INSTALL=true
  SECRET_KEY=$(openssl rand -hex 32)
  SERVER_URL="$DEFAULT_WS_URL"
  mkdir -p "$CONFIG_DIR"
fi

if ! [[ "$SECRET_KEY" =~ ^[a-fA-F0-9]{64}$ ]]; then
  fail "Could not determine a valid secret key"
fi

rm -f "$CONFIG_TMP"
cat > "$CONFIG_TMP" <<EOF
{
  "server_url": "$SERVER_URL",
  "secret_key": "$SECRET_KEY"
}
EOF
chmod 600 "$CONFIG_TMP"
mv -f "$CONFIG_TMP" "$CONFIG_FILE"
chmod 600 "$CONFIG_FILE"

# ---------- 5. replace the binary (first time the running agent is touched) ----------
if [ -f "$BIN" ]; then
  rm -f "$PREV"
  cp -p "$BIN" "$PREV" 2>/dev/null || true
fi

if systemctl cat "$SERVICE" >/dev/null 2>&1; then
  warn "Stopping $SERVICE..."
  systemctl stop "$SERVICE" || warn "systemctl stop reported an error, continuing"
fi

mv -f "$TMP" "$BIN"

rm -f /usr/local/bin/maintainer-agent.new /usr/local/bin/maintainer-agent.bak /usr/local/bin/maintainer-agent.failed
rm -f /var/lib/maintainer-agent/update-pending

# ---------- 6. systemd unit ----------
cat > /etc/systemd/system/maintainer-agent.service <<EOF
[Unit]
Description=Maintainer Agent
After=network.target
StartLimitIntervalSec=0

[Service]
Type=simple
User=root
ExecStart=/usr/local/bin/maintainer-agent -config /etc/maintainer-agent/config.json
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE"
systemctl restart "$SERVICE"

# ---------- 7. success check ----------
WAIT=0
while [ "$WAIT" -lt 15 ]; do
  if systemctl is-active --quiet "$SERVICE"; then
    break
  fi
  sleep 1
  WAIT=$((WAIT + 1))
done
if systemctl is-active --quiet "$SERVICE"; then
  # make sure it does not crash right after starting
  sleep 3
fi

echo ""
if systemctl is-active --quiet "$SERVICE"; then
  rm -f "$PREV"
  ok "============================================"
  ok "  Agent $GOT_VERSION is running"
  ok "============================================"
  echo ""
  if [ "$NEW_INSTALL" = true ]; then
    echo -e "Secret Key: $YELLOW$SECRET_KEY$NC"
    warn "IMPORTANT: Save this key!"
    echo ""
  fi
  echo -e "Check status: $YELLOW""systemctl status $SERVICE$NC"
  echo -e "View logs: $YELLOW""journalctl -u $SERVICE -f$NC"
  echo ""
else
  echo -e "$RED""Agent is not running after the update.$NC"
  if [ -f "$PREV" ]; then
    warn "Restoring the previous binary..."
    mv -f "$PREV" "$BIN"
    systemctl restart "$SERVICE" || true
    sleep 3
    if systemctl is-active --quiet "$SERVICE"; then
      warn "Previous agent restored and running."
    else
      echo -e "$RED""Previous agent could not be started either: journalctl -u $SERVICE -xe$NC"
    fi
  else
    echo -e "$RED""Check: journalctl -u $SERVICE -xe$NC"
  fi
  exit 1
fi
`

    return new NextResponse(installScript, {
      headers: {
        'Content-Type': 'text/x-sh; charset=utf-8',
        'Content-Disposition': 'inline; filename="install-agent.sh"',
      },
    })
  } catch (error) {
    console.error('Failed to generate install script:', error)
    return new NextResponse('Failed to generate install script', { status: 500 })
  }
}
