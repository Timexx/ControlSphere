# Windows Defender Exclusion - Sofort-Fix

## Problem
Nach einem Agent-Update sind keine Windows Defender Exclusions gesetzt.

## Lösung (2 Minuten)

### Schritt 1: Auf deinem Server (aktuelles Terminal)

Script ist bereits verfügbar unter:
```
http://YOUR-SERVER-IP:3000/add-defender-exclusion.ps1
```

### Schritt 2: Auf dem Windows-System

**Als Administrator in PowerShell ausführen:**

```powershell
# Ersetze YOUR-SERVER-IP mit deiner tatsächlichen Server-IP
irm http://YOUR-SERVER-IP:3000/add-defender-exclusion.ps1 | iex
```

Das Script wird:
- ✅ Process Exclusion hinzufügen
- ✅ Path Exclusion hinzufügen
- ✅ Verifizieren, dass es funktioniert hat

### Schritt 3: Service neu starten

```powershell
Restart-Service MaintainerAgent
```

### Verifizierung

```powershell
# Prüfe, ob Exclusions gesetzt sind:
Get-MpPreference | Select-Object -ExpandProperty ExclusionPath
# Sollte zeigen: C:\ProgramData\maintainer-agent

Get-MpPreference | Select-Object -ExpandProperty ExclusionProcess  
# Sollte zeigen: C:\ProgramData\maintainer-agent\maintainer-agent.exe
```

## Langfristige Lösung

Die nächste Agent-Version wird die Exclusions automatisch setzen:
1. Bei Installation (PowerShell-Script)
2. Bei Service-Installation (Go-Code mit Admin-Rechten)
3. Bei Updates (Update-Script)

## Nächste Schritte

Wenn du den Agent neu bauen möchtest:

```bash
cd /Volumes/home/Maintainer/agent
./build-agent.sh

# Dann Server neu starten
cd /Volumes/home/Maintainer/server
npm run build
docker compose restart server  # oder: pm2 restart server
```

Die neuen Binaries enthalten dann die verbesserte Defender-Handling-Logik.
