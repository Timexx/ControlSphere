# Windows Defender & Code-Signierung

## Problem

Windows Defender kann den Maintainer Agent als Trojaner oder verdächtige Software markieren, wenn:

1. **Autostart beim Reboot**: Der Agent wird als Windows Service registiert und startet automatisch beim Systemstart
2. **Keine Code-Signatur**: Die .exe ist nicht mit einem Authenticode-Zertifikat signiert
3. **Niedrige Reputation**: Wenige Downloads = unbekannte Software für SmartScreen

## Lösung 1: Automatische Windows Defender Exclusion (✅ Implementiert)

Das PowerShell-Installationsskript fügt automatisch Exclusions hinzu:

```powershell
Add-MpPreference -ExclusionProcess "C:\ProgramData\maintainer-agent\maintainer-agent.exe"
Add-MpPreference -ExclusionPath "C:\ProgramData\maintainer-agent"
```

**Vorteile:**
- ✅ Automatisch bei Admin-Installation
- ✅ Keine Benutzerinteraktion erforderlich
- ✅ Funktioniert sofort

**Nachteile:**
- ⚠️ Nur auf dem lokalen System
- ⚠️ Bei jeder Installation nötig

**Wie es funktioniert:**

Das Installationsskript (wird als Administrator ausgeführt) ruft `Add-MpPreference` auf, um:
1. Den Prozess (`-ExclusionProcess`) von Echtzeitscans auszunehmen
2. Das Verzeichnis (`-ExclusionPath`) von Scans auszunehmen

Dies ist legitim, da:
- Die Installation als **Administrator** erfolgt (bewusste Benutzeraktion)
- Der Admin die Software explizit installiert
- Antivirus-Software oft Exclusions für legitime System-Tools benötigt

## Lösung 2: Code-Signierung mit Authenticode (⭐ Empfohlen für Produktion)

### Was ist Code-Signierung?

Code-Signierung verifiziert:
- **Authentizität**: Wer hat die Software erstellt?
- **Integrität**: Wurde die .exe nach der Signierung verändert?
- **Vertrauen**: Ist der Publisher vertrauenswürdig?

### Zertifikat erwerben

**Kommerzielle Anbieter:**
- **DigiCert** (~$300-500/Jahr) — Standard für Windows-Software
- **Sectigo** (~$200-400/Jahr) — Günstigere Alternative
- **GlobalSign** (~$250-450/Jahr)

**Anforderungen:**
- Firmenregistrierung oder EV (Extended Validation) für sofortige Reputation
- Domain-Validierung
- Identity-Verifizierung

### Signierung durchführen

1. **Zertifikat importieren** (als .pfx):
   ```powershell
   Import-PfxCertificate -FilePath .\cert.pfx -CertStoreLocation Cert:\CurrentUser\My
   ```

2. **Agent signieren** mit `signtool.exe` (Windows SDK):
   ```batch
   signtool.exe sign /f cert.pfx /p "PASSWORD" /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 maintainer-agent.exe
   ```

3. **Build-Skript aktualisieren** ([agent/build-agent.sh](../agent/build-agent.sh)):
   ```bash
   # Nach dem Build für Windows:
   if [ -f "$SIGN_PFX_PATH" ]; then
       echo "Signing Windows binary..."
       signtool.exe sign /f "$SIGN_PFX_PATH" /p "$SIGN_PASSWORD" \
           /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 \
           maintainer-agent-windows-amd64.exe
   fi
   ```

### Timestamp-Server (wichtig!)

Der Timestamp-Server garantiert, dass die Signatur **auch nach Ablauf des Zertifikats** gültig bleibt:

```batch
/tr http://timestamp.digicert.com
```

**Alternativen:**
- `http://timestamp.sectigo.com`
- `http://timestamp.globalsign.com`
- `http://timestamp.comodoca.com`

### Verifizierung

```powershell
# Signatur prüfen
Get-AuthenticodeSignature .\maintainer-agent.exe

# Erwartetes Ergebnis:
# Status: Valid
# SignerCertificate: CN=Your Company Name
# TimeStamperCertificate: CN=DigiCert Timestamp...
```

## Lösung 3: SmartScreen Reputation aufbauen

Windows SmartScreen lernt durch:
- **Download-Anzahl**: Je mehr Benutzer die .exe herunterladen, desto besser
- **Zeit**: Neue Software wird misstrauischer behandelt
- **Signatur**: Signierte Software bekommt schneller Reputation

**Timeline:**
- Woche 1-2: "Unbekannter Publisher" Warnung
- Woche 3-4: Weniger Warnungen bei mehr Downloads
- Monat 2+: Mit genug Downloads keine Warnung mehr (für signierte .exe)

## Manuelle Exclusion durch Benutzer

Falls die automatische Exclusion fehlschlägt, gibt es zwei Optionen:

### Option 1: PowerShell-Script (✅ Empfohlen)

Auf dem Server befindet sich ein fertiges Script:

```powershell
# Als Administrator in PowerShell auf dem Windows-System:
irm http://YOUR-SERVER:3000/add-defender-exclusion.ps1 | iex
```

Oder lokal auf dem Server:
```bash
# Script verfügbar machen über Web
cp /path/to/Maintainer/add-defender-exclusion.ps1 /path/to/Maintainer/server/public/
```

### Option 2: Manueller PowerShell-Befehl

```powershell
# Als Administrator in PowerShell:
Add-MpPreference -ExclusionPath "C:\ProgramData\maintainer-agent"
Add-MpPreference -ExclusionProcess "C:\ProgramData\maintainer-agent\maintainer-agent.exe"
```

### Option 3: GUI

1. **Windows Security** öffnen
2. **Virus & threat protection** → **Manage settings**
3. **Exclusions** → **Add or remove exclusions**
4. **Add an exclusion** → **Folder**
5. `C:\ProgramData\maintainer-agent` auswählen

## Empfehlungen

| Szenario | Empfehlung |
|----------|------------|
| **Entwicklung/Testing** | Automatische Exclusion (bereits implementiert) ✅ |
| **Kleine Deployments (1-50 Systeme)** | Automatische Exclusion + manuelle Freigabe bei Bedarf |
| **Mittlere Deployments (50-500)** | Code-Signierung mit Standard-Zertifikat |
| **Große Deployments / SaaS** | Code-Signierung mit EV-Zertifikat ⭐ |
| **Open Source Distribution** | Code-Signierung (schafft Vertrauen) |

## Weitere Informationen

- [Microsoft: Authenticode](https://docs.microsoft.com/en-us/windows-hardware/drivers/install/authenticode)
- [SignTool.exe Documentation](https://docs.microsoft.com/en-us/windows/win32/seccrypto/signtool)
- [Windows Defender Exclusions Best Practices](https://docs.microsoft.com/en-us/microsoft-365/security/defender-endpoint/configure-exclusions-microsoft-defender-antivirus)

## Status

✅ **Automatische Windows Defender Exclusion implementiert** (24. Februar 2026)
- **Installation**: [server/src/app/install-agent.ps1/route.ts](../server/src/app/install-agent.ps1/route.ts) ← PowerShell-Script setzt Exclusions
- **Service-Installation**: [agent/service_windows.go](../agent/service_windows.go) ← Go-Code setzt Exclusions bei `-install`
- **Update**: [agent/platform/platform_windows.go](../agent/platform/platform_windows.go) - `GenerateUpdateScript()` ← Update-Script setzt Exclusions
- **Manuelles Tool**: [add-defender-exclusion.ps1](../add-defender-exclusion.ps1) ← Für nachträgliche Installation

⚠️ **Bekanntes Problem**: Update-Script läuft als SYSTEM, `Add-MpPreference` funktioniert möglicherweise nicht
- **Workaround**: Manuelles Script verwenden (siehe oben)
- **Fix folgt**: Service-Reinstallation triggern, die mit Admin-Rechten läuft

🔜 **Code-Signierung**: Geplant für Produktions-Releases

## Sofortmaßnahme für bestehende Installationen

Falls nach einem Agent-Update keine Defender Exclusions gesetzt sind:

1. **Script verfügbar machen**:
   ```bash
   # Auf dem Server
   cp /path/to/Maintainer/add-defender-exclusion.ps1 /path/to/Maintainer/server/public/
   ```

2. **Auf jedem Windows-System als Administrator**:
   ```powershell
   irm http://YOUR-SERVER:3000/add-defender-exclusion.ps1 | iex
   ```

3. **Service neu starten**:
   ```powershell
   Restart-Service MaintainerAgent
   ```

4. **Verifizieren**:
   ```powershell
   Get-MpPreference | Select-Object -ExpandProperty ExclusionPath
   # Sollte zeigen: C:\ProgramData\maintainer-agent
   ```
