# Agent Binaries - Automatischer Build

## ✅ Neu: Automatischer Build beim Server-Start

Die Agent-Binaries werden jetzt **automatisch** beim Server-Start gebaut, wenn sie fehlen.

### Wie es funktioniert:

**Docker-Deployment:**
- Binaries werden während `docker compose build` kompiliert (Multi-Stage Build)
- Beim Container-Start: Automatische Prüfung ob Binaries vorhanden
- Falls fehlen: Warnung (Image wurde falsch gebaut)

**Native Deployment:**
- Beim `npm start` oder `npm run dev`: Automatische Prüfung
- Falls fehlen: Automatischer Build via Docker (bevorzugt) oder lokalem Go
- Stille wenn Binaries schon existieren (kein nerviges Output bei jedem Start)

---

## 🚀 Installation & Start

### Docker (Empfohlen):

```bash
cd ~/Maintainer
docker compose build
docker compose up -d
```

**Die Binaries werden automatisch gebaut!** ✨

### Native (Node.js):

```bash
cd ~/Maintainer/server
npm install
npm start  # oder: npm run dev
```

**Beim ersten Start:**
- Script prüft ob Binaries fehlen
- Baut automatisch via Docker (falls verfügbar) oder Go
- Bei weiteren Starts: Still (Binaries schon da)

---

## 📋 Voraussetzungen (nur native)

**Eine** der folgenden Optionen muss installiert sein:

1. **Docker** (empfohlen) - für Cross-Compilation
2. **Go 1.21+** - falls kein Docker verfügbar

Bei Docker-Deployment: **Keine** zusätzlichen Tools nötig!

---

## 🔍 Manueller Build (optional)

Falls du die Binaries manuell bauen möchtest:

```bash
cd ~/Maintainer/agent
./build-agent.sh
```

---

## ⚠️ Fehlerbehebung

### "Agent binaries missing" Warnung

**Bei Docker:**
```bash
# Image neu bauen
docker compose build --no-cache server
docker compose up -d
```

**Bei Native:**
```bash
# Manuell bauen
cd agent
./build-agent.sh

# Oder Server neu starten (baut automatisch)
cd ../server
npm start
```

### "Neither Docker nor Go available"

Installiere **eine** der beiden Optionen:

- **Docker**: https://docs.docker.com/install
- **Go**: https://go.dev/doc/install

Dann Server neu starten.

---

## 📁 Automatischer Build-Check

Das Script `server/scripts/build-agents-if-needed.sh` wird automatisch aufgerufen:

- ✅ Vor `npm start` (via `prestart` hook)
- ✅ Vor `npm run dev` (via `predev` hook)
- ✅ Nach `npm run build` (via `postbuild` hook)
- ✅ Bei Docker-Container-Start (via `docker-entrypoint.sh`)

**Du musst nichts manuell machen!** 🎉
