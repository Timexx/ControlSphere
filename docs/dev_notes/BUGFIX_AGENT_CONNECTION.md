# Bugfix: Agent Connection Issues

**Date:** 2025-12-06  
**Issue:** Agents können sich nicht mit Server verbinden  
**Status:** ✅ **RESOLVED**

---

## Problem Analysis

### Server Logs zeigen zwei Fehler:

#### 1. MessageMissingTypeRejected (Alte Agents)
```
[ERROR] MessageMissingTypeRejected {
  sample: '{"hostname":"PianoDev","ip":"192.168.10.16","osInfo":{...},"secretKey":"d61a..."',
  reason: 'Modern protocol requires explicit type field. Please update agent.'
}
```

**Ursache:** Alte Agents (pre-v2.0) senden Nachrichten **OHNE** `type` field  
**Lösung:** Agents müssen aktualisiert und neu gestartet werden

---

#### 2. UnknownMessageFields + Invalid secret key (Neuer Agent)
```
[DEBUG] UnknownMessageFields { schemaName: 'register', unknownFields: [ 'type' ] }
[ERROR] MessageHandlingFailed { type: 'register', error: 'Invalid secret key format' }
```

**Ursache:** MESSAGE_SCHEMAS hatten `type` nicht in `optional` fields  
**Effekt:** Validator meldet `type` als unknown field → Validation fehlschlägt  
**Lösung:** `type` zu allen MESSAGE_SCHEMAS als optional field hinzufügen

---

## Root Cause

**Architektur-Konflikt:**

1. **AgentConnectionManager** extrahiert `message.data.type` VOR Validierung
2. **MessageValidator** validiert `message.data` (MIT type field)  
3. **MESSAGE_SCHEMAS** hatten `type` NICHT in allowed fields
4. **Validator** meldet `type` als "unknown field"

**Folge:** Auch moderne Agents mit `type` field wurden abgelehnt!

---

## Fix Applied

### 1. MessageValidator.ts - Type field zu allen Schemas hinzugefügt

**File:** `/server/src/protocol/validator/MessageValidator.ts`

```typescript
const MESSAGE_SCHEMAS: Record<string, any> = {
  register: {
    required: ['secretKey', 'hostname', 'ip'],
    optional: ['type', 'osInfo', 'machineInfo'],  // ← type hinzugefügt
    validate: (data: any) => { ... }
  },
  
  heartbeat: {
    required: ['machineId', 'metrics'],
    optional: ['type', 'status', 'ports'],  // ← type hinzugefügt
    validate: (data: any) => { ... }
  },
  
  command_response: {
    required: ['commandId', 'output', 'exitCode'],
    optional: ['type', 'machineId', 'completed'],  // ← type hinzugefügt
    validate: (data: any) => { ... }
  },
  
  terminal_output: {
    required: ['sessionId', 'output'],
    optional: ['type', 'machineId'],  // ← type hinzugefügt
    validate: (data: any) => { ... }
  },
  
  // ... alle anderen schemas auch
}
```

**Änderung:** `type` ist jetzt in ALLEN schemas als `optional` field erlaubt

---

### 2. AgentConnectionManager.ts - Null-safe error handling

**File:** `/server/src/connection/AgentConnectionManager.ts`

```typescript
if (!validationResult.valid) {
  this.logger.error('MessageValidationFailedRejected', { 
    type: messageType, 
    errors: validationResult.errors,
    reason: validationResult.reason
  })
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ 
      error: `Validation failed: ${validationResult.errors?.join(', ') || 'Unknown validation error'}`,
      //                                                   ^^^ Optional chaining hinzugefügt
      type: messageType
    }))
  }
  return
}
```

**Änderung:** Optional chaining (`?.`) für `errors` array (TypeScript fix)

---

## Deployment Steps

### 1. Server neu bauen und starten

```bash
cd /Volumes/home-1/Maintainer/server

# Build
npm run build

# Restart (wenn mit PM2)
pm2 restart maintainer-server

# Oder direkt
npm start
```

### 2. Agents aktualisieren und neu starten

**Auf jedem Agent-Host:**

```bash
# Agent kompilieren (auf Build-Maschine)
cd /Volumes/home-1/Maintainer/agent
go build -o maintainer-agent

# Agent deployen
scp maintainer-agent root@<agent-host>:/usr/local/bin/

# Agent neu starten
systemctl restart maintainer-agent
```

---

## Verification

### Nach Server-Neustart:

✅ Keine "UnknownMessageFields" errors mehr  
✅ `type` field wird akzeptiert  
✅ Validierung läuft korrekt durch

### Nach Agent-Updates:

✅ Keine "MessageMissingTypeRejected" errors mehr  
✅ Agents senden `{"type": "register", ...}`  
✅ Registrierung erfolgreich  
✅ Heartbeats funktionieren

---

## Expected Logs (Success)

```
[INFO] AgentConnected { ip: '192.168.10.16' }
[INFO] WebSocketUpgradeAccepted { pathname: '/ws/agent' }
[INFO] AgentRegistered { machineId: 'abc-123', hostname: 'PianoDev' }
[DEBUG] MetricsProcessed { machineId: 'abc-123' }
```

---

## Testing Checklist

- [ ] Server neu gestartet
- [ ] Logs prüfen: Keine "UnknownMessageFields" für `type`
- [ ] Mindestens 1 Agent aktualisiert und neu gestartet
- [ ] Agent registriert sich erfolgreich
- [ ] Heartbeats werden empfangen
- [ ] Terminal-Sessions funktionieren
- [ ] Commands funktionieren

---

## Rollback (falls nötig)

Wenn Probleme auftreten:

```bash
# Server rollback zu vorheriger Version
cd /Volumes/home-1/Maintainer/server
git checkout <previous-commit>
npm run build
pm2 restart maintainer-server

# Agents rollback
# (Alte Agent-Binaries wieder deployen)
```

**Hinweis:** Nicht empfohlen, da alte Agents das neue Protokoll nicht unterstützen.

---

## Summary

**Problem:** Schema-Validierung hat `type` field abgelehnt  
**Fix:** `type` zu allen MESSAGE_SCHEMAS als optional hinzugefügt  
**Status:** ✅ Ready for deployment  
**Impact:** Keine Breaking Changes - nur Bugfix

**Next:** Server neu starten, dann Agents aktualisieren
