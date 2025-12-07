# MaintainerWeb - Quick Start Guide

## 🎯 Übersicht

MaintainerWeb ist ein vollständiges VM-Management-System bestehend aus:

1. **Server** (Next.js) - Web-Dashboard zur Verwaltung aller VMs
2. **Agent** (Go) - Leichtgewichtiger Agent der auf jeder VM läuft

## 🚀 Schnellstart (5 Minuten)

### Schritt 1: Server starten

```bash
# In diesem Verzeichnis
chmod +x setup-server.sh
./setup-server.sh

# Server starten
cd server
npm run dev
```

Server läuft auf: **http://localhost:3000**

### Schritt 2: Agent bauen

```bash
# In einem neuen Terminal
chmod +x build-agent.sh
./build-agent.sh
```

### Schritt 3: Agent auf einer VM installieren

**Auf deiner VM:**

```bash
# Install-Script herunterladen
wget http://YOUR_SERVER_IP:3000/install-agent.sh
chmod +x install-agent.sh

# Als root ausführen
sudo ./install-agent.sh
```

**Oder manuell:**

```bash
# Binary kopieren
scp agent/maintainer-agent-linux-amd64 user@vm:/tmp/

# Auf der VM
ssh user@vm
sudo mv /tmp/maintainer-agent-linux-amd64 /usr/local/bin/maintainer-agent
sudo chmod +x /usr/local/bin/maintainer-agent

# Config erstellen
sudo mkdir -p /etc/maintainer-agent
SECRET_KEY=$(openssl rand -hex 32)

sudo tee /etc/maintainer-agent/config.json > /dev/null <<EOF
{
  "server_url": "ws://YOUR_SERVER_IP:3000/ws/agent",
  "secret_key": "$SECRET_KEY"
}
EOF

# Systemd Service
sudo tee /etc/systemd/system/maintainer-agent.service > /dev/null <<EOF
[Unit]
Description=Maintainer Agent
After=network.target

[Service]
Type=simple
User=root
ExecStart=/usr/local/bin/maintainer-agent -config /etc/maintainer-agent/config.json
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# Starten
sudo systemctl daemon-reload
sudo systemctl enable maintainer-agent
sudo systemctl start maintainer-agent
sudo systemctl status maintainer-agent

# Secret Key notieren!
echo "Secret Key: $SECRET_KEY"
```

### Schritt 4: Dashboard öffnen

Öffne **http://localhost:3000** im Browser.

Deine VM sollte jetzt im Dashboard erscheinen! 🎉

## 📊 Was du sehen solltest

### Dashboard
- ✅ Grid mit allen VMs
- ✅ Online/Offline Status mit grünem/grauem Indikator
- ✅ Live Metriken: CPU, RAM, Disk, Uptime
- ✅ OS Information

### VM Detail-Seite (Klick auf eine VM)
- ✅ Detaillierte System-Info
- ✅ Große Metrik-Anzeigen mit Balken
- ✅ Quick Actions:
  - Terminal öffnen
  - System Update
  - Neustart
- ✅ Command History
- ✅ Status-Info

### Terminal
- ✅ Vollwertiges Terminal im Browser
- ✅ Interaktiv (wie SSH)
- ✅ Farbige Ausgabe
- ✅ Copy & Paste

## 🎨 Design-Features

- Modern mit Gradient Backgrounds
- Smooth Hover-Effekte
- Pulse-Animation für Online-Status
- Responsive (Mobile, Tablet, Desktop)
- Klare Farb-Codierung:
  - 🟢 Grün = Online, Erfolgreich
  - 🟠 Orange = Warnung, Restart
  - 🔴 Rot = Fehler, Offline
  - 🔵 Blau = Info, Primär-Aktion

## 🛠️ Entwicklung

### Server Development

```bash
cd server
npm run dev              # Start dev server
npm run prisma:studio    # Open DB GUI
npm run lint            # Run linter
```

### Agent Development

```bash
cd agent
go run main.go -server ws://localhost:3000/ws/agent -key test-key
```

## 📝 Nächste Schritte

1. **Mehr VMs hinzufügen**: Wiederhole Schritt 3 für jede VM
2. **Custom Commands**: Nutze die "Execute Command" Funktion
3. **Monitoring**: Beobachte Live-Metriken
4. **Terminal**: Teste SSH-Alternative

## 🐛 Probleme?

### Agent verbindet nicht

```bash
# Logs prüfen
sudo journalctl -u maintainer-agent -f

# Manuell testen
/usr/local/bin/maintainer-agent -server ws://YOUR_SERVER:3000/ws/agent -key YOUR_KEY
```

### Server Error

```bash
# Prisma neu generieren
cd server
npm run prisma:generate
npm run prisma:migrate
```

### VM erscheint nicht im Dashboard

1. Check Agent Status: `sudo systemctl status maintainer-agent`
2. Check Server Logs: Im Terminal wo `npm run dev` läuft
3. Check Firewall: Port 3000 muss erreichbar sein
4. Check Secret Key: Muss korrekt sein

## 📚 Weiterführend

Siehe [README.md](./README.md) für:
- Vollständige Feature-Liste
- Architektur-Details
- Production-Deployment
- Troubleshooting
- Future Features

---

**Viel Erfolg! 🚀**

Bei Fragen oder Problemen, check die Logs mit:
- Server: Terminal Output
- Agent: `sudo journalctl -u maintainer-agent -f`
