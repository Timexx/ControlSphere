#!/bin/sh
set -e

echo "============================================"
echo "  ControlSphere Server"
echo "============================================"
echo ""

# ── Auto-generate secrets if not supplied ───────────────────────────────
# Secrets are stored in a named Docker volume (/app/.secrets) so they
# survive container restarts. If you provide JWT_SECRET or
# SESSION_TOKEN_SECRET as environment variables they always take precedence.
SECRETS_DIR="/app/.secrets"
mkdir -p "$SECRETS_DIR"

if [ -z "$JWT_SECRET" ]; then
  if [ -f "$SECRETS_DIR/jwt_secret" ]; then
    JWT_SECRET=$(cat "$SECRETS_DIR/jwt_secret")
    echo "[secrets] Loaded JWT_SECRET from secrets volume."
  else
    JWT_SECRET=$(openssl rand -base64 64 | tr -d '\n')
    echo "$JWT_SECRET" > "$SECRETS_DIR/jwt_secret"
    chmod 600 "$SECRETS_DIR/jwt_secret"
    echo "[secrets] Generated and saved new JWT_SECRET."
  fi
  export JWT_SECRET
fi

if [ -z "$SESSION_TOKEN_SECRET" ]; then
  if [ -f "$SECRETS_DIR/session_token_secret" ]; then
    SESSION_TOKEN_SECRET=$(cat "$SECRETS_DIR/session_token_secret")
    echo "[secrets] Loaded SESSION_TOKEN_SECRET from secrets volume."
  else
    SESSION_TOKEN_SECRET=$(openssl rand -hex 32)
    echo "$SESSION_TOKEN_SECRET" > "$SECRETS_DIR/session_token_secret"
    chmod 600 "$SECRETS_DIR/session_token_secret"
    echo "[secrets] Generated and saved new SESSION_TOKEN_SECRET."
  fi
  export SESSION_TOKEN_SECRET
fi

# ── Run Prisma migrations ────────────────────────────────────────────────
echo "Running Prisma migrations..."
npx prisma migrate deploy

echo ""
echo "Starting server..."
exec node server.js
