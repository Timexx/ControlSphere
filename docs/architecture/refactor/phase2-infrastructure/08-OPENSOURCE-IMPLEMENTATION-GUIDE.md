# SecureRemoteTerminalService - OpenSource Implementation Guide

**Status:** Ready for OpenSource Community  
**License:** MIT (or your project license)  
**Date:** 2025-12-06  
**Compatibility:** Node.js 18+, TypeScript 5+  

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Architecture](#architecture)
3. [API Reference](#api-reference)
4. [Integration Examples](#integration-examples)
5. [Security Configuration](#security-configuration)
6. [Troubleshooting](#troubleshooting)
7. [Contributing](#contributing)

---

## Quick Start

### 1. Installation

Copy the service file to your project:

```bash
# Copy service
cp server/src/domain/services/SecureRemoteTerminalService.ts \
   your-project/src/services/

# Install dependencies (already in your package.json)
npm install uuid
```

### 2. Basic Setup

```typescript
import { SecureRemoteTerminalService } from './services/SecureRemoteTerminalService'
import { PrismaClient } from '@prisma/client'
import { createLogger } from './utils/logger'

const prisma = new PrismaClient()
const logger = createLogger('SecureTerminal')

// Initialize the service
const terminalService = new SecureRemoteTerminalService(prisma, logger)

export { terminalService }
```

### 3. Environment Configuration

**`.env`:**

```bash
# REQUIRED: Change this to a random 64-character hex string
SESSION_TOKEN_SECRET=$(openssl rand -hex 32)

# Optional: Tune these for your use case
SESSION_EXPIRY_SECONDS=300        # 5 minutes
RATE_LIMIT_TOKENS=100              # 100 messages per second
RATE_LIMIT_BURST=20                # Allow 20 extra in burst
CLOCK_SKEW_TOLERANCE=60            # 60 second clock tolerance
```

**Generate SECRET:**

```bash
openssl rand -hex 32
# Output: abc123def456...
# Set as SESSION_TOKEN_SECRET in .env
```

### 4. Minimal Example

```typescript
import { terminalService } from './services'

// On terminal spawn (web client → server)
async function spawnTerminal(userId: string, machineId: string) {
  try {
    // 1. Issue session token (includes ACL check)
    const token = await terminalService.issueSessionToken(
      userId,
      machineId,
      ['spawn', 'input', 'resize']
    )

    console.log('✅ Session token issued:', token.sessionId)
    console.log('⏱️  Expires in:', token.expiresAt - Math.floor(Date.now() / 1000), 'seconds')

    return token
  } catch (error) {
    console.error('❌ Failed to issue token:', error)
    throw error
  }
}

// On terminal input (web client → server → agent)
async function sendTerminalInput(sessionId: string, machineId: string, input: string, agentSecret: string) {
  // 1. Validate session token
  const token = terminalService.getSessionToken(sessionId)
  if (!token) {
    console.error('Session not found or expired')
    return
  }

  // 2. Check rate limit
  const allowed = await terminalService.enforceRateLimit(sessionId)
  if (!allowed) {
    console.warn('Rate limit exceeded - message dropped')
    return
  }

  // 3. Create secure message with HMAC
  const secureMessage = await terminalService.createSecureMessage(
    token,
    'terminal_input',
    { data: input },
    agentSecret  // Machine's secret key (or hash)
  )

  console.log('📤 Secure message ready to send to agent')
  console.log('   - HMAC:', secureMessage.data.hmac.substring(0, 16) + '...')
  console.log('   - Nonce:', secureMessage.data.nonce.substring(0, 16) + '...')
  console.log('   - Timestamp:', secureMessage.data.timestamp)

  return secureMessage
}

// On agent receiving message
async function validateTerminalInput(message: any, machineId: string, agentSecret: string) {
  const validation = await terminalService.validateSecureMessage(
    message,
    machineId,
    agentSecret
  )

  if (!validation.valid) {
    console.error('❌ Message validation failed:', validation.reason)
    return false
  }

  console.log('✅ Message validated successfully')
  console.log('   - No replay detected')
  console.log('   - HMAC verified')
  console.log('   - Timestamp within tolerance')

  return true
}

// On terminal close
async function closeTerminal(sessionId: string) {
  await terminalService.endSession(sessionId)
  console.log('✅ Session closed and logged')
}
```

---

## Architecture

### Service Hierarchy

```
Your Application
│
├─ Web Client (Browser)
│  └─ Needs: session token
│
├─ Server (Node.js)
│  ├─ SecureRemoteTerminalService
│  │  ├─ Issue tokens (with ACL)
│  │  ├─ Create secure messages (HMAC + nonce + timestamp)
│  │  ├─ Validate messages (replay protection)
│  │  ├─ Enforce rate limits
│  │  └─ Audit logging
│  │
│  ├─ Connection Layer
│  │  ├─ WebClientConnectionManager (spawn, input, resize)
│  │  └─ AgentConnectionManager (receive terminal output)
│  │
│  └─ Prisma / Database
│     └─ AuditLog table (for compliance)
│
└─ Agent (Linux/macOS)
   └─ Validates: HMAC, nonce, timestamp
```

### Data Flow

```
┌──────────────────┐
│  Web Client      │
│  (Browser)       │
└────────┬─────────┘
         │ 1. User opens terminal
         │ 2. Request: spawn_terminal
         ▼
┌──────────────────────────────────┐
│  WebClientConnectionManager      │
│  handleSpawnTerminal()           │
│  ├─ Validate user/machine access
│  ├─ Call: issueSessionToken()
│  ├─ Get: machine.secretKey
│  ├─ Call: createSecureMessage()
│  └─ Send: { HMAC, nonce, timestamp }
└────────┬───────────────────────────┘
         │ 3. Secure message (with HMAC)
         ▼
┌──────────────────────────────────┐
│  Agent (Linux/macOS)             │
│  Receive spawn_shell             │
│  ├─ Call: validateSecureMessage()
│  ├─ Verify HMAC (timing-safe)
│  ├─ Check: nonce not seen before
│  ├─ Check: timestamp in range
│  └─ Execute: spawn PTY shell
└────────┬───────────────────────────┘
         │ 4. Terminal ready
         ▼
┌──────────────────┐
│  User Types      │
│  "ls -la"        │
└────────┬─────────┘
         │ 5. terminal_input message
         ▼
┌──────────────────────────────────┐
│  WebClientConnectionManager      │
│  handleTerminalInput()           │
│  ├─ Get session token
│  ├─ enforceRateLimit() → true/false
│  ├─ createSecureMessage()
│  └─ Send to agent
└────────┬───────────────────────────┘
         │ 6. Secure message (new HMAC, nonce)
         ▼
┌──────────────────────────────────┐
│  Agent                           │
│  Validate + Execute              │
│  ├─ validateSecureMessage()      │
│  ├─ Check replay (different nonce)
│  └─ Send command to PTY
└────────┬───────────────────────────┘
         │ 7. Output from command
         ▼
┌──────────────────┐
│  Web Client      │
│  Displays output │
└──────────────────┘
```

---

## API Reference

### Core Methods

#### `issueSessionToken(userId, machineId, capabilities?)`

Issues a new session token for a user to access a machine.

**Parameters:**
- `userId` (string): User identifier (from JWT or auth system)
- `machineId` (string): Target machine ID
- `capabilities` (string[]): Optional. Default: `['spawn', 'input', 'resize']`

**Returns:**
- `SessionToken`: Token object with signature

**Throws:**
- `Error` if user has no access to machine

**Example:**

```typescript
try {
  const token = await terminalService.issueSessionToken('user123', 'machine456')
  console.log(`✅ Token issued: ${token.sessionId}`)
} catch (error) {
  console.error('❌ Token issue failed:', error)
}
```

---

#### `validateSessionToken(token)`

Validates a session token (checks expiry, signature, and auto-refreshes if needed).

**Parameters:**
- `token` (SessionToken): Token to validate

**Returns:**
- `boolean`: `true` if valid, `false` if expired/tampered

**Example:**

```typescript
const token = terminalService.getSessionToken(sessionId)
if (token) {
  const isValid = await terminalService.validateSessionToken(token)
  if (!isValid) {
    console.warn('Token is invalid or expired')
  }
}
```

---

#### `createSecureMessage(token, type, payload, agentSecret)`

Creates a secure message wrapper with HMAC, nonce, and timestamp.

**Parameters:**
- `token` (SessionToken): Session token (includes signature)
- `type` (string): Message type - `'terminal_input'`, `'terminal_resize'`, `'execute_command'`
- `payload` (any): Message payload
- `agentSecret` (string): Machine's secret key (used for HMAC)

**Returns:**
- `SecureMessage`: Message with HMAC, nonce, timestamp

**Example:**

```typescript
const message = await terminalService.createSecureMessage(
  token,
  'terminal_input',
  { data: 'ls -la' },
  machineSecret
)

// Send to agent
ws.send(JSON.stringify(message))
```

---

#### `validateSecureMessage(message, machineId, agentSecret)`

Validates a secure message (HMAC, nonce, timestamp, replay protection).

**Parameters:**
- `message` (SecureMessage): Message to validate
- `machineId` (string): Machine ID (for nonce tracking)
- `agentSecret` (string): Machine's secret key

**Returns:**
- `ValidationResult`: `{ valid: boolean, reason?: string }`

**Example:**

```typescript
const result = await terminalService.validateSecureMessage(
  incomingMessage,
  'machine456',
  machineSecret
)

if (!result.valid) {
  console.warn(`❌ Validation failed: ${result.reason}`)
  return
}

console.log('✅ Message is valid')
```

---

#### `enforceRateLimit(sessionId)`

Checks if a message is within rate limit (token bucket algorithm).

**Parameters:**
- `sessionId` (string): Session ID

**Returns:**
- `boolean`: `true` if message is allowed, `false` if rate limit exceeded

**Example:**

```typescript
const allowed = await terminalService.enforceRateLimit(sessionId)

if (!allowed) {
  console.warn('❌ Rate limit exceeded - dropping message')
  return
}

console.log('✅ Message allowed')
```

---

#### `endSession(sessionId)`

Closes a session and logs it (cleanup).

**Parameters:**
- `sessionId` (string): Session ID to close

**Returns:**
- `Promise<void>`

**Example:**

```typescript
ws.on('close', async () => {
  await terminalService.endSession(sessionId)
  console.log('✅ Session closed')
})
```

---

#### `getSessionToken(sessionId)`

Retrieves a session token from memory (no database lookup).

**Parameters:**
- `sessionId` (string): Session ID

**Returns:**
- `SessionToken | null`: Token if found, `null` otherwise

**Example:**

```typescript
const token = terminalService.getSessionToken(sessionId)
if (!token) {
  console.error('❌ Session not found or expired')
  return
}
```

---

#### `getActiveSessions()`

Returns all active sessions (for monitoring/admin).

**Returns:**
- `SessionToken[]`: Array of all active sessions

**Example:**

```typescript
const sessions = terminalService.getActiveSessions()
console.log(`📊 Active sessions: ${sessions.length}`)

for (const session of sessions) {
  const remaining = session.expiresAt - Math.floor(Date.now() / 1000)
  console.log(`  - ${session.userId} → ${session.machineId} (expires in ${remaining}s)`)
}
```

---

#### `getRateLimitInfo(sessionId)`

Gets rate limit bucket info (for monitoring).

**Parameters:**
- `sessionId` (string): Session ID

**Returns:**
- `RateLimitBucket | null`: Rate limit info or `null`

**Example:**

```typescript
const info = terminalService.getRateLimitInfo(sessionId)
if (info) {
  console.log(`📊 Rate limit - Available: ${info.tokensAvailable}/100`)
}
```

---

## Integration Examples

### Example 1: Express.js Integration

```typescript
import express from 'express'
import { terminalService } from './services'
import { authMiddleware } from './middleware/auth'

const app = express()

// Spawn terminal endpoint
app.post('/api/terminal/spawn', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.user
    const { machineId } = req.body

    // Issue session token
    const token = await terminalService.issueSessionToken(userId, machineId)

    res.json({
      sessionId: token.sessionId,
      expiresAt: token.expiresAt,
      capabilities: token.capabilities
    })
  } catch (error) {
    res.status(403).json({ error: (error as Error).message })
  }
})

// Get active sessions (admin endpoint)
app.get('/api/terminal/sessions', authMiddleware, async (req, res) => {
  const sessions = terminalService.getActiveSessions()
  res.json(sessions.map(s => ({
    sessionId: s.sessionId,
    userId: s.userId,
    machineId: s.machineId,
    expiresAt: s.expiresAt
  })))
})

export default app
```

### Example 2: WebSocket Integration

```typescript
import WebSocket from 'ws'
import { terminalService } from './services'

const wss = new WebSocket.Server({ port: 3001 })

wss.on('connection', async (ws) => {
  let sessionId: string | null = null

  ws.on('message', async (data) => {
    const message = JSON.parse(data)

    if (message.type === 'terminal_spawn') {
      // Issue token
      const token = await terminalService.issueSessionToken(
        message.userId,
        message.machineId
      )
      sessionId = token.sessionId

      // Send back to client
      ws.send(JSON.stringify({
        type: 'session_token',
        sessionId: token.sessionId,
        expiresAt: token.expiresAt
      }))
    }

    if (message.type === 'terminal_input' && sessionId) {
      // Check rate limit
      const allowed = await terminalService.enforceRateLimit(sessionId)
      if (!allowed) {
        ws.send(JSON.stringify({ type: 'error', message: 'Rate limit exceeded' }))
        return
      }

      // Create secure message for agent
      const token = terminalService.getSessionToken(sessionId)
      if (token) {
        const secureMessage = await terminalService.createSecureMessage(
          token,
          'terminal_input',
          { data: message.data },
          process.env.AGENT_SECRET!
        )

        // Forward to agent
        agentWs.send(JSON.stringify(secureMessage))
      }
    }
  })

  ws.on('close', async () => {
    if (sessionId) {
      await terminalService.endSession(sessionId)
    }
  })
})

export { wss }
```

### Example 3: Agent-Side Validation (Reference)

```typescript
// On agent receiving terminal_input message
async function handleTerminalInput(message: any) {
  const { machineId, agentSecret } = config

  // Validate the secure message
  const validation = await terminalService.validateSecureMessage(
    message,
    machineId,
    agentSecret
  )

  if (!validation.valid) {
    logger.error('Invalid message:', validation.reason)
    return
  }

  // Extract the payload
  const { data } = message.data.payload
  const { sessionId } = message.data

  // Execute in terminal
  const pty = terminalSessions.get(sessionId)
  if (pty) {
    pty.write(data)
  }
}
```

---

## Security Configuration

### 1. Generate Secret Key

**REQUIRED:** Generate a strong session token secret:

```bash
# Using OpenSSL
openssl rand -hex 32

# Using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Set in `.env`:**

```bash
SESSION_TOKEN_SECRET=your-generated-64-char-hex-string-here
```

### 2. Rate Limiting Tuning

**Adjust based on your needs:**

```bash
# Default: 100 messages/sec
# For slow connections: 50
# For fast networks: 200
RATE_LIMIT_TOKENS=100

# Burst allowance (for pasted content)
RATE_LIMIT_BURST=20

# Token bucket refill time
SESSION_EXPIRY_SECONDS=300
```

### 3. Clock Skew Tolerance

**For distributed systems:**

```bash
# Default: 60 seconds (max acceptable clock difference)
# Increase if agents have poor time sync
# Decrease for security (requires NTP)
CLOCK_SKEW_TOLERANCE=60
```

### 4. Database Auditing

**Ensure AuditLog table exists in Prisma:**

```prisma
model AuditLog {
  id        String   @id @default(cuid())
  eventType String   // terminal_session_start, terminal_session_end
  userId    String
  machineId String?
  details   Json?
  timestamp DateTime @default(now())

  @@index([eventType])
  @@index([userId])
  @@index([machineId])
}
```

---

## Troubleshooting

### Problem: HMAC validation failures

**Logs:**
```
⚠️  SecureMessageHmacValidationFailed
```

**Causes:**
1. Agent secret doesn't match server's `machine.secretKey`
2. Message was modified in transit
3. Different secret used for signing vs validation

**Solution:**
```bash
# 1. Verify secrets match
SELECT id, secretKey, secretKeyHash FROM machines;

# 2. Check logs for "MachineNotFound"
# 3. Use same secret on both sides

# 4. Test with hardcoded secret
const testSecret = 'test-secret-12345'
const token = await service.issueSessionToken('user1', 'machine1')
const msg = await service.createSecureMessage(token, 'terminal_input', {}, testSecret)
const valid = await service.validateSecureMessage(msg, 'machine1', testSecret)
console.log(valid.valid)  // Should be true
```

---

### Problem: Sessions expiring too quickly

**Logs:**
```
SessionTokenExpired
```

**Solution:**
Increase `SESSION_EXPIRY_SECONDS`:

```bash
# Default: 300 seconds (5 min)
# For longer sessions: 1800 (30 min)
SESSION_EXPIRY_SECONDS=1800
```

---

### Problem: Rate limiting too aggressive

**Logs:**
```
RateLimitExceeded
```

**Solution:**
Increase rate limit:

```bash
# From 100 to 200 messages/sec
RATE_LIMIT_TOKENS=200

# Or increase burst
RATE_LIMIT_BURST=50
```

---

### Problem: "Replay detected" false positives

**Logs:**
```
SecureMessageReplayDetected
```

**Causes:**
1. Clock skew too large
2. Network latency causing retries
3. Nonce history too small

**Solution:**
```bash
# Increase clock tolerance
CLOCK_SKEW_TOLERANCE=120  # 2 minutes

# Or ensure time sync:
# Linux agent: ntpdate -s time.google.com
```

---

## Contributing

### Reporting Issues

Use GitHub Issues with template:

```markdown
### Bug Report: [Title]

**Service Version:** v1.0

**Environment:**
- Node.js version:
- Operating system:
- Database: Postgres/MySQL/SQLite

**Steps to reproduce:**
1. ...
2. ...

**Expected:**
...

**Actual:**
...

**Logs:**
```
...
```

### Code Contributions

1. Fork repository
2. Create feature branch: `git checkout -b feature/your-feature`
3. Add tests in `__tests__/` directory
4. Ensure all tests pass: `npm test`
5. Submit PR with description

### Testing Guidelines

```typescript
// Example test
describe('Feature: X', () => {
  test('should do Y when Z', async () => {
    const result = await serviceMethod()
    expect(result).toBe(expected)
  })
})
```

---

## License

This service is part of the VMMaintainer project and is licensed under **MIT**.

See [LICENSE](../../LICENSE) for details.

---

## Support

- 📖 **Documentation:** See [06-SECURE-REMOTE-TERMINAL-SERVICE.md](./06-SECURE-REMOTE-TERMINAL-SERVICE.md)
- 🔗 **Integration Guide:** See [07-SECURE-TERMINAL-INTEGRATION-GUIDE.md](./07-SECURE-TERMINAL-INTEGRATION-GUIDE.md)
- 💬 **Issues:** GitHub Issues
- 📧 **Email:** support@yourdomain.com

---

**Last Updated:** 2025-12-06  
**Status:** Stable / Production Ready
