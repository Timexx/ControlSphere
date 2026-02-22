#!/bin/sh
set -e

echo "============================================"
echo "  ControlSphere Server"
echo "============================================"
echo ""

# -- Auto-generate ALL secrets if not supplied ---------------------------
# Secrets are stored in a named Docker volume (/app/.secrets) so they
# survive container restarts. Environment variables always take precedence.
SECRETS_DIR="/app/.secrets"
mkdir -p "$SECRETS_DIR"

auto_secret() {
  local var_name="$1" file="$SECRETS_DIR/$2" gen_cmd="$3"
  eval "local current=\${$var_name:-}"
  if [ -n "$current" ]; then
    return
  fi
  if [ -f "$file" ]; then
    eval "export $var_name=\$(cat \"$file\")"
    echo "[secrets] Loaded $var_name from secrets volume."
  else
    local value
    value=$(eval "$gen_cmd")
    echo "$value" > "$file"
    chmod 600 "$file"
    eval "export $var_name=\"$value\""
    echo "[secrets] Generated and saved new $var_name."
  fi
}

auto_secret JWT_SECRET            jwt_secret            "openssl rand -base64 64 | tr -d '\n'"
auto_secret SESSION_TOKEN_SECRET  session_token_secret  "openssl rand -hex 32"
auto_secret POSTGRES_PASSWORD     postgres_password     "openssl rand -base64 24 | tr -d '+/=\n' | head -c 32"

# Build DATABASE_URL from the (potentially auto-generated) password
# if the caller did not set DATABASE_URL explicitly.
if [ -z "$DATABASE_URL" ]; then
  export DATABASE_URL="postgresql://maintainer:${POSTGRES_PASSWORD}@postgres:5432/maintainer?schema=public&connection_limit=20"
  echo "[secrets] DATABASE_URL built from auto-generated credentials."
fi

# -- Run Prisma migrations ------------------------------------------------
echo "Running Prisma migrations..."
npx prisma migrate deploy

echo ""
echo "Starting server..."
exec node server.js
