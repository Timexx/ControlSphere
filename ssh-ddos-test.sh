#!/bin/bash

# DDoS SSH Login Simulation für VM Agent Security Testing
# Generiert multiple fehlgeschlagene SSH-Login-Versuche um Auth-Log-Monitoring zu testen

TARGET_HOST="${1:-localhost}"
USERNAME="${2:-root}"
CONCURRENT="${3:-5}"
TOTAL_ATTEMPTS="${4:-25}"

echo "🔐 Starting SSH DDoS Login Simulation"
echo "Target: $TARGET_HOST"
echo "Username: $USERNAME"
echo "Concurrent connections: $CONCURRENT"
echo "Total attempts: $TOTAL_ATTEMPTS"
echo "========================================"

# Funktion für einen SSH-Login-Versuch
attempt_ssh_login() {
    local attempt=$1
    local password="wrongpass${attempt}"

    # SSH-Verbindung mit Timeout und falschem Passwort
    # Verwende sshpass falls verfügbar, sonst expect oder einfache ssh mit timeout
    if command -v sshpass >/dev/null 2>&1; then
        # Mit sshpass (muss installiert sein: apt install sshpass)
        sshpass -p "$password" ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o PasswordAuthentication=yes "$USERNAME@$TARGET_HOST" "echo 'success'" 2>/dev/null
        exit_code=$?
    else
        # Fallback: Verwende expect falls verfügbar
        if command -v expect >/dev/null 2>&1; then
            expect -c "
                spawn ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 $USERNAME@$TARGET_HOST
                expect {
                    \"password:\" { send \"$password\r\"; expect eof }
                    \"yes/no\" { send \"yes\r\"; expect \"password:\"; send \"$password\r\"; expect eof }
                    eof { exit 0 }
                }
            " >/dev/null 2>&1
            exit_code=$?
        else
            # Einfacher Fallback: ssh mit timeout (funktioniert nur mit key auth)
            timeout 5 ssh -o StrictHostKeyChecking=no -o ConnectTimeout=3 "$USERNAME@$TARGET_HOST" "echo 'test'" 2>/dev/null
            exit_code=$?
        fi
    fi

    if [ $exit_code -eq 0 ]; then
        echo "✅ Attempt $attempt: Login successful (unexpected!)"
    else
        echo "❌ Attempt $attempt: Login failed (expected - auth log entry created)"
    fi
}

export -f attempt_ssh_login
export TARGET_HOST
export USERNAME

# Starte parallele SSH-Versuche
echo "Starting $TOTAL_ATTEMPTS SSH login attempts..."
seq 1 $TOTAL_ATTEMPTS | xargs -n 1 -P $CONCURRENT bash -c 'attempt_ssh_login "$@"' _

echo "========================================"
echo "✅ SSH DDoS Simulation completed"
echo ""
echo "📋 Check the following:"
echo "1. VMMaintainer Security Events (should show high severity for $TOTAL_ATTEMPTS failed logins)"
echo "2. Auth logs on VM: tail -f /var/log/auth.log"
echo "3. Agent logs for security event detection"
echo ""
echo "Expected results:"
echo "- 3-9 failed logins → medium severity event"
echo "- 10-49 failed logins → high severity event"
echo "- 50+ failed logins → critical severity event"