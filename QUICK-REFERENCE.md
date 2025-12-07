# 🚀 Quick Reference: SecureRemoteTerminalService

## Installation (2 Minuten)

```bash
cd server

# 1. Install dependencies
npm install

# 2. Generate secret
export SESSION_TOKEN_SECRET=$(openssl rand -hex 32)
echo "SESSION_TOKEN_SECRET=$SESSION_TOKEN_SECRET" >> .env

# 3. Run migration
npx prisma migrate dev --name add_secure_terminal_integration

# 4. Test & Build
npm test
npm run build

# 5. Start
npm run dev
```

---

## API Quick Reference

### Server-Side Usage

```typescript
// Initialize (done in server.ts)
const terminalService = new SecureRemoteTerminalService(prisma, logger)

// Issue token on spawn
const token = await terminalService.issueSessionToken(userId, machineId)
// Returns: { sessionId, signature, expiresAt, capabilities, ... }

// Wrap message with HMAC
const message = await terminalService.createSecureMessage(
  token,
  'terminal_input',
  { data: 'ls -la' },
  machine.secretKeyHash
)
// Returns: { type, sessionToken, data: { nonce, timestamp, hmac } }

// Enforce rate limiting
const allowed = await terminalService.enforceRateLimit(sessionId)
// Returns: true/false

// End session on disconnect
await terminalService.endSession(sessionId)
```

### Agent-Side Usage

```typescript
// Validate message
const validation = await terminalService.validateSecureMessage(
  message,
  machineId,
  machine.secretKeyHash
)
// Returns: { valid: true/false, reason: string }

// Access session info (admin)
const sessions = await terminalService.getActiveSessions(userId)
const info = await terminalService.getRateLimitInfo(sessionId)
```

---

## Environment Variables

```env
# REQUIRED
SESSION_TOKEN_SECRET=<32-byte hex from openssl rand -hex 32>

# OPTIONAL (defaults shown)
SESSION_EXPIRY_SECONDS=300              # 5 minutes
RATE_LIMIT_TOKENS_PER_SEC=100           # 100 msg/sec
RATE_LIMIT_BURST_TOKENS=20              # 20 token burst
CLOCK_SKEW_TOLERANCE_SECONDS=60         # ±60 second window
NONCE_HISTORY_LIMIT=10000               # Max nonces per machine
```

---

## Integration Points

### WebClientConnectionManager
```typescript
// Import
import { SecureRemoteTerminalService } from '../domain/services/SecureRemoteTerminalService'

// Constructor
constructor(
  ...,
  private readonly terminalService: SecureRemoteTerminalService
) {}

// In handleSpawnTerminal
const token = await this.terminalService.issueSessionToken(userId, machineId)

// In handleTerminalInput
const allowed = await this.terminalService.enforceRateLimit(sessionId)
const message = await this.terminalService.createSecureMessage(token, 'terminal_input', payload, secret)

// In cleanupUserSessions
await this.terminalService.endSession(sessionId)
```

### AgentConnectionManager
```typescript
// In handleTerminalOutput
const validation = await this.terminalService.validateSecureMessage(
  message,
  machineId,
  machine.secretKeyHash
)
if (!validation.valid) return // Ignore invalid messages
```

---

## Security Features at a Glance

| Feature | Implementation | Status |
|---------|-----------------|--------|
| Session Tokens | HMAC-SHA256 signed | ✅ |
| Message Integrity | HMAC-SHA256 on payload | ✅ |
| Replay Protection | Nonce + timestamp | ✅ |
| Rate Limiting | Token bucket (100/sec) | ✅ |
| Timing Attacks | crypto.timingSafeEqual | ✅ |
| Audit Trail | Session lifecycle logging | ✅ |
| Key Management | Environment variable | ✅ |
| Session Expiry | 5 minutes auto-refresh | ✅ |

---

## Testing

```bash
# Unit tests for service
npm test -- SecureRemoteTerminalService

# Integration tests
npm test -- integration-terminal

# All tests
npm test

# Watch mode
npm test:watch
```

---

## Troubleshooting

### "SESSION_TOKEN_SECRET environment variable is required"
```bash
# Fix
openssl rand -hex 32
# Add to .env: SESSION_TOKEN_SECRET=<output>
```

### "Prisma schema validation failed"
```bash
# Fix: Run migration
npx prisma migrate dev

# Regenerate
npx prisma generate
```

### "Terminal input not working"
1. Check rate limit: `await terminalService.getRateLimitInfo(sessionId)`
2. Verify session: `await terminalService.getSessionToken(sessionId)`
3. Check HMAC: Look for "HmacValidationFailed" in logs

### "HMAC verification failed"
1. Verify machine.secretKeyHash exists in DB
2. Check both sides using same secret
3. Ensure nonce is unique per message (replay detected = 2 identical nonces)

---

## File Locations

```
server/
├── src/
│   ├── server.ts                    ← Service initialization
│   ├── connection/
│   │   ├── WebClientConnectionManager.ts   ← Client-side security
│   │   ├── AgentConnectionManager.ts       ← Agent-side validation
│   │   └── __tests__/
│   │       └── integration-terminal.test.ts ← Integration tests
│   └── domain/
│       └── services/
│           ├── SecureRemoteTerminalService.ts      ← Core service
│           └── __tests__/
│               └── SecureRemoteTerminalService.test.ts ← Unit tests
├── prisma/
│   └── schema.prisma               ← Database schema (extended)
├── .env.example                    ← Configuration template
└── package.json                    ← Dependencies
```

---

## Data Flow Summary

```
Browser: spawn_terminal
    ↓ (WebClientConnectionManager)
    ├→ issueSessionToken() → SessionToken with HMAC
    └→ Send to Agent with token
       ↓ (Agent creates terminal)
       
Browser: terminal_input "ls"
    ↓ (WebClientConnectionManager)
    ├→ enforceRateLimit() → Check quota
    ├→ createSecureMessage() → Wrap with HMAC + nonce + timestamp
    └→ Send to Agent
       ↓ (AgentConnectionManager)
       ├→ validateSecureMessage() → Verify HMAC, nonce, timestamp
       └→ Execute if valid
          ↓ (Terminal executes)
          
Agent: terminal_output
    ↓ (AgentConnectionManager)
    ├→ validateSecureMessage() → Verify integrity
    ├→ normalizeOutput()
    └→ broadcast() to all clients
       ↓
Browser: Displays output
```

---

## Monitoring & Debugging

### Check active sessions
```typescript
const sessions = await terminalService.getActiveSessions(userId)
console.log(`Active sessions for ${userId}:`, sessions.length)
```

### Check rate limit status
```typescript
const info = await terminalService.getRateLimitInfo(sessionId)
console.log(`Tokens available: ${info?.tokensAvailable}`)
```

### Check audit logs
```bash
# In Prisma Studio
npx prisma studio

# Query AuditLog table
SELECT * FROM AuditLog 
WHERE machineId = '<id>' 
AND eventType LIKE 'SESSION%'
ORDER BY createdAt DESC
LIMIT 10
```

### Enable verbose logging
```typescript
// In logger configuration
logger.debug('AuditEvent', { ... })
logger.info('SessionTokenIssued', { ... })
logger.warn('RateLimitExceeded', { ... })
```

---

## Common Operations

### Create new session
```typescript
const token = await terminalService.issueSessionToken(userId, machineId)
// Store sessionId in frontend for use in subsequent operations
```

### Send secure terminal input
```typescript
const message = await terminalService.createSecureMessage(
  sessionToken,
  'terminal_input',
  { data: 'whoami' },
  machine.secretKeyHash
)
agent.send(JSON.stringify({ type: 'terminal_stdin', data: message }))
```

### Validate incoming message
```typescript
const result = await terminalService.validateSecureMessage(
  receivedMessage,
  machineId,
  machine.secretKeyHash
)
if (!result.valid) {
  logger.warn('Invalid message', { reason: result.reason })
  return // Ignore
}
// Process message...
```

### Cleanup on disconnect
```typescript
ws.on('close', async () => {
  for (const sessionId of userSessions) {
    await terminalService.endSession(sessionId)
  }
})
```

---

## Performance Tuning

### Increase rate limit for bursty traffic
```env
RATE_LIMIT_TOKENS_PER_SEC=200
RATE_LIMIT_BURST_TOKENS=50
```

### Decrease clock skew for stricter security
```env
CLOCK_SKEW_TOLERANCE_SECONDS=30
```

### Increase session lifetime for long operations
```env
SESSION_EXPIRY_SECONDS=600  # 10 minutes
```

### Reduce nonce history for memory conservation
```env
NONCE_HISTORY_LIMIT=5000
```

---

## Production Checklist

- [ ] SESSION_TOKEN_SECRET generated with openssl
- [ ] .env configured with strong secret
- [ ] Prisma migration run successfully
- [ ] npm test passes all tests
- [ ] npm run build succeeds
- [ ] WSS/TLS configured for production
- [ ] Firewall allows /ws/agent and /ws/web paths
- [ ] Monitoring/logging configured
- [ ] Backup of database before migration
- [ ] Test end-to-end workflow in staging

---

**Last Updated:** 2025-12-06  
**Version:** 1.0.0  
**Status:** ✅ Production Ready  
