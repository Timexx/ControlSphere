#!/usr/bin/env bash
# Reproducible agent build with version + manifest.
# Rebuilds only if the agent source tree changed (or --force).
#
# Usage: build-agents-if-needed.sh [--force | --check]
#   --force  always build
#   --check  only check; exit 0 if up to date, 1 if a rebuild is needed
# Env: AGENT_VERSION overrides the version string (test builds).
#      AGENT_LDFLAGS_EXTRA is appended to -ldflags (test builds only, e.g.
#      "-X main.selfTestSkipRegister=1" for the rollback test).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$SERVER_DIR/.." && pwd)"
AGENT_DIR="$REPO_ROOT/agent"
DOWNLOADS_DIR="$SERVER_DIR/public/downloads"
MANIFEST="$DOWNLOADS_DIR/manifest.json"

FORCE=false
CHECK=false
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=true ;;
    --check) CHECK=true ;;
    *) echo "[agent-build] Unknown option: $arg" >&2
       echo "Usage: $0 [--force | --check]" >&2
       exit 2 ;;
  esac
done

log() { echo "[agent-build] $*"; }

# ---- source tree identity -------------------------------------------------
if ! SOURCE_TREE="$(git -C "$REPO_ROOT" rev-parse HEAD:agent 2>/dev/null)"; then
  echo "[agent-build] ERROR: cannot determine git tree of agent/ (not a git checkout?)" >&2
  exit 1
fi
DIRTY=false
if [ -n "$(git -C "$REPO_ROOT" status --porcelain -- agent)" ]; then
  DIRTY=true
  # Deterministic hash over tracked + untracked (non-ignored) files, excluding agent/bin
  DIRTY_HASH="$(
    cd "$REPO_ROOT"
    git ls-files -z --cached --others --exclude-standard -- agent \
      | LC_ALL=C sort -z \
      | while IFS= read -r -d '' f; do
          case "$f" in agent/bin/*) continue ;; esac
          [ -f "$f" ] || continue
          sha256sum -- "$f"
        done \
      | sha256sum | cut -d' ' -f1
  )"
  SOURCE_TREE="dirty-$DIRTY_HASH"
fi

VERSION="${AGENT_VERSION:-$(git -C "$REPO_ROOT" describe --tags --always)}"
if [ "$DIRTY" = true ]; then
  VERSION="$VERSION-dirty"
fi

# ---- is a rebuild needed? -------------------------------------------------
needs_build() {
  [ "$FORCE" = true ] && return 0
  [ -f "$MANIFEST" ] || return 0
  [ -f "$DOWNLOADS_DIR/maintainer-agent" ] || return 0
  command -v node >/dev/null 2>&1 || return 0
  node -e '
    const fs = require("fs"), path = require("path");
    const [manifest, dir, tree] = process.argv.slice(1);
    let m;
    try { m = JSON.parse(fs.readFileSync(manifest, "utf8")); } catch (e) { process.exit(1); }
    if (!m || m.sourceTree !== tree || !m.binaries) process.exit(1);
    for (const b of Object.values(m.binaries)) {
      if (!b || !b.file || !fs.existsSync(path.join(dir, b.file))) process.exit(1);
    }
    process.exit(0);
  ' "$MANIFEST" "$DOWNLOADS_DIR" "$SOURCE_TREE" && return 1
  return 0
}

if ! needs_build; then
  log "Agent binaries up to date (version $VERSION, sourceTree $SOURCE_TREE)"
  exit 0
fi

if [ "$CHECK" = true ]; then
  log "Rebuild needed (sourceTree $SOURCE_TREE)"
  exit 1
fi

# ---- locate go --------------------------------------------------------------
GO_BIN=""
if command -v go >/dev/null 2>&1; then
  GO_BIN="$(command -v go)"
elif [ -x /usr/local/go/bin/go ]; then
  GO_BIN=/usr/local/go/bin/go
elif [ -x /usr/bin/go ]; then
  GO_BIN=/usr/bin/go
else
  echo "[agent-build] ERROR: Go toolchain not found (looked in PATH, /usr/local/go/bin, /usr/bin)." >&2
  echo "[agent-build] Install Go 1.24+ to build the agent binaries." >&2
  exit 1
fi
if [ ! -d "$AGENT_DIR" ]; then
  echo "[agent-build] ERROR: agent source directory not found: $AGENT_DIR" >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "[agent-build] ERROR: node is required to write the manifest." >&2
  exit 1
fi
GO_VERSION="$("$GO_BIN" env GOVERSION)"

# ---- build into temp dir inside DOWNLOADS_DIR ------------------------------
mkdir -p "$DOWNLOADS_DIR"
TMP_DIR="$(mktemp -d "$DOWNLOADS_DIR/.build.XXXXXX")"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

log "Building version $VERSION (sourceTree $SOURCE_TREE) with $GO_VERSION"

TARGETS=(
  "linux amd64 maintainer-agent-linux-amd64"
  "linux arm64 maintainer-agent-linux-arm64"
  "windows amd64 maintainer-agent-windows-amd64.exe"
  "windows arm64 maintainer-agent-windows-arm64.exe"
)
ENTRIES_FILE="$TMP_DIR/entries.txt"
: > "$ENTRIES_FILE"

for t in "${TARGETS[@]}"; do
  read -r goos goarch file <<< "$t"
  log "Building $goos/$goarch -> $file"
  ( cd "$AGENT_DIR" && \
    CGO_ENABLED=0 GOOS="$goos" GOARCH="$goarch" \
    "$GO_BIN" build -trimpath -ldflags "-s -w -X main.Version=$VERSION ${AGENT_LDFLAGS_EXTRA:-}" -o "$TMP_DIR/$file" . )
  sha="$(sha256sum "$TMP_DIR/$file" | cut -d' ' -f1)"
  size="$(stat -c %s "$TMP_DIR/$file")"
  printf '%s-%s %s %s %s\n' "$goos" "$goarch" "$file" "$sha" "$size" >> "$ENTRIES_FILE"
done

# Compatibility copy for old install scripts (= linux-amd64)
cp "$TMP_DIR/maintainer-agent-linux-amd64" "$TMP_DIR/maintainer-agent"

BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
node -e '
  const fs = require("fs");
  const [entries, out, version, tree, builtAt, goVersion] = process.argv.slice(1);
  const binaries = {};
  for (const line of fs.readFileSync(entries, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const [key, file, sha256, size] = line.split(" ");
    binaries[key] = { file, sha256, size: Number(size) };
  }
  const m = { version, sourceTree: tree, builtAt, goVersion, binaries };
  fs.writeFileSync(out, JSON.stringify(m, null, 2) + "\n");
' "$ENTRIES_FILE" "$TMP_DIR/manifest.json" "$VERSION" "$SOURCE_TREE" "$BUILT_AT" "$GO_VERSION"

# ---- all builds succeeded: publish atomically ---------------------------------
for t in "${TARGETS[@]}"; do
  read -r _ _ file <<< "$t"
  chmod 755 "$TMP_DIR/$file"
  mv -f "$TMP_DIR/$file" "$DOWNLOADS_DIR/$file"
done
chmod 755 "$TMP_DIR/maintainer-agent"
mv -f "$TMP_DIR/maintainer-agent" "$DOWNLOADS_DIR/maintainer-agent"

cp "$TMP_DIR/manifest.json" "$MANIFEST.tmp"
chmod 644 "$MANIFEST.tmp"
mv -f "$MANIFEST.tmp" "$MANIFEST"

# ---- summary --------------------------------------------------------------------
log "Done."
log "  Version:    $VERSION"
log "  sourceTree: $SOURCE_TREE"
log "  Go:         $GO_VERSION"
for f in maintainer-agent maintainer-agent-linux-amd64 maintainer-agent-linux-arm64 \
         maintainer-agent-windows-amd64.exe maintainer-agent-windows-arm64.exe manifest.json; do
  log "  $f ($(stat -c %s "$DOWNLOADS_DIR/$f") bytes)"
done
