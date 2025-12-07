#!/bin/bash

# DDoS Login Simulation Script für VMMaintainer Security Testing
# Simuliert multiple parallele Login-Versuche mit falschen Credentials

SERVER_URL="${1:-http://localhost:3000}"
CONCURRENT_REQUESTS="${2:-10}"
TOTAL_REQUESTS="${3:-100}"

echo "🚀 Starting DDoS Login Simulation"
echo "Server: $SERVER_URL"
echo "Concurrent requests: $CONCURRENT_REQUESTS"
echo "Total requests: $TOTAL_REQUESTS"
echo "========================================"

# Funktion für einen einzelnen Login-Versuch
attempt_login() {
    local attempt=$1
    local username="admin${attempt}"
    local password="wrongpass${attempt}"

    # Verwende curl für POST-Request
    response=$(curl -s -w "%{http_code}" -X POST "$SERVER_URL/api/auth/login" \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"$username\",\"password\":\"$password\"}" \
        2>/dev/null)

    # Extrahiere HTTP Status Code (letzte 3 Zeichen)
    status_code="${response: -3}"

    if [ "$status_code" = "401" ]; then
        echo "❌ Attempt $attempt: Invalid credentials (expected)"
    elif [ "$status_code" = "400" ]; then
        echo "⚠️  Attempt $attempt: Bad request"
    elif [ "$status_code" = "200" ]; then
        echo "✅ Attempt $attempt: Login successful (unexpected!)"
    else
        echo "❓ Attempt $attempt: Status $status_code"
    fi
}

export -f attempt_login
export SERVER_URL

# Starte parallele Requests mit xargs
seq 1 $TOTAL_REQUESTS | xargs -n 1 -P $CONCURRENT_REQUESTS bash -c 'attempt_login "$@"' _

echo "========================================"
echo "✅ DDoS Login Simulation completed"
echo "Check server logs for security events and audit logs"