import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { SecureRemoteTerminalService } from '../../domain/services/SecureRemoteTerminalService'
import { ILogger } from '../../types/logger'

/**
 * Integration Test: Terminal Session Workflow
 * 
 * Tests the complete workflow:
 * 1. Web client requests terminal spawn
 * 2. Server issues session token with HMAC
 * 3. Web client sends terminal input
 * 4. Server wraps with secure message (HMAC, nonce, timestamp)
 * 5. Agent validates and executes
 * 6. Server receives output and broadcasts
 * 7. Session ends on disconnect
 */

describe('Terminal Session Integration', () => {
  let prisma: PrismaClient
  let logger: ILogger
  let terminalService: SecureRemoteTerminalService

  beforeAll(() => {
    // Mock logger
    logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    }

    // Mock Prisma with in-memory SQLite for testing
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: 'file:./prisma/test.db'
        }
      }
    })

    // Initialize service
    // Set SESSION_TOKEN_SECRET for tests
    process.env.SESSION_TOKEN_SECRET = '0'.repeat(64) // 32 bytes = 64 hex chars

    terminalService = new SecureRemoteTerminalService(prisma, logger)
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('should issue session token on spawn_terminal', async () => {
    const userId = 'user123'
    const machineId = 'machine456'

    // Step 1: Web client sends spawn_terminal
    const token = await terminalService.issueSessionToken(userId, machineId)

    // Verify token structure
    expect(token).toBeDefined()
    expect(token.userId).toBe(userId)
    expect(token.machineId).toBe(machineId)
    expect(token.sessionId).toBeDefined()
    expect(token.signature).toBeDefined()
    expect(token.capabilities).toContain('spawn')
    expect(token.expiresAt).toBeGreaterThan(token.issuedAt)

    // Token should be storable and retrievable
    const retrieved = await terminalService.getSessionToken(token.sessionId)
    expect(retrieved).toBeDefined()
    expect(retrieved?.sessionId).toBe(token.sessionId)
  })

  it('should validate session token', async () => {
    const token = await terminalService.issueSessionToken('user1', 'machine1')

    // Valid token should pass
    const validation = await terminalService.validateSessionToken(token)
    expect(validation).toBe(true)

    // Invalid token should fail
    const invalidToken = { ...token, signature: 'invalid' }
    const invalidValidation = await terminalService.validateSessionToken(invalidToken)
    expect(invalidValidation).toBe(false)
  })

  it('should create secure message with HMAC', async () => {
    const token = await terminalService.issueSessionToken('user1', 'machine1')
    const machineSecret = 'secret-key-hash-from-db'

    // Step 2: Create secure message with input
    const payload = { data: 'ls -la' }
    const message = await terminalService.createSecureMessage(
      token,
      'terminal_input',
      payload,
      machineSecret
    )

    // Verify message structure
    expect(message.type).toBe('terminal_input')
    expect(message.data.sessionId).toBe(token.sessionId)
    expect(message.data.nonce).toBeDefined()
    expect(message.data.nonce.length).toBe(32) // 16 bytes = 32 hex chars
    expect(message.data.timestamp).toBeDefined()
    expect(message.data.hmac).toBeDefined()

    // HMAC should be deterministic for same input
    const message2 = await terminalService.createSecureMessage(
      token,
      'terminal_input',
      payload,
      machineSecret
    )
    // Different nonce means different HMAC (which is correct)
    expect(message2.data.nonce).not.toBe(message.data.nonce)
  })

  it('should validate secure message on agent side', async () => {
    const token = await terminalService.issueSessionToken('user1', 'machine1')
    const machineSecret = 'secret-key-hash'

    // Create message
    const payload = { data: 'echo hello' }
    const message = await terminalService.createSecureMessage(
      token,
      'terminal_input',
      payload,
      machineSecret
    )

    // Step 3: Agent receives and validates
    const validation = await terminalService.validateSecureMessage(
      message,
      'machine1',
      machineSecret
    )

    expect(validation.valid).toBe(true)

    // Tampered HMAC should fail
    const tamperedMessage = { ...message, data: { ...message.data, hmac: 'invalid' } }
    const tamperedValidation = await terminalService.validateSecureMessage(
      tamperedMessage,
      'machine1',
      machineSecret
    )
    expect(tamperedValidation.valid).toBe(false)
  })

  it('should detect replay attacks', async () => {
    const token = await terminalService.issueSessionToken('user1', 'machine1')
    const machineSecret = 'secret-key'

    const payload = { data: 'whoami' }
    const message = await terminalService.createSecureMessage(
      token,
      'terminal_input',
      payload,
      machineSecret
    )

    // First validation should pass
    const validation1 = await terminalService.validateSecureMessage(
      message,
      'machine1',
      machineSecret
    )
    expect(validation1.valid).toBe(true)

    // Same message with same nonce should be rejected (replay)
    const validation2 = await terminalService.validateSecureMessage(
      message,
      'machine1',
      machineSecret
    )
    expect(validation2.valid).toBe(false)
  })

  it('should enforce rate limiting', async () => {
    const token = await terminalService.issueSessionToken('user1', 'machine1')
    const sessionId = token.sessionId

    // Send 100 messages rapidly - should all be allowed
    const resultsPhase1 = []
    for (let i = 0; i < 100; i++) {
      const allowed = await terminalService.enforceRateLimit(sessionId)
      resultsPhase1.push(allowed)
    }
    expect(resultsPhase1.every(r => r === true)).toBe(true)

    // Send 10 more immediately - should be blocked (no refill yet)
    const resultsPhase2 = []
    for (let i = 0; i < 10; i++) {
      const allowed = await terminalService.enforceRateLimit(sessionId)
      resultsPhase2.push(allowed)
    }
    expect(resultsPhase2.some(r => r === false)).toBe(true)
  })

  it('should end session and cleanup', async () => {
    const token = await terminalService.issueSessionToken('user1', 'machine1')
    const sessionId = token.sessionId

    // Session should exist
    let session = await terminalService.getSessionToken(sessionId)
    expect(session).toBeDefined()

    // End session
    await terminalService.endSession(sessionId)

    // Session should be cleaned up
    session = await terminalService.getSessionToken(sessionId)
    expect(session).toBeNull()
  })

  it('should list active sessions for user', async () => {
    const userId = 'user-sessions-test'

    // Create multiple sessions
    const token1 = await terminalService.issueSessionToken(userId, 'machine1')
    const token2 = await terminalService.issueSessionToken(userId, 'machine2')

    // List active sessions
    const sessions = await terminalService.getActiveSessions(userId)

    expect(sessions.length).toBeGreaterThanOrEqual(2)
    expect(sessions.map(s => s.sessionId)).toContain(token1.sessionId)
    expect(sessions.map(s => s.sessionId)).toContain(token2.sessionId)

    // Cleanup
    await terminalService.endSession(token1.sessionId)
    await terminalService.endSession(token2.sessionId)
  })

  it('should get rate limit info', async () => {
    const token = await terminalService.issueSessionToken('user1', 'machine1')
    const sessionId = token.sessionId

    // Consume some tokens
    await terminalService.enforceRateLimit(sessionId)
    await terminalService.enforceRateLimit(sessionId)

    // Get rate limit info
    const info = await terminalService.getRateLimitInfo(sessionId)

    expect(info).toBeDefined()
    expect(info?.sessionId).toBe(sessionId)
    expect(info?.tokensAvailable).toBeLessThan(100)
  })
})
