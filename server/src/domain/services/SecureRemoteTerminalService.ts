import crypto from 'crypto'
import { v4 as uuidv4 } from 'uuid'
import { PrismaClient } from '@prisma/client'
import { ILogger } from '../../types/logger'

/**
 * SecureRemoteTerminalService - Modular service for secure remote terminal management
 * 
 * Purpose:
 * - Centralize all terminal session lifecycle management
 * - Provide cryptographic security with HMAC, nonce, timestamp validation
 * - Enforce rate limiting and session-based ACLs
 * - Complete audit trail for compliance (ISO 27001, CREST)
 * - Reusable for execute_command, scans, and future operations
 * 
 * ISO 27001 Mapping:
 * - A.14.2.1: Input validation via HMAC + schema
 * - A.14.1.2: Authentication via session tokens
 * - A.12.4.1: Audit logging of all operations
 * - A.12.6.1: Replay protection via nonce+timestamp
 * - A.13.1.3: Session-based ACLs
 */

export interface SessionToken {
  sessionId: string
  userId: string
  machineId: string
  issuedAt: number
  expiresAt: number
  capabilities: string[]
  signature: string
}

export interface SecureMessage {
  type: string
  sessionToken: SessionToken
  data: {
    sessionId: string
    machineId: string
    payload: string // MUST be JSON string to match agent's json.RawMessage expectation
    nonce: string
    timestamp: string
    hmac: string
  }
}

export interface ValidationResult {
  valid: boolean
  reason?: string
}

interface RateLimitBucket {
  sessionId: string
  tokensAvailable: number
  lastRefillAt: number
  exceededCount: number
}

export class SecureRemoteTerminalService {
  private activeSessions: Map<string, SessionToken> = new Map()
  private rateLimitBuckets: Map<string, RateLimitBucket> = new Map()
  private recentNonces: Map<string, Set<string>> = new Map() // Per-machine nonce history

  private readonly SESSION_EXPIRY_SECONDS = 300 // 5 minutes
  private readonly RATE_LIMIT_TOKENS = 100 // messages per second
  private readonly RATE_LIMIT_BURST = 20 // allowed burst
  private readonly NONCE_HISTORY_SIZE = 10000 // recent nonces to track
  private readonly CLOCK_SKEW_TOLERANCE = 60 // seconds
  private readonly TOKEN_REFRESH_THRESHOLD = 60 // refresh if <60 sec left

  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: ILogger
  ) {
    // Periodically clean up expired sessions and old nonces
    setInterval(() => this.cleanupExpiredData(), 60000)
  }

  /**
   * Issue a new session token for a remote terminal operation
   * ISO 27001 A.14.1.2: Authentication checkpoint
   *
   * @param userId - Web client user ID (for ACL)
   * @param machineId - Target machine
   * @param capabilities - Operations allowed in this session
   * @returns SessionToken with signature
   * @throws Error if user has no access to machine
   */
  async issueSessionToken(
    userId: string,
    machineId: string,
    capabilities: string[] = ['spawn', 'input', 'resize']
  ): Promise<SessionToken> {
    // Skip ACL check for system user (orchestrator, internal operations)
    if (userId !== 'system') {
      // Validate ACL: User must have access to this machine
      const access = await this.validateUserMachineAccess(userId, machineId)
      if (!access) {
        this.logger.warn('SessionTokenRejected', {
          reason: 'User has no access to machine',
          userId,
          machineId
        })
        throw new Error('Unauthorized: No access to this machine')
      }
    }

    const sessionId = uuidv4()
    const now = Math.floor(Date.now() / 1000)
    const expiresAt = now + this.SESSION_EXPIRY_SECONDS

    const token: SessionToken = {
      sessionId,
      userId,
      machineId,
      issuedAt: now,
      expiresAt,
      capabilities,
      signature: '' // Will be populated below
    }

    // Sign token with server secret (stored in .env)
    const serverSecret = process.env.SESSION_TOKEN_SECRET || 'default-secret-change-me'
    const msgToSign = JSON.stringify({
      sessionId,
      userId,
      machineId,
      issuedAt: now,
      expiresAt,
      capabilities
    })
    token.signature = crypto
      .createHmac('sha256', serverSecret)
      .update(msgToSign)
      .digest('hex')

    // Store session (for audit trail and cleanup)
    this.activeSessions.set(sessionId, token)
    this.rateLimitBuckets.set(sessionId, {
      sessionId,
      tokensAvailable: this.RATE_LIMIT_TOKENS,
      lastRefillAt: now,
      exceededCount: 0
    })

    // Audit: Session started
    this.logger.info('TerminalSessionStarted', {
      sessionId,
      userId,
      machineId,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
      capabilities
    })

    // Store to database for audit trail
    try {
      await this.prisma.auditLog.create({
        data: {
          action: 'SHELL_OPEN',
          eventType: 'terminal_session_start',
          userId,
          machineId,
          details: JSON.stringify({
            sessionId,
            capabilities,
            expiresAt
          })
        }
      })
    } catch (error) {
      this.logger.error('AuditLogFailed', { error: (error as Error).message })
    }

    return token
  }

  /**
   * Validate and possibly refresh a session token
   * ISO 27001 A.14.1.2: Ongoing authentication validation
   *
   * @param token - Session token to validate
   * @returns true if valid (and optionally refreshed), false if expired/invalid
   */
  async validateSessionToken(token: SessionToken): Promise<boolean> {
    const now = Math.floor(Date.now() / 1000)

    // Check expiry
    if (token.expiresAt <= now) {
      this.logger.warn('SessionTokenExpired', {
        sessionId: token.sessionId,
        userId: token.userId,
        expiresAt: token.expiresAt
      })
      return false
    }

    // Check signature (detect tampering)
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

    if (!this.timingSafeEqual(token.signature, expectedSignature)) {
      this.logger.warn('SessionTokenTampering', {
        sessionId: token.sessionId,
        userId: token.userId
      })
      return false
    }

    // Refresh if close to expiry
    if (now + this.TOKEN_REFRESH_THRESHOLD >= token.expiresAt) {
      token.expiresAt = now + this.SESSION_EXPIRY_SECONDS
      // Re-sign with new expiry
      const newMsgToSign = JSON.stringify({
        sessionId: token.sessionId,
        userId: token.userId,
        machineId: token.machineId,
        issuedAt: token.issuedAt,
        expiresAt: token.expiresAt,
        capabilities: token.capabilities
      })
      token.signature = crypto
        .createHmac('sha256', serverSecret)
        .update(newMsgToSign)
        .digest('hex')

      this.logger.debug('SessionTokenRefreshed', {
        sessionId: token.sessionId,
        newExpiresAt: new Date(token.expiresAt * 1000).toISOString()
      })
    }

    return true
  }

  /**
   * Retrieve session token from active sessions (for validation)
   */
  getSessionToken(sessionId: string): SessionToken | null {
    return this.activeSessions.get(sessionId) || null
  }

  /**
   * Create a secure message wrapper with HMAC, nonce, and timestamp
   * For use in terminal_input, terminal_resize, execute_command
   *
   * ISO 27001 A.14.2.1: Message integrity and authenticity
   * ISO 27001 A.12.6.1: Protection against replay attacks
   */
  async createSecureMessage(
    sessionToken: SessionToken,
    type: 'terminal_input' | 'terminal_resize' | 'execute_command' | 'terminal_spawn',
    payload: string | Record<string, any>,
    agentSecret: string // Machine's registration secret (or hash)
  ): Promise<SecureMessage> {
    // Generate secure random nonce
    const nonce = crypto.randomBytes(16).toString('hex')

    // ISO 8601 timestamp with millisecond precision (server side)
    const timestamp = new Date().toISOString()

    // Construct message to sign (deterministic JSON)
    // Agent expects: type, sessionId, machineId, payload (string), nonce, timestamp

    // Ensure payload is normalized consistently for signing and transport
    let normalizedPayloadObj: Record<string, any> = payload as Record<string, any>
    if (type === 'terminal_resize') {
      const p = payload as { cols: number; rows: number }
      normalizedPayloadObj = { cols: p.cols, rows: p.rows }
    } else if (type === 'execute_command') {
      const p = (payload as { commandId?: string; command?: string }) || {}
      normalizedPayloadObj = {
        commandId: p.commandId ?? '',
        command: p.command ?? ''
      }
    } else if (typeof payload === 'string') {
      // If already a string, parse it back to object for normalization
      try {
        normalizedPayloadObj = JSON.parse(payload)
      } catch (e) {
        // If parse fails, wrap as data
        normalizedPayloadObj = { data: payload }
      }
    }

    // Stringify for transport (this is what agent will receive)
    const payloadString = JSON.stringify(normalizedPayloadObj)

    // Sign with the stringified payload (what agent will reconstruct and verify with)
    const msgToSign = JSON.stringify({
      type,
      sessionId: sessionToken.sessionId,
      machineId: sessionToken.machineId,
      payload: payloadString,
      nonce,
      timestamp
    })

    // Debug logging for HMAC mismatch investigation
    this.logger.debug('HMAC_Signing_Debug', {
      type,
      msgToSign,
      secretPrefix: agentSecret.substring(0, 4),
      secretLength: agentSecret.length
    })

    // Compute HMAC-SHA256
    const hmac = crypto
      .createHmac('sha256', agentSecret)
      .update(Buffer.from(msgToSign, 'utf-8'))
      .digest('hex')
    
    return {
      type,
      sessionToken,
      data: {
        sessionId: sessionToken.sessionId,
        machineId: sessionToken.machineId,
        payload: payloadString, // Always string for transport
        nonce,
        timestamp,
        hmac
      }
    }
  }

  /**
   * Validate secure message (HMAC, timestamp, nonce, replay protection)
   * Called on agent side (or here for server-to-server validation)
   *
   * ISO 27001 A.12.6.1: Prevention of replay attacks
   * ISO 27001 A.14.2.1: Input validation
   */
  async validateSecureMessage(
    message: SecureMessage,
    machineId: string,
    agentSecret: string
  ): Promise<ValidationResult> {
    const now = Date.now()

    // 1. Validate timestamp (max 60 seconds old)
    try {
      const msgTs = new Date(message.data.timestamp).getTime()
      if (Math.abs(now - msgTs) > this.CLOCK_SKEW_TOLERANCE * 1000) {
        this.logger.warn('SecureMessageTimestampOutOfRange', {
          machineId,
          clockSkew: Math.abs(now - msgTs) / 1000
        })
        return { valid: false, reason: 'Timestamp outside acceptable range' }
      }
    } catch (e) {
      return { valid: false, reason: 'Invalid timestamp format' }
    }

    // 2. Validate nonce (replay protection)
    if (!this.recentNonces.has(machineId)) {
      this.recentNonces.set(machineId, new Set())
    }
    const nonces = this.recentNonces.get(machineId)!
    if (nonces.has(message.data.nonce)) {
      this.logger.warn('SecureMessageReplayDetected', {
        machineId,
        sessionId: message.data.sessionId,
        nonce: message.data.nonce.substring(0, 8)
      })
      return { valid: false, reason: 'Replay detected: nonce already used' }
    }

    // 3. Validate HMAC
    // Reconstruct the exact payload string that was signed
    // Agent has payload as string and will sign with it
    const msgToSign = JSON.stringify({
      type: message.type,
      sessionId: message.data.sessionId,
      machineId: message.data.machineId,
      payload: message.data.payload, // This is already a string from transport
      nonce: message.data.nonce,
      timestamp: message.data.timestamp
    })
    const expectedHmac = crypto
      .createHmac('sha256', agentSecret)
      .update(msgToSign)
      .digest('hex')

    if (!this.timingSafeEqual(message.data.hmac, expectedHmac)) {
      this.logger.warn('SecureMessageHmacValidationFailed', {
        machineId,
        sessionId: message.data.sessionId
      })
      return { valid: false, reason: 'HMAC validation failed' }
    }

    // 4. Record nonce
    nonces.add(message.data.nonce)
    if (nonces.size > this.NONCE_HISTORY_SIZE) {
      // Remove oldest entries (FIFO)
      const arr = Array.from(nonces)
      for (let i = 0; i < 1000; i++) {
        nonces.delete(arr[i])
      }
    }

    return { valid: true }
  }

  /**
   * Check and enforce rate limiting per session
   * ISO 27001 A.12.6.1: Protection against DoS attacks
   *
   * @returns true if message is allowed, false if rate limit exceeded
   */
  async enforceRateLimit(sessionId: string): Promise<boolean> {
    let bucket = this.rateLimitBuckets.get(sessionId)
    if (!bucket) {
      bucket = {
        sessionId,
        tokensAvailable: this.RATE_LIMIT_TOKENS,
        lastRefillAt: Math.floor(Date.now() / 1000),
        exceededCount: 0
      }
      this.rateLimitBuckets.set(sessionId, bucket)
    }

    const now = Math.floor(Date.now() / 1000)
    const timeSinceLastRefill = now - bucket.lastRefillAt

    // Refill tokens (1 token per 1/100th of a second = 100 tokens/sec)
    const tokensToAdd = timeSinceLastRefill * this.RATE_LIMIT_TOKENS
    bucket.tokensAvailable = Math.min(
      bucket.tokensAvailable + tokensToAdd,
      this.RATE_LIMIT_TOKENS + this.RATE_LIMIT_BURST
    )
    bucket.lastRefillAt = now

    // Try to consume token
    if (bucket.tokensAvailable >= 1) {
      bucket.tokensAvailable -= 1
      return true
    } else {
      bucket.exceededCount += 1

      // Alert if rate limit hit multiple times
      if (bucket.exceededCount % 10 === 0) {
        this.logger.warn('RateLimitExceeded', {
          sessionId,
          count: bucket.exceededCount
        })
      }

      return false
    }
  }

  /**
   * End a terminal session (on close)
   * ISO 27001 A.12.4.1: Audit logging of session lifecycle
   */
  async endSession(sessionId: string): Promise<void> {
    const token = this.activeSessions.get(sessionId)
    if (!token) return

    const now = Math.floor(Date.now() / 1000)
    const duration = now - token.issuedAt

    this.logger.info('TerminalSessionEnded', {
      sessionId,
      userId: token.userId,
      machineId: token.machineId,
      durationSeconds: duration
    })

    // Audit log
    try {
      await this.prisma.auditLog.create({
        data: {
          action: 'SHELL_CLOSE',
          eventType: 'terminal_session_end',
          userId: token.userId,
          machineId: token.machineId,
          details: JSON.stringify({
            sessionId,
            duration
          })
        }
      })
    } catch (error) {
      this.logger.error('AuditLogFailed', { error: (error as Error).message })
    }

    this.activeSessions.delete(sessionId)
    this.rateLimitBuckets.delete(sessionId)
  }

  /**
   * Get session info (for debugging/monitoring)
   */
  getSessionInfo(sessionId: string): SessionToken | null {
    return this.activeSessions.get(sessionId) || null
  }

  /**
   * Get rate limit info (for monitoring)
   */
  getRateLimitInfo(sessionId: string): RateLimitBucket | null {
    return this.rateLimitBuckets.get(sessionId) || null
  }

  /**
   * Get all active sessions (admin/monitoring)
   */
  getActiveSessions(): SessionToken[] {
    return Array.from(this.activeSessions.values())
  }

  /**
   * Helper: Validate user has access to machine
   * ISO 27001 A.13.1.3: Data isolation and access control
   *
   * TODO: Implement based on your authorization model
   */
  private async validateUserMachineAccess(userId: string, machineId: string): Promise<boolean> {
    // For now, all users can access all machines
    // In production: Check if userId has 'read' or 'admin' role for machineId
    // Example:
    // const role = await this.prisma.machineAccess.findFirst({
    //   where: { userId, machineId }
    // })
    // return !!role
    return true
  }

  /**
   * Helper: Timing-safe string comparison (prevent timing attacks)
   * ISO 27001 A.14.2.5: Secure cryptographic operations
   */
  private timingSafeEqual(a: string, b: string): boolean {
    try {
      return crypto.timingSafeEqual(
        Buffer.from(a, 'hex'),
        Buffer.from(b, 'hex')
      )
    } catch {
      return false
    }
  }

  /**
   * Periodic cleanup of expired data
   * ISO 27001 A.13.2.1: Management of removable media and disposal
   */
  private async cleanupExpiredData(): Promise<void> {
    const now = Math.floor(Date.now() / 1000)

    // Remove expired sessions
    for (const [sessionId, token] of this.activeSessions) {
      if (token.expiresAt <= now) {
        this.activeSessions.delete(sessionId)
        this.rateLimitBuckets.delete(sessionId)
      }
    }

    // Clear old nonces (keep size bounded)
    for (const [machineId, nonces] of this.recentNonces) {
      if (nonces.size > this.NONCE_HISTORY_SIZE) {
        if (nonces.size > this.NONCE_HISTORY_SIZE * 2) {
          this.recentNonces.set(machineId, new Set())
        }
      }
    }

    this.logger.debug('CleanupExpiredData', {
      activeSessions: this.activeSessions.size,
      rateLimitBuckets: this.rateLimitBuckets.size,
      recentNonces: this.recentNonces.size
    })
  }
}
