import { WebSocket } from 'ws'
import { IncomingMessage } from 'http'
import { URL } from 'url'
import { PrismaClient } from '@prisma/client'
import { jwtVerify } from 'jose'
import { ConnectionRegistry } from './ConnectionRegistry'
import { ILogger } from '../types/logger'
import { MessageParser } from '../protocol/parser/MessageParser'
import { MessageValidator } from '../protocol/validator/MessageValidator'
import { MessageRouter } from '../protocol/router/MessageRouter'
import { SecureRemoteTerminalService } from '../domain/services/SecureRemoteTerminalService'
import { SecretEncryptionService } from '../infrastructure/crypto/SecretEncryptionService'
import type { MachineAccess } from './ConnectionRegistry'
// Relative imports only: '@/...' aliases do not resolve in the ts-node custom server
// (which is also why lib/audit.ts cannot be used here).
import { canAccessMachine, getAccessibleMachineIds, type UserRole } from '../lib/authorization'

const VALID_ROLES: UserRole[] = ['admin', 'user', 'viewer']
const ACCESS_REFRESH_MS = 60_000

/** Message types a web client may send, and what each one requires. */
const MESSAGE_POLICY: Record<string, { roles: UserRole[]; machine: boolean }> = {
  spawn_terminal:  { roles: ['admin', 'user'], machine: true },
  terminal_input:  { roles: ['admin', 'user'], machine: true },
  terminal_resize: { roles: ['admin', 'user'], machine: true },
  execute_command: { roles: ['admin', 'user'], machine: true },
  trigger_scan:    { roles: ['admin', 'user'], machine: true },
  update_agent:    { roles: ['admin'],         machine: true },
}

interface AuthenticatedClient {
  userId: string
  username?: string
  role: UserRole
}

/**
 * WebClientConnectionManager - Manages WebSocket connections from web clients
 * 
 * ISO 27001 Compliance:
 * - A.14.2.1: Input Validation - All client messages validated via Protocol Layer
 * - A.14.1.2: User Identification - JWT tokens validated before connection
 * - A.13.1.3: Network segmentation - Web clients isolated from agent communication
 * 
 * Architecture:
 * Raw WebSocket Data → JWT Auth → Parser → Validator → Router → Agent Dispatch
 */
export class WebClientConnectionManager {
  private parser: MessageParser
  private validator: MessageValidator
  private router: MessageRouter
  // browser socket -> terminal sessionIds opened from it (ended when that socket closes)
  private socketSessions: Map<WebSocket, Set<string>> = new Map()
  private secretEncryption!: SecretEncryptionService
  private accessRefreshTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly prisma: PrismaClient,
    private readonly registry: ConnectionRegistry,
    private readonly broadcast: (data: any) => void,
    private readonly jwtSecret: () => Promise<string>,
    private readonly logger: ILogger,
    private readonly terminalService: SecureRemoteTerminalService
  ) {
    // Initialize Protocol Layer components
    this.parser = new MessageParser(logger)
    this.validator = new MessageValidator(logger)
    this.router = new MessageRouter(logger)
    
    // Initialize encryption service (will be async initialized)
    this.initializeEncryption()

    // Register handlers for all web client message types
    this.registerHandlers()

    // Keep role + machine access of connected clients fresh (role changes,
    // revoked access, deactivated users take effect within a minute).
    this.accessRefreshTimer = setInterval(() => {
      this.refreshAllClients().catch((error) =>
        this.logger.warn('WebClientAccessRefreshFailed', { error: (error as Error).message })
      )
    }, ACCESS_REFRESH_MS)
    this.accessRefreshTimer.unref?.()
  }

  /** Stop background timers (tests / shutdown). */
  dispose(): void {
    if (this.accessRefreshTimer) clearInterval(this.accessRefreshTimer)
    this.accessRefreshTimer = null
  }

  /** Load role/active flag from the DB. Returns null for unknown or inactive users. */
  private async auditDenied(userId: string, machineId: string | undefined, details: Record<string, unknown>): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action: 'MACHINE_ACCESS_DENIED',
          userId,
          machineId: machineId ?? null,
          severity: 'warn',
          details: JSON.stringify(details),
        },
      })
    } catch {
      // auditing must never break request handling (e.g. unknown machineId FK)
    }
  }

  private async loadClientUser(userId: string): Promise<{ role: UserRole; username: string } | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, active: true, username: true },
    })
    if (!user || !user.active) return null
    const role = VALID_ROLES.includes(user.role as UserRole) ? (user.role as UserRole) : 'viewer'
    return { role, username: user.username }
  }

  private async loadMachineAccess(userId: string, role: UserRole): Promise<MachineAccess> {
    const ids = await getAccessibleMachineIds(userId, role)
    return ids === 'all' ? 'all' : new Set(ids)
  }

  private async refreshAllClients(): Promise<void> {
    for (const [ws, info] of Array.from(this.registry.listWebClientEntries())) {
      const user = await this.loadClientUser(info.userId)
      if (!user) {
        this.logger.warn('WebClientRevoked', { userId: info.userId })
        try { ws.close(1008, 'Unauthorized') } catch {}
        this.registry.deleteWebClient(ws)
        continue
      }
      const machineAccess = await this.loadMachineAccess(info.userId, user.role)
      this.registry.updateWebClient(ws, { role: user.role, machineAccess, accessLoadedAt: Date.now() })
    }
  }

  /**
   * Authorize a web client message before it is routed.
   * Role comes from the (periodically refreshed) DB state, not the JWT.
   * Privileged one-shot actions re-check machine access against the DB;
   * high-frequency terminal input relies on the cached access + session ownership.
   */
  private async authorizeMessage(ws: WebSocket, client: AuthenticatedClient, type: string, data: any): Promise<string | null> {
    const policy = MESSAGE_POLICY[type]
    if (!policy) return 'unsupported message type'

    const info = this.registry.getWebClient(ws)
    const role = info?.role ?? client.role
    if (!policy.roles.includes(role)) return `role ${role} not allowed`

    if (policy.machine) {
      const machineId = typeof data?.machineId === 'string' ? data.machineId : ''
      if (!machineId) return 'machineId missing'

      if (type === 'terminal_input' || type === 'terminal_resize') {
        if (!this.registry.canClientSeeMachine(ws, machineId)) return 'no machine access'
        const sessionId = data?.sessionId
        if (this.registry.getTerminalSession(sessionId) !== machineId) return 'session does not belong to machine'
        if (this.registry.getTerminalOwner(sessionId) !== ws) return 'session not owned by this connection'
      } else {
        if (!(await canAccessMachine(client.userId, role, machineId))) return 'no machine access'
      }
    }
    return null
  }

  private async initializeEncryption() {
    const secret = await this.jwtSecret()
    this.secretEncryption = new SecretEncryptionService(secret)
  }

  /**
   * Register all handlers for web client message types
   * ISO 27001 A.14.2.1: Input validation before handler execution
   */
  private registerHandlers(): void {
    // Spawn terminal handler
    this.router.register('spawn_terminal', async (data: any) => {
      await this.handleSpawnTerminal(data)
    })

    // Terminal input handler
    this.router.register('terminal_input', async (data: any) => {
      await this.handleTerminalInput(data)
    })

    // Terminal resize handler
    this.router.register('terminal_resize', async (data: any) => {
      await this.handleTerminalResize(data)
    })

    // Execute command handler
    this.router.register('execute_command', async (data: any) => {
      await this.handleExecuteCommand(data)
    })

    // Update agent handler
    this.router.register('update_agent', async (data: any) => {
      await this.handleUpdateAgent(data)
    })

    // Trigger scan handler
    this.router.register('trigger_scan', async (data: any) => {
      await this.handleTriggerScan(data)
    })
  }

  /**
   * Handle WebSocket connection from web client
   * Protocol Layer Integration: JWT Auth → Parser → Validator → Router
   */
  async handleConnection(ws: WebSocket, request: IncomingMessage): Promise<void> {
    this.logger.info('WebClientConnecting', { url: request.url })

    // Step 1: Authenticate via JWT
    const token = await this.authenticate(request)
    if (!token) {
      this.logger.warn('WebClientAuthenticationFailed', { url: request.url })
      ws.close(1008, 'Unauthorized')
      return
    }

    // Step 1b: Resolve role + machine access from the DB (user must exist and be active)
    let session: AuthenticatedClient
    try {
      const user = await this.loadClientUser(token.userId)
      if (!user) {
        this.logger.warn('WebClientUserInactiveOrUnknown', { userId: token.userId })
        ws.close(1008, 'Unauthorized')
        return
      }
      session = { userId: token.userId, username: user.username, role: user.role }
      const machineAccess = await this.loadMachineAccess(session.userId, session.role)
      this.registry.setWebClient(ws, {
        userId: session.userId,
        username: session.username,
        role: session.role,
        machineAccess,
        accessLoadedAt: Date.now(),
      })
    } catch (error) {
      this.logger.error('WebClientAuthorizationLoadFailed', { error: (error as Error).message })
      ws.close(1011, 'Internal error')
      return
    }
    this.logger.info('WebClientAuthenticated', { userId: session.userId, username: session.username, role: session.role })

    let currentParser = new MessageParser(this.logger)

    ws.on('message', async (data) => {
      try {
        // Step 2: Parse incoming data
        const message = currentParser.parse(data)
        if (!message) {
          return // Incomplete message
        }

        const messageType = message.data?.type
        if (!messageType) {
          this.logger.warn('WebClientMessageMissingType', { sample: JSON.stringify(message.data).slice(0, 80) })
          return
        }

        // Step 3: Validate message against schema
        const validationResult = this.validator.validate(message.data, messageType)
        if (!validationResult.valid) {
          this.logger.warn('WebClientMessageValidationFailed', { type: messageType, errors: validationResult.errors })
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }))
          return
        }

        // Step 4: Authorize (role + machine access) before anything reaches an agent
        const denied = await this.authorizeMessage(ws, session, messageType, validationResult.data)
        if (denied) {
          this.logger.warn('WebClientMessageForbidden', {
            type: messageType,
            userId: session.userId,
            machineId: validationResult.data?.machineId,
            reason: denied,
          })
          if (messageType !== 'terminal_input' && messageType !== 'terminal_resize') {
            await this.auditDenied(session.userId, validationResult.data?.machineId, { reason: denied, type: messageType, channel: 'websocket' })
          }
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'error', message: 'Forbidden', requestType: messageType }))
          }
          return
        }

        // Step 5: Route validated message to handler
        try {
          const enrichedData = {
            ...validationResult.data,
            userId: session.userId,
            username: session.username,
            clientWs: ws
          }
          await this.router.route(messageType, enrichedData)
        } catch (error) {
          this.logger.error('WebClientMessageHandlingFailed', {
            type: messageType,
            error: (error as Error).message
          })
          ws.send(JSON.stringify({ type: 'error', message: 'Failed to process message' }))
        }
      } catch (error) {
        this.logger.error('WebClientMessageError', { error: (error as Error).message })
      }
    })

    ws.on('close', async () => {
      this.logger.info('WebClientDisconnected', { userId: session.userId })

      // End the terminal sessions opened from this socket (other tabs keep theirs)
      await this.cleanupSocketSessions(ws, session.userId)

      this.registry.deleteWebClient(ws)
    })

    ws.on('error', async (error) => {
      this.logger.error('WebClientSocketError', { error: (error as Error).message })
      await this.cleanupSocketSessions(ws, session.userId)
      this.registry.deleteWebClient(ws)
    })
  }

  /**
   * Handle spawn terminal request
   * ISO 27001 A.14.2.1: Validates machineId and sessionId
   * Secure Terminal Service: Issues session token, creates secure message envelope
   */
  private async handleSpawnTerminal(data: any): Promise<void> {
    const { machineId, userId } = data
    const clientWs: WebSocket | undefined = data.clientWs

    if (!machineId || !userId || !clientWs) {
      this.logger.warn('SpawnTerminalMissingFields', { machineId, userId })
      return
    }

    const agentWs = this.registry.getMachine(machineId)
    if (!agentWs || agentWs.readyState !== 1) {
      this.logger.warn('AgentNotConnected', { machineId })
      return
    }

    try {
      // Step 1: Issue session token via SecureRemoteTerminalService
      const sessionToken = await this.terminalService.issueSessionToken(
        userId,
        machineId,
        ['terminal_input', 'terminal_resize']
      )
      this.logger.info('SessionTokenIssued', { sessionId: sessionToken.sessionId, userId, machineId })

      // Step 2: Store session mapping for cleanup when this socket disconnects
      if (!this.socketSessions.has(clientWs)) {
        this.socketSessions.set(clientWs, new Set())
      }
      this.socketSessions.get(clientWs)!.add(sessionToken.sessionId)

      // Step 3: Register terminal session; output is delivered only to this socket
      this.registry.setTerminalSession(sessionToken.sessionId, machineId, clientWs)

      // Step 4: Send spawn_shell to agent with secure envelope
      agentWs.send(
        JSON.stringify({
          type: 'spawn_shell',
          data: {
            sessionId: sessionToken.sessionId,
            sessionToken: sessionToken
          }
        })
      )

      // Step 5: Send session info back to the requesting socket
      if (clientWs.readyState === 1) {
        clientWs.send(
          JSON.stringify({
            type: 'terminal_session_created',
            sessionId: sessionToken.sessionId,
            machineId,
            expiresAt: sessionToken.expiresAt
          })
        )
      }

      this.logger.info('SpawnTerminalSuccess', { machineId, sessionId: sessionToken.sessionId })
    } catch (error) {
      this.logger.error('SpawnTerminalFailed', {
        machineId,
        userId,
        error: (error as Error).message
      })
    }
  }

  /**
   * Handle terminal input from web client
   * ISO 27001 A.14.2.1: Validates sessionId and data
   * Secure Terminal Service: Enforces rate limiting, wraps with HMAC
   */
  private async handleTerminalInput(data: any): Promise<void> {
    const { machineId, sessionId, userId } = data
    const input = data.input ?? data.data

    if (!machineId || !sessionId || !userId) {
      this.logger.warn('TerminalInputMissingFields', { machineId, sessionId, userId })
      return
    }

    if (input === undefined || input === null) {
      this.logger.warn('TerminalInputMissingData', { machineId, sessionId })
      return
    }

    const agentWs = this.registry.getMachine(machineId)
    if (!agentWs || agentWs.readyState !== 1) {
      this.logger.warn('AgentNotConnected', { machineId })
      return
    }

    try {
      // Step 1: Enforce rate limiting
      const rateLimited = await this.terminalService.enforceRateLimit(sessionId)
      if (!rateLimited) {
        this.logger.warn('TerminalInputRateLimited', { sessionId, userId })
        return
      }

      // Step 2: Get stored session token
      const sessionToken = await this.terminalService.getSessionToken(sessionId)
      if (!sessionToken) {
        this.logger.warn('TerminalInputSessionNotFound', { sessionId })
        return
      }

      // Step 3: Verify user owns this session
      if (sessionToken.userId !== userId) {
        this.logger.warn('TerminalInputUnauthorizedUser', { sessionId, userId, ownerUserId: sessionToken.userId })
        return
      }

      // Step 4: Get machine secret for HMAC
      const machine = await this.prisma.machine.findUnique({
        where: { id: machineId },
        select: { secretKey: true }
      })

      if (!machine || !machine.secretKey) {
        this.logger.warn('TerminalInputMachineSecretNotFound', { machineId })
        return
      }

      // Decrypt the secret before using it for HMAC
      const plainSecret = this.secretEncryption.decrypt(machine.secretKey)

      // Step 5: Create secure message with HMAC
    // Ensure input is a string to match agent expectation and HMAC signature
    const inputStr = typeof input === 'string' ? input : String(input || '')
    
    const secureMessage = await this.terminalService.createSecureMessage(
      sessionToken,
      'terminal_input',
      { data: inputStr },
      plainSecret
    )

      this.logger.debug('TerminalInputWrapped', {
        sessionId,
        inputSize: String(input).length,
        nonce: secureMessage.data.nonce.substring(0, 8) + '...'
      })

      // Step 6: Send to agent with HMAC protection
      agentWs.send(
        JSON.stringify({
          type: 'terminal_stdin',
          data: secureMessage.data
        })
      )
    } catch (error) {
      this.logger.error('TerminalInputFailed', {
        sessionId,
        error: (error as Error).message
      })
    }
  }

  /**
   * Handle terminal resize request
   * ISO 27001 A.14.2.1: Validates dimensions
   * Secure Terminal Service: Rate limiting, HMAC wrapping
   */
  private async handleTerminalResize(data: any): Promise<void> {
    const { machineId, sessionId, userId, cols, rows } = data

    if (!machineId || !sessionId || !userId || !cols || !rows) {
      this.logger.warn('TerminalResizeMissingFields', { machineId, sessionId, cols, rows })
      return
    }

    const agentWs = this.registry.getMachine(machineId)
    if (!agentWs || agentWs.readyState !== 1) {
      this.logger.warn('AgentNotConnected', { machineId })
      return
    }

    try {
      // Step 1: Enforce rate limiting
      const rateLimited = await this.terminalService.enforceRateLimit(sessionId)
      if (!rateLimited) {
        this.logger.warn('TerminalResizeRateLimited', { sessionId })
        return
      }

      // Step 2: Get session token and verify ownership
      const sessionToken = await this.terminalService.getSessionToken(sessionId)
      if (!sessionToken || sessionToken.userId !== userId) {
        this.logger.warn('TerminalResizeUnauthorized', { sessionId, userId })
        return
      }

      // Step 3: Get machine secret
      const machine = await this.prisma.machine.findUnique({
        where: { id: machineId },
        select: { secretKey: true }
      })

      if (!machine || !machine.secretKey) {
        this.logger.warn('TerminalResizeMachineSecretNotFound', { machineId })
        return
      }

      // Decrypt the secret before using it for HMAC
      const plainSecret = this.secretEncryption.decrypt(machine.secretKey)

      // Ensure cols/rows are numbers
      const colsNum = Number(cols)
      const rowsNum = Number(rows)
      const payload = { cols: colsNum, rows: rowsNum }

      // Step 4: Create secure message with HMAC
      const secureMessage = await this.terminalService.createSecureMessage(
        sessionToken,
        'terminal_resize',
        payload,
        plainSecret
      )

      // Step 5: Send to agent with HMAC protection
      agentWs.send(
        JSON.stringify({
          type: 'terminal_resize',
          data: secureMessage.data
        })
      )

      this.logger.debug('TerminalResizeSuccess', { sessionId, cols, rows })
    } catch (error) {
      this.logger.error('TerminalResizeFailed', {
        sessionId,
        error: (error as Error).message
      })
    }
  }

  /**
   * Handle execute command request
   * ISO 27001 A.14.2.1: Validates commandId and command
   */
  private async handleExecuteCommand(data: any): Promise<void> {
    const { machineId, commandId, command, userId } = data

    if (!machineId || !command || !userId) {
      this.logger.warn('ExecuteCommandMissingFields', { machineId, commandId, userId })
      return
    }

    const agentWs = this.registry.getMachine(machineId)
    if (!agentWs || agentWs.readyState !== 1) {
      this.logger.warn('AgentNotConnected', { machineId })
      return
    }

    // Lookup machine secret and decrypt
    const machine = await this.prisma.machine.findUnique({
      where: { id: machineId },
      select: { secretKey: true }
    })

    if (!machine || !machine.secretKey) {
      this.logger.warn('ExecuteCommandMachineSecretNotFound', { machineId })
      return
    }

    const plainSecret = this.secretEncryption.decrypt(machine.secretKey)

    // Issue session token for execute_command capability
    const sessionToken = await this.terminalService.issueSessionToken(userId, machineId, ['execute_command'])

    // Build secure message with deterministic payload
    const secureMessage = await this.terminalService.createSecureMessage(
      sessionToken,
      'execute_command',
      { commandId, command },
      plainSecret
    )

    if (commandId) {
      this.registry.setCommandSession(commandId, machineId)
    }

    this.logger.info('ExecuteCommandSecure', { machineId, commandId, command: command.slice(0, 100) })

    agentWs.send(
      JSON.stringify({
        type: 'execute_command',
        data: secureMessage.data
      })
    )
  }

  /**
   * Handle update agent request
   */
  private async handleUpdateAgent(data: any): Promise<void> {
    const { machineId, commandId, serverUrl } = data

    if (!machineId || !serverUrl) {
      this.logger.warn('UpdateAgentMissingFields', { machineId })
      return
    }

    const agentWs = this.registry.getMachine(machineId)
    if (!agentWs || agentWs.readyState !== 1) {
      this.logger.warn('AgentNotConnected', { machineId })
      return
    }

    this.logger.info('UpdateAgentTriggered', { machineId, serverUrl })

    agentWs.send(
      JSON.stringify({
        type: 'update_agent',
        data: { commandId, serverUrl }
      })
    )
  }

  /**
   * Handle security scan trigger
   */
  private async handleTriggerScan(data: any): Promise<void> {
    const { machineId } = data

    if (!machineId) {
      this.logger.warn('TriggerScanMissingMachineId')
      return
    }

    const agentWs = this.registry.getMachine(machineId)
    if (!agentWs || agentWs.readyState !== 1) {
      this.logger.warn('AgentNotConnected', { machineId })
      return
    }

    this.logger.info('ScanTriggered', { machineId })

    agentWs.send(JSON.stringify({ type: 'trigger_scan', data: {} }))
  }

  /**
   * Authenticate web client via JWT token
   * ISO 27001 A.14.1.2: User identification and authentication
   */
  private async authenticate(request: IncomingMessage): Promise<{ userId: string; username?: string } | null> {
    const token = this.extractToken(request)
    if (!token) {
      this.logger.warn('WebClientNoToken', { url: request.url })
      return null
    }

    try {
      const secret = await this.jwtSecret()
      const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
        issuer:   process.env.JWT_ISSUER   || 'maintainer.local',
        audience: process.env.JWT_AUDIENCE || 'maintainer.clients',
      })

      // Extract userId and username from token payload
      const userId =
        (payload as any).user?.id ||
        (payload as any).userId ||
        (payload as any).sub ||
        (payload as any).user_id

      const username =
        (payload as any).user?.username ||
        (payload as any).username ||
        (payload as any).name ||
        (payload as any).email

      if (!userId) {
        this.logger.warn('WebClientTokenMissingUserId', { payload: Object.keys(payload) })
        return null
      }

      this.logger.debug('WebClientTokenVerified', { userId, username })
      return { userId: String(userId), username: username ? String(username) : undefined }
    } catch (error) {
      this.logger.warn('WebClientTokenVerificationFailed', { error: (error as Error).message })
      return null
    }
  }

  /**
   * Extract JWT token from request headers, query, or cookies
   * ISO 27001 A.14.1.2: Supports multiple token delivery methods
   */
  private extractToken(request: IncomingMessage): string | null {
    // Try Authorization header
    const authHeader = request.headers['authorization']
    if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
      this.logger.debug('TokenExtractedFromAuthHeader')
      return authHeader.slice(7)
    }

    // Try query string
    const url = request.url ? new URL(request.url, 'http://localhost') : null
    const tokenFromQuery = url?.searchParams.get('token')
    if (tokenFromQuery) {
      this.logger.debug('TokenExtractedFromQuery')
      return tokenFromQuery
    }

    // Try cookies
    const cookieHeader = request.headers['cookie']
    if (cookieHeader) {
      const cookies = Object.fromEntries(cookieHeader.split(';').map((c) => c.trim().split('=')))
      if (cookies['session']) {
        this.logger.debug('TokenExtractedFromCookie')
        return cookies['session']
      }
    }

    // Try WebSocket subprotocol header
    const protocolHeader = request.headers['sec-websocket-protocol']
    if (typeof protocolHeader === 'string' && protocolHeader.startsWith('jwt.')) {
      this.logger.debug('TokenExtractedFromProtocol')
      return protocolHeader.replace(/^jwt\./, '')
    }

    this.logger.debug('NoTokenFound', { url: request.url })
    return null
  }

  /**
   * Cleanup user sessions on disconnect
   * ISO 27001 A.12.4.1: End all terminal sessions for user
   */
  private async cleanupSocketSessions(ws: WebSocket, userId: string): Promise<void> {
    const sessionIds = this.socketSessions.get(ws)
    this.socketSessions.delete(ws)
    if (!sessionIds || sessionIds.size === 0) {
      return
    }

    for (const sessionId of sessionIds) {
      this.registry.deleteTerminalSession(sessionId)
      try {
        await this.terminalService.endSession(sessionId)
        this.logger.debug('SessionEndedOnDisconnect', { sessionId, userId })
      } catch (error) {
        this.logger.error('SessionEndFailed', {
          sessionId,
          error: (error as Error).message
        })
      }
    }

    this.logger.info('UserSessionsCleanedUp', { userId, sessionCount: sessionIds.size })
  }
}
