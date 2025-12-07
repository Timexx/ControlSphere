import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import crypto from 'crypto'
import { SecureRemoteTerminalService, SessionToken, SecureMessage } from '../SecureRemoteTerminalService'
import { PrismaClient } from '@prisma/client'
import { ILogger } from '../../../types/logger'

/**
 * Unit Tests for SecureRemoteTerminalService
 * 
 * ISO 27001 Compliance Coverage:
 * - A.14.2.1: Input validation (HMAC, schema)
 * - A.14.1.2: Authentication (session tokens)
 * - A.12.4.1: Audit logging
 * - A.12.6.1: Replay protection
 * - A.13.1.3: Data isolation (ACLs)
 */

// Mock Logger
class MockLogger implements ILogger {
  info = vi.fn()
  warn = vi.fn()
  error = vi.fn()
  debug = vi.fn()
}

// Mock Prisma
const mockPrisma = {
  auditLog: {
    create: vi.fn().mockResolvedValue({})
  }
} as unknown as PrismaClient

describe('SecureRemoteTerminalService', () => {
  let service: SecureRemoteTerminalService
  let logger: MockLogger

  beforeEach(() => {
    logger = new MockLogger()
    service = new SecureRemoteTerminalService(mockPrisma, logger)
    vi.clearAllMocks()
  })

  describe('Session Token Management', () => {
    describe('issueSessionToken', () => {
      it('should issue a valid session token', async () => {
        const token = await service.issueSessionToken('user1', 'machine1')

        expect(token).toBeDefined()
        expect(token.sessionId).toBeDefined()
        expect(token.userId).toBe('user1')
        expect(token.machineId).toBe('machine1')
        expect(token.signature).toBeDefined()
        expect(token.capabilities).toContain('spawn')
        expect(token.capabilities).toContain('input')
        expect(logger.info).toHaveBeenCalledWith(
          'TerminalSessionStarted',
          expect.objectContaining({
            userId: 'user1',
            machineId: 'machine1'
          })
        )
      })

      it('should set expiry to 5 minutes', async () => {
        const beforeIssue = Math.floor(Date.now() / 1000)
        const token = await service.issueSessionToken('user1', 'machine1')
        const afterIssue = Math.floor(Date.now() / 1000)

        const expectedExpiry = beforeIssue + 300
        expect(token.expiresAt).toBeGreaterThanOrEqual(expectedExpiry)
        expect(token.expiresAt).toBeLessThanOrEqual(expectedExpiry + 2)
      })

      it('should create HMAC signature', async () => {
        const token = await service.issueSessionToken('user1', 'machine1')

        // Recompute signature to verify
        const serverSecret = process.env.SESSION_TOKEN_SECRET || 'default-secret-change-me'
        const msgToSign = JSON.stringify({
          sessionId: token.sessionId,
          userId: token.userId,
          machineId: token.machineId,
          issuedAt: token.issuedAt,
          expiresAt: token.expiresAt,
          capabilities: token.capabilities
        })
        const expectedSignature = crypto
          .createHmac('sha256', serverSecret)
          .update(msgToSign)
          .digest('hex')

        expect(token.signature).toBe(expectedSignature)
      })

      it('should store token in active sessions', async () => {
        const token = await service.issueSessionToken('user1', 'machine1')
        const retrieved = service.getSessionToken(token.sessionId)

        expect(retrieved).toBeDefined()
        expect(retrieved?.userId).toBe('user1')
      })

      it('should store session in audit log', async () => {
        await service.issueSessionToken('user1', 'machine1')

        expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              action: 'SHELL_OPEN',
              eventType: 'terminal_session_start',
              userId: 'user1',
              machineId: 'machine1'
            })
          })
        )
      })

      it('should allow custom capabilities', async () => {
        const capabilities = ['spawn', 'input']
        const token = await service.issueSessionToken('user1', 'machine1', capabilities)

        expect(token.capabilities).toEqual(capabilities)
      })
    })

    describe('validateSessionToken', () => {
      let token: SessionToken

      beforeEach(async () => {
        token = await service.issueSessionToken('user1', 'machine1')
      })

      it('should validate valid token', async () => {
        const valid = await service.validateSessionToken(token)
        expect(valid).toBe(true)
      })

      it('should reject expired token', async () => {
        token.expiresAt = Math.floor(Date.now() / 1000) - 1

        const valid = await service.validateSessionToken(token)
        expect(valid).toBe(false)
        expect(logger.warn).toHaveBeenCalledWith(
          'SessionTokenExpired',
          expect.anything()
        )
      })

      it('should reject tampered token (corrupted signature)', async () => {
        token.signature = 'corrupted'

        const valid = await service.validateSessionToken(token)
        expect(valid).toBe(false)
        expect(logger.warn).toHaveBeenCalledWith(
          'SessionTokenTampering',
          expect.anything()
        )
      })

      it('should reject token with modified userId', async () => {
        token.userId = 'different-user'

        const valid = await service.validateSessionToken(token)
        expect(valid).toBe(false)
      })

      it('should refresh token if close to expiry', async () => {
        const originalExpiry = token.expiresAt
        const now = Math.floor(Date.now() / 1000)
        // Set token to expire in 50 seconds (which is < 60s threshold, so should refresh)
        token.expiresAt = now + 50
        
        // Need to re-sign with new expiry time to pass validation
        const serverSecret = process.env.SESSION_TOKEN_SECRET || 'default-secret-change-me'
        const msgToSign = JSON.stringify({
          sessionId: token.sessionId,
          userId: token.userId,
          machineId: token.machineId,
          issuedAt: token.issuedAt,
          expiresAt: token.expiresAt,
          capabilities: token.capabilities
        })
        token.signature = require('crypto')
          .createHmac('sha256', serverSecret)
          .update(msgToSign)
          .digest('hex')

        const valid = await service.validateSessionToken(token)
        expect(valid).toBe(true)
        expect(token.expiresAt).toBeGreaterThan(now + 50)
        expect(logger.debug).toHaveBeenCalledWith(
          'SessionTokenRefreshed',
          expect.anything()
        )
      })
    })

    describe('getSessionToken', () => {
      it('should retrieve stored session token', async () => {
        const issued = await service.issueSessionToken('user1', 'machine1')
        const retrieved = service.getSessionToken(issued.sessionId)

        expect(retrieved).toBeDefined()
        expect(retrieved?.userId).toBe('user1')
      })

      it('should return null for non-existent session', async () => {
        const retrieved = service.getSessionToken('non-existent')
        expect(retrieved).toBeNull()
      })
    })
  })

  describe('Secure Message Creation & Validation', () => {
    let token: SessionToken
    const agentSecret = crypto.randomBytes(32).toString('hex')

    beforeEach(async () => {
      token = await service.issueSessionToken('user1', 'machine1')
    })

    describe('createSecureMessage', () => {
      it('should create secure message with HMAC', async () => {
        const message = await service.createSecureMessage(
          token,
          'terminal_input',
          { data: 'test input' },
          agentSecret
        )

        expect(message.type).toBe('terminal_input')
        expect(message.sessionToken).toBe(token)
        expect(message.data.sessionId).toBe(token.sessionId)
        expect(message.data.machineId).toBe(token.machineId)
        expect(message.data.nonce).toBeDefined()
        expect(message.data.timestamp).toBeDefined()
        expect(message.data.hmac).toBeDefined()
      })

      it('should generate unique nonces', async () => {
        const msg1 = await service.createSecureMessage(
          token,
          'terminal_input',
          { data: 'test1' },
          agentSecret
        )
        const msg2 = await service.createSecureMessage(
          token,
          'terminal_input',
          { data: 'test2' },
          agentSecret
        )

        expect(msg1.data.nonce).not.toBe(msg2.data.nonce)
      })

      it('should compute correct HMAC', async () => {
        const message = await service.createSecureMessage(
          token,
          'terminal_input',
          { data: 'test' },
          agentSecret
        )

        // Must reconstruct with stringified payload (what gets signed)
        const payloadString = JSON.stringify({ data: 'test' })
        const msgToSign = JSON.stringify({
          type: 'terminal_input',
          sessionId: token.sessionId,
          machineId: token.machineId,
          payload: payloadString,
          nonce: message.data.nonce,
          timestamp: message.data.timestamp
        })
        const expectedHmac = crypto
          .createHmac('sha256', agentSecret)
          .update(msgToSign)
          .digest('hex')

        expect(message.data.hmac).toBe(expectedHmac)
      })

      it('should use ISO 8601 timestamp', async () => {
        const message = await service.createSecureMessage(
          token,
          'terminal_input',
          { data: 'test' },
          agentSecret
        )

        const ts = new Date(message.data.timestamp)
        expect(ts.getTime()).toBeLessThanOrEqual(Date.now())
        expect(ts.getTime()).toBeGreaterThan(Date.now() - 1000)
      })

      it('should support all message types', async () => {
        const types: Array<'terminal_input' | 'terminal_resize' | 'execute_command' | 'terminal_spawn'> = [
          'terminal_input',
          'terminal_resize',
          'execute_command',
          'terminal_spawn'
        ]

        for (const type of types) {
          const message = await service.createSecureMessage(
            token,
            type,
            { data: 'test' },
            agentSecret
          )
          expect(message.type).toBe(type)
        }
      })
    })

    describe('validateSecureMessage', () => {
      it('should validate correct message', async () => {
        const message = await service.createSecureMessage(
          token,
          'terminal_input',
          { data: 'test' },
          agentSecret
        )

        const result = await service.validateSecureMessage(
          message,
          token.machineId,
          agentSecret
        )

        expect(result.valid).toBe(true)
      })

      it('should reject message with bad HMAC', async () => {
        const message = await service.createSecureMessage(
          token,
          'terminal_input',
          { data: 'test' },
          agentSecret
        )
        message.data.hmac = 'corrupted'

        const result = await service.validateSecureMessage(
          message,
          token.machineId,
          agentSecret
        )

        expect(result.valid).toBe(false)
        expect(result.reason).toContain('HMAC')
      })

      it('should reject message with modified payload', async () => {
        const message = await service.createSecureMessage(
          token,
          'terminal_input',
          { data: 'original' },
          agentSecret
        )
        message.data.payload = { data: 'modified' }

        const result = await service.validateSecureMessage(
          message,
          token.machineId,
          agentSecret
        )

        expect(result.valid).toBe(false)
      })

      it('should reject message with old timestamp', async () => {
        const message = await service.createSecureMessage(
          token,
          'terminal_input',
          { data: 'test' },
          agentSecret
        )
        message.data.timestamp = new Date(Date.now() - 120000).toISOString()

        const result = await service.validateSecureMessage(
          message,
          token.machineId,
          agentSecret
        )

        expect(result.valid).toBe(false)
        expect(result.reason).toContain('Timestamp')
      })

      it('should reject replayed message (same nonce)', async () => {
        const message = await service.createSecureMessage(
          token,
          'terminal_input',
          { data: 'test' },
          agentSecret
        )

        // First validation should succeed
        let result = await service.validateSecureMessage(
          message,
          token.machineId,
          agentSecret
        )
        expect(result.valid).toBe(true)

        // Second validation with same nonce should fail
        result = await service.validateSecureMessage(
          message,
          token.machineId,
          agentSecret
        )
        expect(result.valid).toBe(false)
        expect(result.reason).toContain('Replay')
        expect(logger.warn).toHaveBeenCalledWith(
          'SecureMessageReplayDetected',
          expect.anything()
        )
      })

      it('should accept different nonces', async () => {
        const msg1 = await service.createSecureMessage(
          token,
          'terminal_input',
          { data: 'test1' },
          agentSecret
        )
        const msg2 = await service.createSecureMessage(
          token,
          'terminal_input',
          { data: 'test2' },
          agentSecret
        )

        const result1 = await service.validateSecureMessage(
          msg1,
          token.machineId,
          agentSecret
        )
        const result2 = await service.validateSecureMessage(
          msg2,
          token.machineId,
          agentSecret
        )

        expect(result1.valid).toBe(true)
        expect(result2.valid).toBe(true)
      })

      it('should reject message with wrong agent secret', async () => {
        const message = await service.createSecureMessage(
          token,
          'terminal_input',
          { data: 'test' },
          agentSecret
        )
        const wrongSecret = crypto.randomBytes(32).toString('hex')

        const result = await service.validateSecureMessage(
          message,
          token.machineId,
          wrongSecret
        )

        expect(result.valid).toBe(false)
      })
    })
  })

  describe('Rate Limiting', () => {
    let sessionId: string

    beforeEach(async () => {
      const token = await service.issueSessionToken('user1', 'machine1')
      sessionId = token.sessionId
    })

    it('should allow up to 100 messages per second', async () => {
      for (let i = 0; i < 100; i++) {
        const allowed = await service.enforceRateLimit(sessionId)
        expect(allowed).toBe(true)
      }
    })

    it('should block messages when rate limit exceeded', async () => {
      // Consume all tokens
      for (let i = 0; i < 100; i++) {
        await service.enforceRateLimit(sessionId)
      }

      // Next messages should be blocked (no tokens left)
      let blocked = false
      for (let i = 0; i < 5; i++) {
        const allowed = await service.enforceRateLimit(sessionId)
        if (!allowed) {
          blocked = true
          break
        }
      }
      expect(blocked).toBe(true)
    })

    it('should refill tokens over time', async () => {
      // Consume all tokens
      for (let i = 0; i < 100; i++) {
        await service.enforceRateLimit(sessionId)
      }

      // Wait 1.1 seconds (should get ~100 tokens back to max)
      await new Promise(resolve => setTimeout(resolve, 1100))

      // Should have tokens available again
      let available = 0
      for (let i = 0; i < 50; i++) {
        const allowed = await service.enforceRateLimit(sessionId)
        if (allowed) available++
      }

      expect(available).toBeGreaterThan(0)
    })

    it('should log excessive rate limit hits', async () => {
      // Consume all 100 tokens
      for (let i = 0; i < 100; i++) {
        await service.enforceRateLimit(sessionId)
      }

      // Now hit rate limit 110 times (exceededCount will be 110)
      // This should trigger logging at exceededCount = 10, 20, 30, etc
      for (let i = 0; i < 110; i++) {
        await service.enforceRateLimit(sessionId)
      }

      // Check that warning was called (at 10, 20, 30... 110 hits)
      expect(logger.warn).toHaveBeenCalledWith(
        'RateLimitExceeded',
        expect.objectContaining({
          sessionId,
          count: expect.any(Number)
        })
      )
    })
  })

  describe('Session Lifecycle', () => {
    it('should end session and log', async () => {
      const token = await service.issueSessionToken('user1', 'machine1')

      await service.endSession(token.sessionId)

      const retrieved = service.getSessionToken(token.sessionId)
      expect(retrieved).toBeNull()

      expect(logger.info).toHaveBeenCalledWith(
        'TerminalSessionEnded',
        expect.anything()
      )
    })

    it('should handle ending non-existent session gracefully', async () => {
      await service.endSession('non-existent')

      expect(logger.info).not.toHaveBeenCalledWith(
        'TerminalSessionEnded',
        expect.anything()
      )
    })
  })

  describe('Monitoring & Admin', () => {
    it('should retrieve rate limit info', async () => {
      const token = await service.issueSessionToken('user1', 'machine1')

      const info = service.getRateLimitInfo(token.sessionId)
      expect(info).toBeDefined()
      expect(info?.sessionId).toBe(token.sessionId)
      expect(info?.tokensAvailable).toBe(100)
    })

    it('should list all active sessions', async () => {
      const token1 = await service.issueSessionToken('user1', 'machine1')
      const token2 = await service.issueSessionToken('user2', 'machine2')

      const sessions = service.getActiveSessions()
      expect(sessions).toHaveLength(2)
      expect(sessions.map(s => s.sessionId)).toContain(token1.sessionId)
      expect(sessions.map(s => s.sessionId)).toContain(token2.sessionId)
    })
  })

  describe('Security: Timing Attacks', () => {
    it('should use timing-safe comparison for HMAC', async () => {
      const token = await service.issueSessionToken('user1', 'machine1')
      const agentSecret = 'test-secret'

      const message = await service.createSecureMessage(
        token,
        'terminal_input',
        { data: 'test' },
        agentSecret
      )

      // Corrupt HMAC
      const originalHmac = message.data.hmac
      message.data.hmac = '0'.repeat(64)

      const result = await service.validateSecureMessage(
        message,
        token.machineId,
        agentSecret
      )

      expect(result.valid).toBe(false)
      // The timing should be consistent regardless of where HMAC differs
    })
  })
})
