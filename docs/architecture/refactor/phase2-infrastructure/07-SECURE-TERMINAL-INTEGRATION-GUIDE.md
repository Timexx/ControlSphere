# Integration Guide: SecureRemoteTerminalService in Connection Layer

**Date:** 2025-12-06  
**Status:** Implementation Reference  
**Target:** WebClientConnectionManager & AgentConnectionManager integration  

---

## Overview

This guide shows how to integrate `SecureRemoteTerminalService` into the existing Connection Layer to enable:

1. Session token issuance on `spawn_terminal`
2. Secure message wrapping with HMAC for `terminal_input` and `terminal_resize`
3. Rate limiting enforcement
4. Agent-side validation (reference)

---

## Integration Points

### 1. WebClientConnectionManager - Enhanced spawn_terminal Handler

**Location:** `server/src/connection/WebClientConnectionManager.ts`

**Add this import at the top:**

```typescript
import { SecureRemoteTerminalService } from '../domain/services/SecureRemoteTerminalService'
```

**Modify the constructor to accept the service:**

```typescript
export class WebClientConnectionManager {
  private parser: MessageParser
  private validator: MessageValidator
  private router: MessageRouter
  private terminalService: SecureRemoteTerminalService  // ADD THIS

  constructor(
    private readonly prisma: PrismaClient,
    private readonly registry: ConnectionRegistry,
    private readonly broadcast: (data: any) => void,
    private readonly jwtSecret: () => Promise<string>,
    private readonly terminalService: SecureRemoteTerminalService,  // ADD THIS
    private readonly logger: ILogger
  ) {
    // ... existing code
  }
}
```

**Replace the handleSpawnTerminal method:**

```typescript
/**
 * Handle spawn terminal request
 * ISO 27001 A.14.2.1: Issue session token + validate ACL
 * ISO 27001 A.12.4.1: Audit spawn operation
 */
private async handleSpawnTerminal(data: any): Promise<void> {
  const { machineId, sessionId } = data
  const userId = data.userId  // From JWT authentication

  if (!machineId || !sessionId || !userId) {
    this.logger.warn('SpawnTerminalMissingFields', { machineId, sessionId, userId })
    return
  }

  // 1. Issue secure session token (includes ACL check)
  let token
  try {
    token = await this.terminalService.issueSessionToken(
      userId,
      machineId,
      ['spawn', 'input', 'resize']
    )
  } catch (error) {
    this.logger.warn('SessionTokenIssuanceFailed', {
      userId,
      machineId,
      error: (error as Error).message
    })
    return
  }

  // 2. Get machine to retrieve secret for HMAC
  const machine = await this.prisma.machine.findUnique({
    where: { id: machineId }
  })

  if (!machine) {
    this.logger.warn('MachineNotFound', { machineId })
    return
  }

  // 3. Create secure message wrapper (with HMAC, nonce, timestamp)
  const secureMessage = await this.terminalService.createSecureMessage(
    token,
    'terminal_spawn',
    { machineId, sessionId },
    machine.secretKeyHash || machine.secretKey  // Use hash or plaintext if available
  )

  // 4. Send to agent
  const agentWs = this.registry.getMachine(machineId)
  if (!agentWs || agentWs.readyState !== 1) {
    this.logger.warn('AgentNotConnected', { machineId })
    return
  }

  agentWs.send(JSON.stringify(secureMessage))

  this.logger.info('SpawnTerminal', {
    machineId,
    sessionId,
    userId,
    tokenExpiresAt: new Date(token.expiresAt * 1000).toISOString()
  })
}
```

**Replace the handleTerminalInput method:**

```typescript
/**
 * Handle terminal input from web client
 * ISO 27001 A.12.6.1: Rate limiting to prevent DoS
 * ISO 27001 A.14.2.1: Message validation with HMAC
 */
private async handleTerminalInput(data: any): Promise<void> {
  const { machineId, sessionId } = data
  const input = data.input ?? data.data
  const userId = data.userId

  if (!machineId || !sessionId || !userId) {
    this.logger.warn('TerminalInputMissingFields', { machineId, sessionId, userId })
    return
  }

  // 1. Validate session token is still active
  const token = this.terminalService.getSessionToken(sessionId)
  if (!token) {
    this.logger.warn('TerminalSessionInvalid', { sessionId, userId })
    return
  }

  // Verify user is the session owner
  if (token.userId !== userId) {
    this.logger.warn('TerminalSessionUnauthorized', {
      sessionId,
      expectedUserId: token.userId,
      actualUserId: userId
    })
    return
  }

  // 2. Enforce rate limiting (prevent DoS)
  const allowed = await this.terminalService.enforceRateLimit(sessionId)
  if (!allowed) {
    this.logger.warn('TerminalInputRateLimited', { sessionId, userId })
    return  // Drop message silently
  }

  // 3. Get machine secret for HMAC
  const machine = await this.prisma.machine.findUnique({
    where: { id: machineId }
  })

  if (!machine) {
    this.logger.warn('MachineNotFound', { machineId })
    return
  }

  // 4. Create secure message (with HMAC validation)
  const secureMessage = await this.terminalService.createSecureMessage(
    token,
    'terminal_input',
    { sessionId, data: input },
    machine.secretKeyHash || machine.secretKey
  )

  // 5. Send to agent
  const agentWs = this.registry.getMachine(machineId)
  if (!agentWs || agentWs.readyState !== 1) {
    this.logger.warn('AgentNotConnected', { machineId })
    return
  }

  agentWs.send(JSON.stringify(secureMessage))

  this.logger.debug('TerminalInput', {
    machineId,
    sessionId,
    userId,
    inputSize: String(input).length
  })
}
```

**Replace the handleTerminalResize method:**

```typescript
/**
 * Handle terminal resize request
 * ISO 27001 A.14.2.1: Validates dimensions + HMAC
 */
private async handleTerminalResize(data: any): Promise<void> {
  const { machineId, sessionId, cols, rows } = data
  const userId = data.userId

  if (!machineId || !sessionId || !cols || !rows || !userId) {
    this.logger.warn('TerminalResizeMissingFields', {
      machineId,
      sessionId,
      cols,
      rows,
      userId
    })
    return
  }

  // 1. Validate session token
  const token = this.terminalService.getSessionToken(sessionId)
  if (!token) {
    this.logger.warn('TerminalSessionInvalid', { sessionId, userId })
    return
  }

  // 2. Verify user ownership
  if (token.userId !== userId) {
    this.logger.warn('TerminalSessionUnauthorized', { sessionId, userId })
    return
  }

  // 3. Rate limit
  const allowed = await this.terminalService.enforceRateLimit(sessionId)
  if (!allowed) {
    this.logger.debug('TerminalResizeRateLimited', { sessionId, userId })
    return
  }

  // 4. Get machine secret
  const machine = await this.prisma.machine.findUnique({
    where: { id: machineId }
  })

  if (!machine) {
    this.logger.warn('MachineNotFound', { machineId })
    return
  }

  // 5. Create secure message
  const secureMessage = await this.terminalService.createSecureMessage(
    token,
    'terminal_resize',
    { sessionId, cols, rows },
    machine.secretKeyHash || machine.secretKey
  )

  // 6. Send to agent
  const agentWs = this.registry.getMachine(machineId)
  if (!agentWs || agentWs.readyState !== 1) {
    this.logger.warn('AgentNotConnected', { machineId })
    return
  }

  agentWs.send(JSON.stringify(secureMessage))

  this.logger.debug('TerminalResize', {
    machineId,
    sessionId,
    cols,
    rows
  })
}
```

---

### 2. WebClientConnectionManager - Session Cleanup

**Add this handler for when web client disconnects:**

```typescript
/**
 * Cleanup: End all terminal sessions for this user
 */
private async cleanupUserSessions(userId: string): Promise<void> {
  const activeSessions = this.terminalService.getActiveSessions()

  for (const session of activeSessions) {
    if (session.userId === userId) {
      await this.terminalService.endSession(session.sessionId)
      this.logger.info('TerminalSessionCleanup', {
        sessionId: session.sessionId,
        userId,
        reason: 'User disconnected'
      })
    }
  }
}
```

**Call this in the ws.on('close') handler:**

```typescript
ws.on('close', async () => {
  const session = this.registry.getWebClient(ws)
  if (session?.userId) {
    await this.cleanupUserSessions(session.userId)
  }
  this.logger.info('WebClientDisconnected', { userId: session?.userId })
  this.registry.deleteWebClient(ws)
})
```

---

### 3. AgentConnectionManager - Enhanced Terminal Output Handler

**Location:** `server/src/connection/AgentConnectionManager.ts`

**Add import:**

```typescript
import { SecureRemoteTerminalService } from '../domain/services/SecureRemoteTerminalService'
```

**Add to constructor:**

```typescript
export class AgentConnectionManager {
  private parser: MessageParser
  private validator: MessageValidator
  private router: MessageRouter
  private normalizer: OutputNormalizer
  private terminalService: SecureRemoteTerminalService  // ADD THIS

  constructor(
    private readonly prisma: PrismaClient,
    private readonly registry: ConnectionRegistry,
    private readonly broadcast: (data: any) => void,
    private readonly terminalService: SecureRemoteTerminalService,  // ADD THIS
    private readonly logger: ILogger
  ) {
    // ... existing code
  }
}
```

**Enhanced handleTerminalOutput to validate secure message:**

```typescript
/**
 * Handle terminal output from agent
 * ISO 27001 A.14.2.1: Validate HMAC and session token
 */
private async handleTerminalOutput(data: any): Promise<void> {
  const { sessionId, machineId } = data

  if (!sessionId || !machineId) {
    this.logger.warn('TerminalOutputMissingFields', { sessionId, machineId })
    return
  }

  // 1. If using new secure protocol, validate HMAC + replay
  if (data.sessionToken) {
    const machine = await this.prisma.machine.findUnique({
      where: { id: machineId }
    })

    if (!machine) {
      this.logger.warn('MachineNotFound', { machineId })
      return
    }

    const validation = await this.terminalService.validateSecureMessage(
      data,
      machineId,
      machine.secretKeyHash || machine.secretKey
    )

    if (!validation.valid) {
      this.logger.warn('TerminalOutputSecureValidationFailed', {
        machineId,
        sessionId,
        reason: validation.reason
      })
      return
    }
  }

  // 2. Broadcast to web client
  const normalizedOutput = this.normalizer.normalize(data.output || data.data)

  this.broadcast({
    type: 'terminal_output',
    sessionId,
    machineId,
    output: normalizedOutput
  })

  this.logger.debug('TerminalOutput', {
    machineId,
    sessionId,
    outputSize: (data.output || data.data)?.length || 0
  })
}
```

---

### 4. server.ts - Bootstrap Service Injection

**Location:** `server/src/server.ts` (or your main bootstrap file)

**Add service initialization:**

```typescript
import { SecureRemoteTerminalService } from './domain/services/SecureRemoteTerminalService'

// ... existing code

// Initialize services
const connectionRegistry = new ConnectionRegistry()
const terminalService = new SecureRemoteTerminalService(prisma, logger)

// Create managers with service injection
const agentConnManager = new AgentConnectionManager(
  prisma,
  connectionRegistry,
  broadcast,
  terminalService,  // PASS SERVICE
  logger
)

const webClientConnManager = new WebClientConnectionManager(
  prisma,
  connectionRegistry,
  broadcast,
  () => Promise.resolve(process.env.JWT_SECRET || ''),
  terminalService,  // PASS SERVICE
  logger
)

// ... rest of setup
```

---

## Database Schema Extensions

Add these fields to your Prisma schema:

```prisma
// prisma/schema.prisma

model AuditLog {
  id        String   @id @default(cuid())
  eventType String   // e.g., "terminal_session_start"
  userId    String
  machineId String?
  details   Json?
  timestamp DateTime @default(now())

  @@index([eventType])
  @@index([userId])
  @@index([machineId])
}

model Machine {
  // ... existing fields
  secretKeyHash      String?   // NEW: Only store hash
  secretVersion      Int       @default(1)  // NEW: For rotation
  secretRotatedAt    DateTime? // NEW: Track rotation
}
```

**Run migration:**

```bash
npx prisma migrate dev --name add_secure_terminal_fields
```

---

## Environment Variables

**Add to `.env`:**

```bash
# Secure Terminal Service Configuration
SESSION_TOKEN_SECRET=your-64-character-secret-key-here-generate-with-openssl-rand-hex-32
SESSION_EXPIRY_SECONDS=300
RATE_LIMIT_TOKENS=100
RATE_LIMIT_BURST=20
CLOCK_SKEW_TOLERANCE=60

# WSS Enforcement (Infrastructure Layer)
ENFORCE_WSS=true
ALLOWED_ORIGINS=http://localhost:3000,https://yourdomain.com

# Optional: Mutual TLS for agents
AGENT_REQUIRE_MTLS=false
```

---

## Testing Integration

**Example integration test:**

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { SecureRemoteTerminalService } from '../../../domain/services/SecureRemoteTerminalService'
import { WebClientConnectionManager } from '../WebClientConnectionManager'

describe('Terminal Session Integration', () => {
  let terminalService: SecureRemoteTerminalService
  let webClientManager: WebClientConnectionManager

  beforeAll(() => {
    // Setup...
    terminalService = new SecureRemoteTerminalService(prisma, logger)
    webClientManager = new WebClientConnectionManager(
      prisma,
      registry,
      broadcast,
      jwtSecret,
      terminalService,
      logger
    )
  })

  it('should issue token on spawn and validate on input', async () => {
    // 1. Spawn terminal (issues token)
    await webClientManager.handleSpawnTerminal({
      machineId: 'machine1',
      sessionId: 'session1',
      userId: 'user1'
    })

    // 2. Verify token was issued
    const token = terminalService.getSessionToken('session1')
    expect(token).toBeDefined()

    // 3. Send input (validates token + enforces rate limit)
    await webClientManager.handleTerminalInput({
      machineId: 'machine1',
      sessionId: 'session1',
      userId: 'user1',
      data: 'ls -la'
    })

    // 4. Verify rate limit works
    const rateLimitInfo = terminalService.getRateLimitInfo('session1')
    expect(rateLimitInfo?.tokensAvailable).toBeLessThan(100)
  })

  it('should prevent replay attacks', async () => {
    const token = await terminalService.issueSessionToken('user1', 'machine1')
    const machine = { secretKeyHash: 'test-secret' }

    // Create first message
    const msg1 = await terminalService.createSecureMessage(
      token,
      'terminal_input',
      { data: 'test' },
      machine.secretKeyHash
    )

    // First validation: OK
    let validation = await terminalService.validateSecureMessage(
      msg1,
      'machine1',
      machine.secretKeyHash
    )
    expect(validation.valid).toBe(true)

    // Replay same message: Should fail
    validation = await terminalService.validateSecureMessage(
      msg1,
      'machine1',
      machine.secretKeyHash
    )
    expect(validation.valid).toBe(false)
    expect(validation.reason).toContain('Replay')
  })
})
```

---

## Migration Path

### Phase 1: Deploy (Week 1)
- [ ] Deploy `SecureRemoteTerminalService` to staging
- [ ] Update Connection Layer to support both old and new protocol
- [ ] Run tests and monitoring

### Phase 2: Enable (Week 2)
- [ ] Enable for new terminal sessions
- [ ] Log security events for monitoring
- [ ] No agent updates required yet

### Phase 3: Deprecation (Week 3-4)
- [ ] Agents start using new protocol
- [ ] Old protocol generates warnings
- [ ] Begin requiring new protocol

### Phase 4: Strict Enforcement (Week 5+)
- [ ] Old protocol rejected
- [ ] Full security enforcement
- [ ] All agents must be updated

---

## Troubleshooting

### HMAC validation failures

**Symptom:** "HMAC validation failed" warnings in logs

**Solution:**
- Verify `machine.secretKeyHash` matches what agent has
- Check timestamp synchronization between server and agents
- Ensure nonce is being tracked correctly

### Session tokens not being issued

**Symptom:** "SessionTokenIssuanceFailed" with "User has no access"

**Solution:**
- Check `validateUserMachineAccess` implementation
- Verify user/machine relationship exists in database
- Check user permissions/roles

### Rate limiting too aggressive

**Symptom:** Legitimate terminal input getting dropped

**Solution:**
- Increase `RATE_LIMIT_TOKENS` in .env
- Increase `RATE_LIMIT_BURST` for burstiness
- Check for rapid keystrokes or pasted content

---

## References

- [Main Architecture Doc](./06-SECURE-REMOTE-TERMINAL-SERVICE.md)
- [ISO 27001 Control A.12.6.1](https://www.iso.org/standard/27001)
- [OWASP Replay Attack Prevention](https://owasp.org/www-community/attacks/Replay_attack)
