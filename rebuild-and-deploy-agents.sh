#!/bin/bash
# Agent neu kompilieren und deployen mit Auto-Migration
# Usage: ./rebuild-and-deploy-agents.sh [agent-host1] [agent-host2] ...

set -e

echo "=== Maintainer Agent - Build & Deploy mit Auto-Migration ==="
echo ""

# 1. Agent neu kompilieren
echo "[1/5] Kompiliere Agent..."
cd /Volumes/home-1/Maintainer/agent

# Prüfe ob Go installiert ist
if ! command -v go &> /dev/null; then
    echo "⚠️  Go ist auf diesem Mac nicht installiert."
    echo ""
    echo "Option 1: Go lokal installieren:"
    echo "  brew install go"
    echo ""
    echo "Option 2: Auf einem Linux-Host mit Go kompilieren:"
    echo "  ssh root@<build-host>"
    echo "  cd /path/to/Maintainer/agent"
    echo "  go build -o maintainer-agent main.go"
    echo ""
    exit 1
fi

# Build mit Versions-Info
VERSION="2.0.0-$(date +%Y%m%d%H%M%S)"
go build -ldflags "-X main.Version=$VERSION" -o maintainer-agent main.go

if [ ! -f maintainer-agent ]; then
    echo "❌ Build fehlgeschlagen - maintainer-agent nicht erstellt"
    exit 1
fi

SIZE=$(ls -lh maintainer-agent | awk '{print $5}')
echo "✓ Agent kompiliert (Version: $VERSION, Größe: $SIZE)"
echo ""

# 2. Prüfe ob Agent das type field sendet
echo "[2/5] Prüfe Agent-Code..."
if grep -q 'Type:.*"register"' main.go; then
    echo "✓ Agent sendet 'type: register'"
else
    echo "❌ Agent-Code ist nicht aktualisiert!"
    echo "  Führe erst die Code-Änderungen durch!"
    exit 1
fi

if grep -q 'normalizeSecretKey' main.go; then
    echo "✓ Auto-Migration für SecretKey vorhanden"
else
    echo "⚠️  Auto-Migration fehlt (optional)"
fi
echo ""

# 3. Agent in Download-Verzeichnis kopieren
echo "[3/5] Kopiere Agent ins Download-Verzeichnis..."
cp maintainer-agent ../server/public/downloads/maintainer-agent
chmod +x ../server/public/downloads/maintainer-agent
echo "✓ Agent bereitgestellt für Download"
echo ""

# 4. Deploy auf Agents (wenn Hosts als Parameter übergeben)
if [ $# -eq 0 ]; then
    echo "[4/5] Keine Agent-Hosts angegeben - überspringe automatisches Deployment"
    echo ""
    echo "Manuelle Deployment-Befehle für jeden Agent-Host:"
    echo ""
    echo "# Agent stoppen"
    echo "sudo systemctl stop maintainer-agent"
    echo ""
    echo "# Neue Binary deployen (von diesem Mac aus)"
    echo "scp maintainer-agent root@<agent-host>:/usr/local/bin/"
    echo ""
    echo "# Agent neu starten"
    echo "sudo systemctl start maintainer-agent"
    echo ""
    echo "# Logs prüfen"
    echo "sudo journalctl -u maintainer-agent -f"
    echo ""
else
    echo "[4/5] Deploye Agent auf Hosts..."
    for HOST in "$@"; do
        echo ""
        echo "Deploying to $HOST..."
        
        # Stop agent
        ssh root@$HOST "systemctl stop maintainer-agent 2>/dev/null || true"
        
        # Backup old binary
        ssh root@$HOST "[ -f /usr/local/bin/maintainer-agent ] && cp /usr/local/bin/maintainer-agent /usr/local/bin/maintainer-agent.backup-$(date +%Y%m%d) || true"
        
        # Deploy new binary
        scp maintainer-agent root@$HOST:/usr/local/bin/maintainer-agent
        
        # Set permissions
        ssh root@$HOST "chmod +x /usr/local/bin/maintainer-agent"
        
        # Start agent
        ssh root@$HOST "systemctl start maintainer-agent"
        
        echo "✓ Deployed to $HOST"
        
        # Show first few log lines
        echo "  Latest logs:"
        ssh root@$HOST "journalctl -u maintainer-agent -n 5 --no-pager" | sed 's/^/  /'
    done
    echo ""
fi

# 5. Zeige Auto-Migration Info
echo "[5/5] Auto-Migration Features:"
echo ""
echo "Der neue Agent führt beim Start automatisch durch:"
echo ""
echo "✓ SecretKey-Normalisierung:"
echo "  - Prüft ob SecretKey exakt 64 Hex-Zeichen ist"
echo "  - Falls nicht: Generiert SHA-256 Hash des alten Keys"
echo "  - Speichert normalisierten Key zurück in config.json"
echo ""
echo "✓ Protokoll-Kompatibilität:"
echo "  - Sendet IMMER 'type' field in allen Nachrichten"
echo "  - Verwendet flache JSON-Struktur (kein verschachteltes 'data')"
echo "  - Kompatibel mit Server v2.0+ Protokoll-Enforcement"
echo ""
echo "✓ Backward-Kompatibilität:"
echo "  - Liest alte Config-Dateien"
echo "  - Migriert automatisch beim ersten Start"
echo "  - Keine manuelle Intervention nötig"
echo ""

echo "=== Fertig! ==="
echo ""
echo "WICHTIG:"
echo "1. Server muss mit v2.0 laufen (Protocol Enforcement aktiv)"
echo "2. Agents werden beim ersten Start ihre Configs migrieren"
echo "3. Prüfe Server-Logs auf erfolgreiche Registrierung"
echo ""
echo "Erwartete Server-Logs:"
echo "  [INFO] AgentConnected { ip: '192.168.10.x' }"
echo "  [INFO] AgentRegistered { machineId: 'xxx', hostname: 'xxx' }"
echo "  (KEINE MessageMissingTypeRejected errors!)"
echo ""
