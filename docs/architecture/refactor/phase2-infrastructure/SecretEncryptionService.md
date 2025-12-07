# Secret Encryption Service - Sichere Verwaltung von Agent-Secrets

**Datum**: 6. Dezember 2025  
**Status**: ✅ Implementiert & Produktiv  
**ISO 27001**: A.10.1.1, A.10.1.2, A.14.2.1  
**Sicherheitsstufe**: CRITICAL

---

## Übersicht

Der `SecretEncryptionService` verschlüsselt Agent-Secrets sicher in der Datenbank, sodass HMAC-Operationen für Terminal-Befehle möglich sind, ohne Secrets im Klartext zu speichern.

### Problem

**Vorher (UNSICHER):**
- Agent-Secrets wurden als **Plain-Text** in der Datenbank gespeichert
- Notwendig für HMAC-Signierung von Terminal-Eingaben
- Sicherheitsrisiko: Datenbankzugriff = alle Secrets kompromittiert

**Jetzt (SICHER):**
- Secrets werden mit **AES-256-GCM** verschlüsselt gespeichert
- Master-Key ist `JWT_SECRET` aus `.env`
- Entschlüsselung nur im Arbeitsspeicher für HMAC-Operationen
- Auth-Tag verhindert Manipulation

---

## Architektur

```
┌─────────────────────────────────────────────────────────────┐
│                    Encryption Workflow                       │
└─────────────────────────────────────────────────────────────┘

Agent Registration:
  Agent → SecretKey (plain) → AgentConnectionManager
                              ↓
                        SecretEncryptionService
                              ↓ encrypt()
                        iv:authTag:ciphertext
                              ↓
                        Database (Machine.secretKey)

Terminal Command (HMAC):
  WebClient → terminal_input → WebClientConnectionManager
                               ↓
                          Load encrypted secret from DB
                               ↓
                          SecretEncryptionService.decrypt()
                               ↓
                          Plain secret (in RAM only)
                               ↓
                          HMAC creation
                               ↓
                          Send to Agent
```

---

## Verschlüsselungs-Algorithmus

### AES-256-GCM (Galois/Counter Mode)

**Eigenschaften:**
- **Schlüssellänge**: 256 Bit (32 Bytes)
- **IV-Länge**: 128 Bit (16 Bytes) - **zufällig pro Verschlüsselung**
- **Auth-Tag**: 128 Bit (16 Bytes) - verhindert Manipulation
- **Authenticated Encryption**: Vertraulichkeit + Integrität

**Format des verschlüsselten Werts:**
```
iv:authTag:ciphertext
```

Beispiel:
```
a3f2e1d4c5b6a7980123456789abcdef:b9c8d7e6f5a4938271605948372615a2:e4f3a2b1c0d98765
```

### Master-Key Ableitung

```typescript
masterKey = SHA-256(JWT_SECRET)
// Ergibt immer 32 Bytes (256 Bit) für AES-256
```

---

## API-Referenz

### Constructor

```typescript
constructor(jwtSecret: string)
```

**Parameter:**
- `jwtSecret`: Master-Key aus `.env` (`JWT_SECRET`)

**Beispiel:**
```typescript
const encryptionService = new SecretEncryptionService(process.env.JWT_SECRET!)
```

---

### `encrypt(plaintext: string): string`

Verschlüsselt ein Secret.

**Parameter:**
- `plaintext`: Klartext-Secret (z.B. Agent-Secret-Key)

**Rückgabe:**
- Verschlüsselter String im Format `iv:authTag:ciphertext`

**Beispiel:**
```typescript
const plainSecret = 'f9df1234...c74b' // 64 Hex-Zeichen
const encrypted = encryptionService.encrypt(plainSecret)
// → "a3f2e1d4...98765:b9c8d7e6...15a2:e4f3a2b1...d98765"
```

**Eigenschaften:**
- ✅ Gleicher Klartext → unterschiedliche Ciphertexte (Random IV)
- ✅ Deterministisch dekodierbar
- ✅ Manipulation erkennbar (Auth-Tag)

---

### `decrypt(encrypted: string): string`

Entschlüsselt ein Secret.

**Parameter:**
- `encrypted`: Verschlüsselter String (Format: `iv:authTag:ciphertext`)

**Rückgabe:**
- Original-Klartext

**Exceptions:**
- `Error('Invalid encrypted format')` - Format nicht korrekt
- `Error('Decryption failed')` - Auth-Tag ungültig oder falscher Master-Key

**Beispiel:**
```typescript
try {
  const plain = encryptionService.decrypt(encryptedSecret)
  // Verwende plain nur im RAM, nie speichern!
} catch (error) {
  logger.error('Decryption failed', { error })
  // Secret ist kompromittiert oder falscher Master-Key
}
```

---

### `isEncrypted(value: string): boolean`

Prüft, ob ein Wert im verschlüsselten Format vorliegt.

**Parameter:**
- `value`: Zu prüfender String

**Rückgabe:**
- `true` wenn Format `hex:hex:hex` erkannt wird
- `false` sonst

**Beispiel:**
```typescript
const encrypted = 'a3f2...98765:b9c8...15a2:e4f3...d98765'
const plain = 'my-plain-secret'

encryptionService.isEncrypted(encrypted) // → true
encryptionService.isEncrypted(plain)     // → false
```

---

## Verwendung im System

### 1. Agent-Registrierung (AgentConnectionManager)

```typescript
import { SecretEncryptionService } from '../infrastructure/crypto/SecretEncryptionService'

class AgentConnectionManager {
  private secretEncryption: SecretEncryptionService

  constructor(..., jwtSecret: string) {
    this.secretEncryption = new SecretEncryptionService(jwtSecret)
  }

  private async handleAgentRegistration(data: any, ws: WebSocket) {
    // Agent sendet Plain-Secret
    const plainSecret = data.secretKey
    
    // Verschlüsseln für DB-Speicherung
    const encryptedSecret = this.secretEncryption.encrypt(plainSecret)
    
    // In DB speichern
    await this.prisma.machine.create({
      data: {
        secretKey: encryptedSecret,      // ← verschlüsselt!
        secretKeyHash: hashSecretKey(plainSecret) // ← für Auth
      }
    })
  }
}
```

---

### 2. Terminal-HMAC (WebClientConnectionManager)

```typescript
import { SecretEncryptionService } from '../infrastructure/crypto/SecretEncryptionService'

class WebClientConnectionManager {
  private secretEncryption: SecretEncryptionService

  private async handleTerminalInput(data: any) {
    // 1. Lade verschlüsseltes Secret aus DB
    const machine = await this.prisma.machine.findUnique({
      where: { id: machineId },
      select: { secretKey: true }
    })
    
    // 2. Entschlüsseln (nur im RAM!)
    const plainSecret = this.secretEncryption.decrypt(machine.secretKey)
    
    // 3. HMAC mit Plain-Secret erstellen
    const secureMessage = await this.terminalService.createSecureMessage(
      sessionToken,
      'terminal_input',
      { data: input },
      plainSecret  // ← nur im RAM, nie speichern!
    )
    
    // 4. An Agent senden
    agentWs.send(JSON.stringify({
      type: 'terminal_stdin',
      data: secureMessage.data
    }))
  }
}
```

---

### 3. Server-Initialisierung (server.ts)

```typescript
import { SecretEncryptionService } from './infrastructure/crypto/SecretEncryptionService'

// JWT_SECRET aus .env laden
const jwtSecretValue = await secretProvider()

// AgentConnectionManager mit JWT_SECRET initialisieren
const agentManager = new AgentConnectionManager(
  prisma,
  registry,
  broadcast,
  logger,
  terminalService,
  jwtSecretValue  // ← Für SecretEncryptionService
)
```

---

## Sicherheitsanforderungen

### ✅ ERFORDERLICH (MANDATORY)

1. **JWT_SECRET muss sicher sein**
   ```bash
   # Mindestens 32 Zeichen, kryptografisch zufällig
   JWT_SECRET=$(openssl rand -hex 32)
   ```

2. **JWT_SECRET darf NIEMALS geändert werden**
   - Alle Secrets werden damit verschlüsselt
   - Änderung = alle Agents müssen neu registriert werden
   - Backup von `.env` erforderlich!

3. **JWT_SECRET nur in `.env` speichern**
   ```bash
   # ✅ RICHTIG
   JWT_SECRET=f9df1234...c74b
   
   # ❌ FALSCH - nie hardcoden!
   const secret = 'my-secret'
   ```

4. **Entschlüsseltes Secret nie loggen**
   ```typescript
   // ❌ FALSCH
   console.log('Secret:', plainSecret)
   
   // ✅ RICHTIG
   logger.debug('Secret decrypted successfully')
   ```

5. **Entschlüsseltes Secret nie in DB speichern**
   ```typescript
   // ❌ FALSCH
   await prisma.machine.update({
     data: { plainSecret }
   })
   
   // ✅ RICHTIG
   const encrypted = encryptionService.encrypt(plainSecret)
   await prisma.machine.update({
     data: { secretKey: encrypted }
   })
   ```

---

### 🔒 Best Practices

1. **Secret nur im RAM halten**
   ```typescript
   const plain = encryptionService.decrypt(encrypted)
   // Verwenden
   await createHMAC(plain)
   // Nicht mehr speichern, wird automatisch freigegeben
   ```

2. **Try-Catch für Decryption**
   ```typescript
   try {
     const plain = encryptionService.decrypt(encrypted)
     return plain
   } catch (error) {
     logger.error('Decryption failed', { machineId, error })
     throw new Error('Invalid or tampered secret')
   }
   ```

3. **Migration bestehender Daten**
   ```typescript
   // Beim Server-Start: Prüfen und migrieren
   const machines = await prisma.machine.findMany()
   
   for (const machine of machines) {
     if (!encryptionService.isEncrypted(machine.secretKey)) {
       // Plain Secret → verschlüsseln
       const encrypted = encryptionService.encrypt(machine.secretKey)
       await prisma.machine.update({
         where: { id: machine.id },
         data: { secretKey: encrypted }
       })
     }
   }
   ```

4. **Backup-Strategie**
   ```bash
   # .env regelmäßig sichern
   cp .env .env.backup-$(date +%Y%m%d)
   
   # Verschlüsselt aufbewahren
   gpg -c .env.backup-20251206
   ```

---

## Fehlerbehandlung

### Decryption Error

**Ursachen:**
1. **Falscher Master-Key** (`JWT_SECRET` geändert)
2. **Korrupte Daten** (DB-Manipulation)
3. **Format-Fehler** (kein `iv:authTag:ciphertext`)

**Lösung:**
```typescript
try {
  const plain = encryptionService.decrypt(encrypted)
} catch (error) {
  if (error.message.includes('Invalid encrypted format')) {
    // Format-Problem → Secret ist plain text?
    if (!encryptionService.isEncrypted(encrypted)) {
      logger.warn('Secret is not encrypted, migrating...')
      const reencrypted = encryptionService.encrypt(encrypted)
      await updateSecret(reencrypted)
    }
  } else {
    // Decryption-Fehler → Master-Key falsch oder Daten korrupt
    logger.error('Cannot decrypt secret', { error })
    throw new Error('Secret decryption failed - check JWT_SECRET')
  }
}
```

---

### JWT_SECRET verloren

**Problem:**
- Alle verschlüsselten Secrets sind unbrauchbar
- Keine Wiederherstellung möglich

**Lösung:**
1. Alle Agents müssen neu registriert werden
2. Neues `JWT_SECRET` generieren
3. DB-Feld `Machine.secretKey` bei allen Maschinen leeren
4. Agents über Web-UI mit `curl ... | sudo bash` neu installieren

**Vorbeugung:**
```bash
# Regelmäßige Backups
cp .env ~/.env-backups/env-$(date +%Y%m%d)

# Verschlüsselt speichern
gpg -c ~/.env-backups/env-$(date +%Y%m%d)
```

---

## Testing

### Unit Tests

Siehe: `src/infrastructure/crypto/__tests__/SecretEncryptionService.test.ts`

**Test-Coverage:**
- ✅ Encryption/Decryption Roundtrip
- ✅ Random IV (gleicher Input → unterschiedlicher Output)
- ✅ Format-Validierung (`iv:authTag:ciphertext`)
- ✅ Auth-Tag Manipulation-Erkennung
- ✅ Falscher Master-Key Detection
- ✅ Error-Handling

**Tests ausführen:**
```bash
cd server
npm test -- SecretEncryptionService
```

---

## ISO 27001 Compliance

### A.10.1.1 - Kryptografische Maßnahmen

✅ **Erfüllt:**
- AES-256-GCM Verschlüsselung (NIST-Standard)
- Sichere Schlüsselableitung (SHA-256)
- Random IV pro Encryption
- Authenticated Encryption (Integrität + Vertraulichkeit)

### A.10.1.2 - Schlüsselverwaltung

✅ **Erfüllt:**
- Master-Key in `.env` (nicht im Code)
- Schlüssel-Rotation möglich (mit Agent-Neuregistrierung)
- Zugriffskontrolle auf `.env` (File Permissions)
- Backup-Strategie dokumentiert

### A.14.2.1 - Sichere Datenverarbeitung

✅ **Erfüllt:**
- Secrets nur verschlüsselt in DB
- Entschlüsselung nur zur Laufzeit im RAM
- Keine Logs mit entschlüsselten Secrets
- Try-Catch für alle Decryption-Operationen

---

## Migration von Plain zu Encrypted

Bei bestehendem System mit Plain-Secrets:

```typescript
// server/src/migrations/encrypt-secrets.ts
import { PrismaClient } from '@prisma/client'
import { SecretEncryptionService } from '../infrastructure/crypto/SecretEncryptionService'

async function migrateSecrets() {
  const prisma = new PrismaClient()
  const encryption = new SecretEncryptionService(process.env.JWT_SECRET!)
  
  const machines = await prisma.machine.findMany({
    where: {
      secretKey: { not: null }
    }
  })
  
  let migrated = 0
  
  for (const machine of machines) {
    if (!encryption.isEncrypted(machine.secretKey!)) {
      console.log(`Migrating machine ${machine.hostname} (${machine.id})`)
      
      const encrypted = encryption.encrypt(machine.secretKey!)
      
      await prisma.machine.update({
        where: { id: machine.id },
        data: { secretKey: encrypted }
      })
      
      migrated++
    }
  }
  
  console.log(`✅ Migrated ${migrated} secrets to encrypted format`)
  await prisma.$disconnect()
}

migrateSecrets().catch(console.error)
```

**Ausführen:**
```bash
cd server
npx tsx src/migrations/encrypt-secrets.ts
```

---

## Zusammenfassung

### Was macht der Service?

- ✅ Verschlüsselt Agent-Secrets mit AES-256-GCM
- ✅ Verwendet `JWT_SECRET` als Master-Key
- ✅ Speichert nur verschlüsselte Secrets in DB
- ✅ Entschlüsselt zur Laufzeit für HMAC-Operationen
- ✅ Verhindert Manipulation durch Auth-Tag

### Warum ist das sicher?

- 🔒 Kein Plain-Text in DB (nur verschlüsselt)
- 🔒 Master-Key in `.env` (nie im Code)
- 🔒 Random IV (keine Muster erkennbar)
- 🔒 Auth-Tag (Manipulation erkennbar)
- 🔒 AES-256-GCM (NIST-Standard)

### Was muss ich beachten?

- ⚠️ `JWT_SECRET` niemals ändern (außer bei geplanter Migration)
- ⚠️ `.env` regelmäßig sichern
- ⚠️ Entschlüsseltes Secret nie loggen oder speichern
- ⚠️ Try-Catch um alle Decrypt-Operationen

---

**Autor**: GitHub Copilot  
**Reviewed**: System Architect  
**Version**: 1.0.0  
**Letzte Änderung**: 6. Dezember 2025
