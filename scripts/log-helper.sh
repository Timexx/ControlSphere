#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# log-helper.sh — Shared logging infrastructure for setup & update scripts
#
# Usage (source from another script):
#   source "$(dirname "$0")/scripts/log-helper.sh"
#   init_log "setup"          # or "update"
#   rotate_logs "setup" 10    # keep max 10 logs with this prefix
#   enable_logging            # tee stdout+stderr to terminal AND logfile
#   trap 'finalize_log $?' EXIT
# ─────────────────────────────────────────────────────────────────────────────

# Resolve the project root (the directory containing this scripts/ folder)
_LOG_HELPER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_ROOT_DIR="$(cd "$_LOG_HELPER_DIR/.." && pwd)"
LOG_DIR="$LOG_ROOT_DIR/logs"
LOG_FILE=""
_LOG_START_SECONDS="$SECONDS"

# ── init_log <prefix> ────────────────────────────────────────────────────────
# Creates the logs/ directory and sets LOG_FILE to a timestamped path.
# Writes a header with system info directly to the logfile (before tee).
init_log() {
  local prefix="${1:?init_log requires a prefix (e.g. setup, update)}"
  local timestamp
  timestamp="$(date '+%Y-%m-%d_%H%M%S')"

  mkdir -p "$LOG_DIR" 2>/dev/null || sudo mkdir -p "$LOG_DIR"
  # If the logs directory was created by root in a prior sudo run, fix ownership
  if [ ! -w "$LOG_DIR" ] && command -v sudo >/dev/null 2>&1; then
    sudo chown "$(id -u):$(id -g)" "$LOG_DIR"
  fi

  # Allow the caller (e.g. server execute route) to specify the log path
  if [ -n "$CS_UPDATE_LOG" ]; then
    LOG_FILE="$CS_UPDATE_LOG"
  else
    LOG_FILE="$LOG_DIR/${prefix}-${timestamp}.log"
  fi
  _LOG_START_SECONDS="$SECONDS"

  # Write header directly to the logfile
  {
    echo "═══════════════════════════════════════════════════════════════"
    echo "  ControlSphere ${prefix} log"
    echo "  Started:  $(date '+%Y-%m-%d %H:%M:%S %Z')"
    echo "  Host:     $(hostname 2>/dev/null || echo 'unknown')"
    echo "  OS:       $(uname -srm 2>/dev/null || echo 'unknown')"
    echo "  User:     $(whoami 2>/dev/null || echo 'unknown') (SUDO_USER=${SUDO_USER:-n/a})"
    echo "  Bash:     ${BASH_VERSION}"
    echo "═══════════════════════════════════════════════════════════════"
    echo ""
  } > "$LOG_FILE"
}

# ── rotate_logs <prefix> [max] ───────────────────────────────────────────────
# Keeps at most <max> (default 10) log files matching <prefix>-*.log.
# Oldest files (by name sort) are deleted first.
rotate_logs() {
  local prefix="${1:?rotate_logs requires a prefix}"
  local max="${2:-10}"

  [ -d "$LOG_DIR" ] || return 0

  local files
  files=( "$LOG_DIR"/${prefix}-*.log )

  # If glob didn't match, the array contains the literal pattern
  [[ -e "${files[0]}" ]] || return 0

  local count="${#files[@]}"
  if (( count > max )); then
    local to_delete=$(( count - max ))
    # Files are sorted by glob (alphabetical = chronological for our format)
    for (( i = 0; i < to_delete; i++ )); do
      rm -f "${files[$i]}" 2>/dev/null || true
    done
  fi
}

# ── enable_logging ────────────────────────────────────────────────────────────
# Redirects all subsequent stdout and stderr through tee so output goes to
# both the terminal and the logfile. Requires LOG_FILE to be set (call
# init_log first).
enable_logging() {
  if [ -z "$LOG_FILE" ]; then
    echo "ERROR: enable_logging called before init_log" >&2
    return 1
  fi

  # Use process substitution to tee both stdout and stderr into the logfile
  # while keeping them visible on the terminal.
  exec > >(tee -a "$LOG_FILE") 2>&1
}

# ── finalize_log <exit_code> ──────────────────────────────────────────────────
# Writes a footer with the exit status and duration. Called via:
#   trap 'finalize_log $?' EXIT
finalize_log() {
  local exit_code="${1:-$?}"
  local duration=$(( SECONDS - _LOG_START_SECONDS ))
  local minutes=$(( duration / 60 ))
  local seconds=$(( duration % 60 ))

  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  if [ "$exit_code" -eq 0 ]; then
    echo "  ✓ Completed successfully"
  else
    echo "  ✗ Failed with exit code $exit_code"
  fi
  echo "  Duration: ${minutes}m ${seconds}s"
  echo "  Finished: $(date '+%Y-%m-%d %H:%M:%S %Z')"
  echo "═══════════════════════════════════════════════════════════════"
  echo ""
  echo "📄 Full log saved to: $LOG_FILE"
}
