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
  private userSessions: Map<string, Set<string>> = new Map() // userId -> Set of sessionIds
  private secretEncryption!: SecretEncryptionService

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
    const session = await this.authenticate(request)
    if (!session) {
      this.logger.warn('WebClientAuthenticationFailed', { url: request.url })
      ws.close(1008, 'Unauthorized')
      return
    }

    // Register authenticated session
    this.registry.setWebClient(ws, { userId: session.userId, username: session.username })
    this.logger.info('WebClientAuthenticated', { userId: session.userId, username: session.username })

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

        // Step 4: Route validated message to handler
        try {
          const enrichedData = {
            ...validationResult.data,
            userId: session.userId,
            username: session.username
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

      // Cleanup user sessions (end all terminal sessions for this user)
      await this.cleanupUserSessions(session.userId)

      this.registry.deleteWebClient(ws)
    })

    ws.on('error', async (error) => {
      this.logger.error('WebClientSocketError', { error: (error as Error).message })
      await this.cleanupUserSessions(session.userId)
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

    if (!machineId || !userId) {
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

      // Step 2: Store session mapping for cleanup on disconnect
      if (!this.userSessions.has(userId)) {
        this.userSessions.set(userId, new Set())
      }
      this.userSessions.get(userId)!.add(sessionToken.sessionId)

      // Step 3: Register terminal session
      this.registry.setTerminalSession(sessionToken.sessionId, machineId)

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

      // Step 5: Send session info back to web client
      const webClientWs = this.registry.getWebClientByUserId(userId)
      if (webClientWs && webClientWs.readyState === 1) {
        webClientWs.send(
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
      const { payload } = await jwtVerify(token, new TextEncoder().encode(secret))

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
  private async cleanupUserSessions(userId: string): Promise<void> {
    const sessionIds = this.userSessions.get(userId)
    if (!sessionIds || sessionIds.size === 0) {
      return
    }

    for (const sessionId of sessionIds) {
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

    this.userSessions.delete(userId)
    this.logger.info('UserSessionsCleanedUp', { userId, sessionCount: sessionIds.size })
  }
}
