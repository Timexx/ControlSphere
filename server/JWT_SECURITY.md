# JWT Security Configuration

## ✅ Security Fixes Implemented

### 1. **Automatische JWT_SECRET Generierung** ✅
Das System generiert **automatisch** ein sicheres `JWT_SECRET` beim ersten Start, wenn:
- Kein `JWT_SECRET` vorhanden ist
- Das vorhandene Secret zu schwach ist (< 32 Zeichen)
- Unsichere Muster erkannt werden (z.B. "change-me", "password")

### 2. **Edge Runtime Kompatibilität** ✅
- Lazy loading von Node.js Modulen (`fs`, `path`, `crypto`)
- Runtime-Erkennung (Edge vs. Node.js)
- Middleware funktioniert ohne Fehler in Next.js Edge Runtime

### 3. **Starke Secret-Anforderungen** ✅
- Automatisch 64 Bytes Entropie (base64-kodiert = ~88 Zeichen)
- Kryptographisch sicher mit `crypto.randomBytes(64)`
- Automatische Erkennung und Ersetzung unsicherer Secrets

### 4. **Automatische Session-Invalidierung** ✅
- Secret-Version-Tracking in jedem JWT (`secretVersion` field)
- Bei Secret-Änderung: Alle alten Sessions werden automatisch ungültig
- Keine manuellen Eingriffe erforderlich

## 🚀 Quick Start

### Einfacher Start (empfohlen)

```bash
cd server
npm run dev
```

Das war's! Beim ersten Start wird automatisch:
1. Ein sicheres JWT_SECRET generiert (64 Bytes)
2. In `.env` gespeichert
3. Der Server startet normal

### Ausgabe beim ersten Start:

```
🔐 Generating new JWT_SECRET...
✅ JWT_SECRET generated and saved to .env
🔒 Secret length: 88 characters
```

## 🚨 Sicherheitsrichtlinien

### ❌ NIEMALS verwenden:
- Default-Werte
- Kurze Secrets (< 32 Zeichen)
- Erkennbare Muster wie "password", "secret", "test"
- Secrets aus Beispieldateien

### ✅ IMMER:
- Kryptographisch sichere Zufallswerte verwenden
- Mindestens 64 Bytes Entropie (z.B. `openssl rand -base64 64`)
- Secret niemals in Git committen
- Bei Kompromittierung sofort neues Secret generieren

## 🔄 Secret-Rotation

Wenn du das JWT_SECRET ändern musst:

### Option 1: Automatische Neu-Generierung
1. Lösche die `JWT_SECRET` Zeile aus `.env` (oder setze auf leeren Wert)
2. Starte Server neu: `npm run dev`
3. Neues Secret wird automatisch generiert

### Option 2: Manuell eigenes Secret setzen
1. Generiere eigenes Secret:
   ```bash
   openssl rand -base64 64
   ```
2. Aktualisiere `JWT_SECRET=` in `.env`
3. Starte Server neu: `npm run dev`

**Wichtig**: Alle Benutzer werden automatisch ausgeloggt - dies ist gewollt!
- Alte Sessions sind ungültig
- Benutzer müssen sich neu einloggen

## 🛡️ Was wurde behoben

| Problem | Status | Lösung |
|---------|--------|--------|
| Unsicherer Default-Wert | ✅ Behoben | Automatische Generierung bei Start |
| Schwache Secrets | ✅ Behoben | 64 Bytes kryptographisch sicher |
| Manuelle Konfiguration | ✅ Behoben | Vollautomatisch beim ersten Start |
| Session-Invalidierung | ✅ Behoben | Automatisch bei Secret-Änderung |

## 🔍 Technische Details

### Auto-Generierung beim Start
Der Server prüft beim Start:
1. Existiert `.env` Datei? (Wenn nein, wird erstellt)
2. Existiert `JWT_SECRET`? (Wenn nein, wird generiert)
3. Ist Secret stark genug (≥32 Zeichen)? (Wenn nein, wird neu generiert)
4. Enthält Secret unsichere Muster? (Wenn ja, wird neu generiert)

### Edge Runtime Kompatibilität
Die Implementierung ist vollständig kompatibel mit Next.js Edge Runtime (Middleware):

**Architektur:**
```
src/lib/
├── auth-edge.ts    # Edge Runtime (Middleware)
│   └── decrypt()   # Nur jose (Edge-kompatibel)
│
└── auth.ts         # Node.js Runtime (API Routes)
    ├── encrypt()
    ├── decrypt()
    ├── getSession()
    ├── hashPassword()     # bcrypt (lazy loaded)
    └── verifyPassword()   # bcrypt (lazy loaded)
```

**Middleware verwendet auth-edge.ts:**
```typescript
// ✅ RICHTIG: Edge-kompatible Version
import { decrypt } from '@/lib/auth-edge'

// ❌ FALSCH: Node.js Version (würde crashen)
import { decrypt } from '@/lib/auth'
```

**API Routes verwenden auth.ts:**
```typescript
// ✅ RICHTIG: Volle Funktionalität mit bcrypt
import { encrypt, hashPassword, verifyPassword } from '@/lib/auth'
```

**Lazy Loading in auth.ts:**
```typescript
// ✅ RICHTIG: bcrypt wird nur geladen wenn benötigt
let bcrypt: any = null
function getBcrypt() {
    if (!bcrypt) {
        bcrypt = require('bcryptjs')
    }
    return bcrypt
}

// ❌ FALSCH: Top-level import würde Edge runtime brechen
import bcrypt from 'bcryptjs'
```

### Secret-Generierung
```javascript
// 64 Bytes = 512 Bits Entropie
const newSecret = crypto.randomBytes(64).toString('base64')
// Ergebnis: ~88 Zeichen base64-kodiert
```

### .env Update-Logik
```javascript
// Wenn JWT_SECRET bereits in .env existiert:
JWT_SECRET=alter_wert  →  JWT_SECRET=neuer_sicherer_wert

// Wenn nicht vorhanden, wird hinzugefügt:
# Auto-generated JWT Secret (2025-12-04T...)
JWT_SECRET=neuer_sicherer_wert
```

### Secret-Version-Tracking
```javascript
// In beiden Dateien
const SECRET_VERSION = Buffer.from(SECRET_KEY).toString('base64').slice(0, 8)
```

Dieser Hash wird in jeden JWT eingebettet:
```javascript
// In auth.ts encrypt()
return await new SignJWT({
    ...payload,
    secretVersion: SECRET_VERSION
})
```

Und bei der Verifizierung geprüft:
```javascript
// In beiden verifySession()/decrypt()
if (payload.secretVersion !== SECRET_VERSION) {
    console.warn('Session invalidated: JWT_SECRET has changed')
    return null
}
```

## ✅ Test der Implementierung

```bash
# Test 1: Erster Start ohne .env
rm .env  # Falls vorhanden
npm run dev
# Erwartete Ausgabe:
# 🔐 Generating new JWT_SECRET...
# ✅ JWT_SECRET generated and saved to .env
# 🔒 Secret length: 88 characters

# Test 2: Mit bestehendem sicheren Secret
npm run dev
# Erwartete Ausgabe:
# ✓ JWT_SECRET validated successfully

# Test 3: Mit schwachem Secret
echo "JWT_SECRET=weak" > .env
npm run dev
# Erwartete Ausgabe:
# 🔐 Generating new JWT_SECRET...
# ✅ JWT_SECRET generated and saved to .env

# Test 4: Mit unsicherem Muster
echo "JWT_SECRET=change-me-please-12345" > .env
npm run dev
# Erwartete Ausgabe:
# ⚠️  JWT_SECRET contains insecure pattern "change-me" - generating new secure secret
# 🔐 Generating new JWT_SECRET...
```

## 📝 Für Production Deployment

### Wichtig für Production:
Das automatische JWT_SECRET funktioniert auch in Production, **aber**:

**Best Practice**: Setze `JWT_SECRET` explizit in deinem Deployment-System
- Verhindert Secret-Änderung bei Server-Neustarts
- Konsistent über mehrere Instanzen hinweg
- Bessere Kontrolle über Secret-Rotation

### Beispiel für verschiedene Plattformen:

**Vercel/Netlify/Railway:**
```bash
# In den Environment Variables setzen
JWT_SECRET=<generiertes-secret-aus-openssl>
```

**Docker:**
```dockerfile
ENV JWT_SECRET=<generiertes-secret>
```

**Docker Compose:**
```yaml
environment:
  - JWT_SECRET=${JWT_SECRET}
```

Generiere das Production-Secret einmalig:
```bash
openssl rand -base64 64
```

## 🔒 Sicherheitshinweise

### ✅ Gut:
- Automatische Generierung in Development
- Secrets werden sicher in `.env` gespeichert (ist in `.gitignore`)
- Alte Sessions werden bei Änderung ungültig
- Edge Runtime kompatibel (Middleware funktioniert)

### ⚠️ Wichtig:
- **Niemals** `.env` in Git committen
- In Production: Secret explizit setzen, nicht auto-generieren lassen
- Bei Secret-Kompromittierung: Sofort rotieren (alte Sessions werden ungültig)
- Backups von `.env` sicher verwahren

## 🐛 Troubleshooting

### "The edge runtime does not support Node.js 'path' module"
**Problem**: Middleware verwendet Node.js Module die in Edge Runtime nicht verfügbar sind.

**Lösung**: ✅ Bereits behoben durch:
- Separate `auth-edge.ts` für Edge Runtime
- `auth.ts` nur für Node.js API Routes
- Middleware importiert von `auth-edge.ts`
- Lazy loading von bcrypt in `auth.ts`

### "A Node.js module is loaded ('crypto') which is not supported"
**Problem**: bcryptjs verwendet intern Node.js crypto Modul.

**Lösung**: ✅ Bereits behoben:
- bcrypt wird nur in `auth.ts` verwendet (Node.js Runtime)
- `auth-edge.ts` verwendet nur `jose` (Edge-kompatibel)
- Lazy loading verhindert Import zur Build-Zeit

### Testen der Edge Runtime Kompatibilität
```bash
cd server
node test-jwt-generation.js
```

Erwartete Ausgabe:
```
✅ Test 2: auth-edge.ts is Edge runtime safe (no Node.js modules)
✅ Test 3: Uses jose (Edge runtime compatible)
✅ Test 4: auth.ts uses lazy loading for bcrypt
✅ Test 5: auth.ts lazy loads bcrypt with require()
✅ Test 6: middleware.ts imports from auth-edge (correct)
```

### Build-Test
```bash
npm run build
```

Sollte **keine** Edge Runtime Fehler mehr zeigen:
- ✅ Keine "node-module-in-edge-runtime" Fehler
- ✅ Keine "Node.js API is used" Fehler für process.cwd, setImmediate, etc.

