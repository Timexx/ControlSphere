#!/bin/bash
# Remote Agent Update - Automatisches Deployment auf alle konfigurierten Hosts
# Usage: ./update-all-agents.sh

set -e

# Konfiguration - Passe diese Hosts an deine Umgebung an
AGENT_HOSTS=(
    "192.168.10.12"
    "192.168.10.15"
    "192.168.10.16"
    "192.168.10.22"
    "192.168.10.24"
)

BINARY_PATH="/Volumes/home-1/Maintainer/agent/maintainer-agent"

echo "=== Remote Agent Update ==="
echo ""
echo "Hosts: ${AGENT_HOSTS[@]}"
echo ""

# Prüfe ob Binary existiert
if [ ! -f "$BINARY_PATH" ]; then
    echo "❌ Agent Binary nicht gefunden: $BINARY_PATH"
    echo ""
    echo "Baue erst den Agent:"
    echo "  cd /Volumes/home-1/Maintainer/agent"
    echo "  go build -o maintainer-agent main.go"
    echo ""
    exit 1
fi

BINARY_SIZE=$(ls -lh "$BINARY_PATH" | awk '{print $5}')
BINARY_DATE=$(ls -l "$BINARY_PATH" | awk '{print $6, $7, $8}')
echo "Binary: $BINARY_SIZE (erstellt: $BINARY_DATE)"
echo ""

# Bestätigung
read -p "Fortfahren mit Update auf ${#AGENT_HOSTS[@]} Hosts? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Abgebrochen."
    exit 0
fi

echo ""
SUCCESS_COUNT=0
FAILED_HOSTS=()

for HOST in "${AGENT_HOSTS[@]}"; do
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Updating: $HOST"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    # Test SSH Connection
    if ! ssh -o ConnectTimeout=5 root@$HOST "echo 'Connected'" &>/dev/null; then
        echo "❌ SSH Verbindung fehlgeschlagen zu $HOST"
        FAILED_HOSTS+=("$HOST (SSH failed)")
        echo ""
        continue
    fi
    
    # Stop agent
    echo "  [1/6] Stoppe Agent..."
    ssh root@$HOST "systemctl stop maintainer-agent 2>/dev/null || true"
    
    # Backup old binary
    echo "  [2/6] Backup alte Binary..."
    ssh root@$HOST "[ -f /usr/local/bin/maintainer-agent ] && cp /usr/local/bin/maintainer-agent /usr/local/bin/maintainer-agent.backup-\$(date +%Y%m%d-%H%M%S) || true"
    
    # Deploy new binary
    echo "  [3/6] Deploye neue Binary..."
    if ! scp -q "$BINARY_PATH" root@$HOST:/usr/local/bin/maintainer-agent; then
        echo "❌ SCP fehlgeschlagen zu $HOST"
        FAILED_HOSTS+=("$HOST (SCP failed)")
        ssh root@$HOST "systemctl start maintainer-agent 2>/dev/null || true"
        echo ""
        continue
    fi
    
    # Set permissions
    echo "  [4/6] Setze Permissions..."
    ssh root@$HOST "chmod +x /usr/local/bin/maintainer-agent"
    
    # Start agent
    echo "  [5/6] Starte Agent..."
    ssh root@$HOST "systemctl start maintainer-agent"
    
    # Wait a moment for startup
    sleep 2
    
    # Check status
    echo "  [6/6] Prüfe Status..."
    if ssh root@$HOST "systemctl is-active maintainer-agent" &>/dev/null; then
        echo "  ✓ Agent läuft"
        
        # Show first log lines
        echo ""
        echo "  Latest logs:"
        ssh root@$HOST "journalctl -u maintainer-agent -n 5 --no-pager" 2>/dev/null | sed 's/^/    /' || echo "    (Logs nicht verfügbar)"
        echo ""
        
        SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
    else
        echo "  ❌ Agent nicht gestartet!"
        FAILED_HOSTS+=("$HOST (failed to start)")
        
        # Show error logs
        echo ""
        echo "  Error logs:"
        ssh root@$HOST "journalctl -u maintainer-agent -n 10 --no-pager" 2>/dev/null | sed 's/^/    /' || echo "    (Logs nicht verfügbar)"
        echo ""
    fi
    
    echo ""
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "=== Update Summary ==="
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Total Hosts:     ${#AGENT_HOSTS[@]}"
echo "Successful:      $SUCCESS_COUNT"
echo "Failed:          ${#FAILED_HOSTS[@]}"
echo ""

if [ ${#FAILED_HOSTS[@]} -gt 0 ]; then
    echo "Failed Hosts:"
    for HOST in "${FAILED_HOSTS[@]}"; do
        echo "  - $HOST"
    done
    echo ""
fi

echo "Next Steps:"
echo "1. Prüfe Server-Logs auf erfolgreiche Registrierungen"
echo "2. Überprüfe Frontend ob Agents online sind"
echo "3. Bei Problemen: journalctl -u maintainer-agent -f auf dem Host"
echo ""

if [ $SUCCESS_COUNT -eq ${#AGENT_HOSTS[@]} ]; then
    echo "✅ Alle Agents erfolgreich aktualisiert!"
    exit 0
else
    echo "⚠️  Einige Agents konnten nicht aktualisiert werden."
    exit 1
fi
