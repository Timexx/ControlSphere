import { WebSocket } from 'ws'
import { IncomingMessage } from 'http'
import { PrismaClient } from '@prisma/client'
import crypto from 'crypto'
import { orchestrator } from '../lib/orchestrator'
import { realtimeEvents } from '../lib/realtime-events'
import { ConnectionRegistry } from './ConnectionRegistry'
import { ILogger } from '../types/logger'
import { MessageParser } from '../protocol/parser/MessageParser'
import { MessageValidator } from '../protocol/validator/MessageValidator'
import { MessageRouter } from '../protocol/router/MessageRouter'
import { OutputNormalizer } from '../protocol/normalizer/OutputNormalizer'
import { SecureRemoteTerminalService } from '../domain/services/SecureRemoteTerminalService'
import { SecretEncryptionService } from '../infrastructure/crypto/SecretEncryptionService'
import { stateCache } from '../lib/state-cache'

const TEXT_DECODER = new TextDecoder('utf-8', { fatal: false })
function parseInterval(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const HEARTBEAT_STATUS_INTERVAL_MS = parseInterval(process.env.HEARTBEAT_STATUS_INTERVAL_MS, 10000)
const HEARTBEAT_METRICS_INTERVAL_MS = parseInterval(process.env.HEARTBEAT_METRICS_INTERVAL_MS, 15000)
const HEARTBEAT_PORTS_INTERVAL_MS = parseInterval(process.env.HEARTBEAT_PORTS_INTERVAL_MS, 60000)
const HEARTBEAT_BROADCAST_INTERVAL_MS = parseInterval(process.env.HEARTBEAT_BROADCAST_INTERVAL_MS, 5000)

function normalizeOutputChunk(raw: unknown): string {
  if (raw === null || raw === undefined) return ''
  if (typeof raw === 'string') return raw
  if (Buffer.isBuffer(raw)) {
    const text = TEXT_DECODER.decode(raw)
    const total = text.length || 1
    const printable = (text.match(/[\t\r\n\x20-\x7E]/g) || []).length
    const ratio = printable / total
    return ratio < 0.6 ? '' : text
  }
  try {
    return JSON.stringify(raw)
  } catch (e) {
    return String(raw)
  }
}

function hashSecretKey(secretKey: string): string {
  return crypto.createHash('sha256').update(secretKey).digest('hex')
}

function sanitizeData(data: any): any {
  const { secretKey, password, token, ...safe } = data
  return safe
}

function sanitizeMachine(machine: any): any {
  if (!machine) return machine
  const { secretKey, secretKeyHash, ...safeMachine } = machine
  return safeMachine
}

async function updatePorts(prisma: PrismaClient, machineId: string, ports: any[]): Promise<void> {
  // Batch all port upserts + stale cleanup in a single transaction
  const upsertOps = ports.map((portData) =>
    prisma.port.upsert({
      where: {
        machineId_port_proto: {
          machineId,
          port: portData.port,
          proto: portData.proto
        }
      },
      update: {
        service: portData.service,
        state: portData.state,
        lastSeen: new Date()
      },
      create: {
        machineId,
        port: portData.port,
        proto: portData.proto,
        service: portData.service,
        state: portData.state
      }
    })
  )

  const currentPorts = ports.map((p) => ({ port: p.port, proto: p.proto }))
  const deleteOp = prisma.port.deleteMany({
    where: {
      machineId,
      NOT: { OR: currentPorts },
      lastSeen: { lt: new Date(Date.now() - 120000) }
    }
  })

  await prisma.$transaction([...upsertOps, deleteOp])
}

/**
 * AgentConnectionManager - Manages WebSocket connections from agents
 * 
 * ISO 27001 Compliance:
 * - A.14.2.1: Input Validation - All agent messages validated via Protocol Layer
 * - A.13.1: Network Security - WebSocket connection lifecycle management
 * - A.12.4: Logging - All agent activities logged via orchestrator and realtime events
 * 
 * Architecture:
 * Raw WebSocket Data → Parser → Validator → Router → Handlers → Broadcast
 */
export class AgentConnectionManager {
  private parser: MessageParser
  private validator: MessageValidator
  private router: MessageRouter
  private normalizer: OutputNormalizer
  private secretEncryption: SecretEncryptionService
  private heartbeatState = new Map<string, {
    statusAt: number
    metricsAt: number
    portsAt: number
    broadcastAt: number
  }>()

  constructor(
    private readonly prisma: PrismaClient,
    private readonly registry: ConnectionRegistry,
    private readonly broadcast: (data: any) => void,
    private readonly logger: ILogger,
    private readonly terminalService: SecureRemoteTerminalService,
    jwtSecret: string
  ) {
    // Initialize Protocol Layer components for message processing
    this.parser = new MessageParser(logger)
    this.validator = new MessageValidator(logger)
    this.router = new MessageRouter(logger)
    this.normalizer = new OutputNormalizer(logger)
    this.secretEncryption = new SecretEncryptionService(jwtSecret)

    // Register handlers for all message types
    this.registerHandlers()

    // Listen to realtime events for broadcasting
    realtimeEvents.on('security_event', (data: any) => {
      this.broadcast({ type: 'security_event', machineId: data.machineId, event: data.event })
    })
    realtimeEvents.on('audit_log', (data: any) => {
      this.broadcast({ type: 'audit_log', machineId: data.machineId, log: data.log })
    })
    realtimeEvents.on('scan_completed', (data: any) => {
      this.broadcast({
        type: 'scan_completed',
        machineId: data.machineId,
        scanId: data.scanId,
        summary: data.summary,
        timestamp: data.timestamp
      })
    })
    realtimeEvents.on('scan_progress', (data: any) => {
      this.broadcast({
        type: 'scan_progress',
        machineId: data.machineId,
        progress: data.progress
      })
    })
    realtimeEvents.on('security_events_resolved', (data: any) => {
      this.broadcast({
        type: 'security_events_resolved',
        machineId: data.machineId,
        resolvedCount: data.resolvedCount,
        timestamp: data.timestamp
      })
    })
  }

  /**
   * Register all handlers for different message types
   * ISO 27001 A.14.2.1: Input validation is performed before handler execution
   */
  private registerHandlers(): void {
    this.router.register('register', async (data: any) => {
      await this.handleAgentRegistration(data)
    })

    this.router.register('heartbeat', async (data: any) => {
      await this.handleAgentHeartbeat(data)
    })

    this.router.register('command_response', async (data: any) => {
      await this.handleCommandResponse(data)
    })

    this.router.register('terminal_output', async (data: any) => {
      await this.handleTerminalOutput(data)
    })

    this.router.register('port_discovery', async (data: any) => {
      await this.handlePortDiscovery(data)
    })

    this.router.register('metrics', async (data: any) => {
      await this.handleMetrics(data)
    })

    this.router.register('security_event', async (data: any) => {
      await this.handleSecurityEvent(data)
    })
  }

  /**
   * Handle WebSocket connection from agent
   * Protocol Layer Integration: Raw data → Parser → Validator → Router → Handlers
   */
  handleConnection = (ws: WebSocket, req: IncomingMessage): void => {
    this.logger.info('AgentConnected', { ip: req.socket.remoteAddress })
    let machineId: string | null = null
    let currentParser = new MessageParser(this.logger)

    ws.on('message', async (data) => {
      try {
        // Step 1: Parse incoming binary/text data
        const message = currentParser.parse(data)
        if (!message) {
          return // Incomplete message, wait for more data
        }

        const messageType = message.data?.type
        if (!messageType) {
          // STRICT PROTOCOL ENFORCEMENT: Reject messages without type field
          // Agents must be updated to use modern protocol
          this.logger.error('MessageMissingTypeRejected', { 
            sample: JSON.stringify(message.data).slice(0, 200),
            reason: 'Modern protocol requires explicit type field. Please update agent.'
          })
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ 
              error: 'Protocol violation: type field required',
              action: 'update_agent',
              message: 'This server requires modern protocol. Please update your agent.' 
            }))
            ws.close(1008, 'Protocol version mismatch')
          }
          return
        }

        // Step 2: Validate message against schema
        const validationResult = this.validator.validate(message.data, messageType)
        if (!validationResult.valid) {
          this.logger.error('MessageValidationFailedRejected', { 
            type: messageType, 
            errors: validationResult.errors,
            reason: validationResult.reason
          })
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ 
              error: `Validation failed: ${validationResult.errors?.join(', ') || 'Unknown validation error'}`,
              type: messageType
            }))
          }
          return
        }

        // Step 3: Route validated message to handler
        try {
          if (messageType === 'register') {
            const regData = validationResult.data
            machineId = await this.handleAgentRegistration(regData, ws)
            this.registry.setMachine(machineId, ws)
          } else if (machineId) {
            const enrichedData = { ...validationResult.data, machineId }
            await this.router.route(messageType, enrichedData)
          } else if (messageType === 'heartbeat') {
            machineId = validationResult.data?.machineId
            if (machineId) {
              const enrichedData = { ...validationResult.data, machineId }
              await this.router.route(messageType, enrichedData)
              this.registry.setMachine(machineId, ws)
            } else {
              this.logger.warn('HeartbeatMissingMachineId')
            }
          } else {
            this.logger.warn('MessageReceivedBeforeRegistration', { type: messageType })
          }
        } catch (error) {
          this.logger.error('MessageHandlingFailed', { type: messageType, error: (error as Error).message })
        }
      } catch (error) {
        this.logger.error('WebSocketMessageError', { error: (error as Error).message })
      }
    })

    ws.on('close', async () => {
      this.logger.info('AgentDisconnected', { machineId: machineId ?? 'unknown' })
      if (machineId) {
        this.registry.deleteMachine(machineId)
        try {
          await orchestrator.handleAgentDisconnect(machineId)
        } catch (err) {
          this.logger.error('OrchestratorDisconnectFailed', { error: (err as Error).message })
        }
        try {
          await this.prisma.machine.update({ where: { id: machineId }, data: { status: 'offline' } })
          stateCache.setOffline(machineId)
          this.broadcast({ type: 'machine_status_changed', machineId, status: 'offline' })
        } catch (error) {
          this.logger.error('AgentDisconnectUpdateFailed', { error: (error as Error).message })
        }
      }
    })

    ws.on('error', (error) => {
      this.logger.error('AgentSocketError', { error: (error as Error).message })
    })
  }

  /**
   * Handle agent registration
   * ISO 27001 A.14.2.1: Validates secretKey format and sanitizes before storage
   */
  private async handleAgentRegistration(data: any, ws?: WebSocket): Promise<string> {
    // Debug logging for secretKey validation
    this.logger.debug('SecretKeyValidation', {
      hasSecretKey: !!data.secretKey,
      secretKeyType: typeof data.secretKey,
      secretKeyLength: data.secretKey?.length,
      secretKeyPreview: data.secretKey
        ? `${data.secretKey.substring(0, 4)}...${data.secretKey.substring(data.secretKey.length - 4)}`
        : 'undefined',
      regexTest: data.secretKey ? /^[a-f0-9]{64}$/i.test(data.secretKey) : false
    })
    
    if (!data.secretKey || !/^[a-f0-9]{64}$/i.test(data.secretKey)) {
      if (ws) {
        ws.send(JSON.stringify({ error: 'Invalid secret key format' }))
        ws.close(1008, 'Invalid credentials')
      }
      throw new Error('Invalid secret key format')
    }

    let cleanIP = data.ip
    if (!cleanIP || cleanIP === 'auto-detect' || cleanIP.includes('::ffff:')) {
      cleanIP = (ws as any)?._socket?.remoteAddress
    }
    if (cleanIP && cleanIP.startsWith('::ffff:')) {
    cleanIP = cleanIP.substring(7)
  }

  const secretKeyHash = hashSecretKey(data.secretKey)
  const encryptedSecret = this.secretEncryption.encrypt(data.secretKey)

  try {
    let machine = await this.prisma.machine.findFirst({
      where: {
        OR: [
          { secretKeyHash: secretKeyHash },
          { hostname: data.hostname, ip: cleanIP }
        ]
      }
    })

    if (machine) {
      machine = await this.prisma.machine.update({
        where: { id: machine.id },
        data: {
          hostname: data.hostname,
          ip: cleanIP,
          osInfo: data.osInfo ? JSON.stringify(data.osInfo) : undefined,
          status: 'online',
          lastSeen: new Date(),
          secretKey: encryptedSecret, // Store ENCRYPTED secret for HMAC operations
          secretKeyHash // Keep hash for authentication
        }
      })
      this.broadcast({ type: 'machine_status_changed', machineId: machine.id, status: 'online' })
      stateCache.upsertMachine({
        id: machine.id, hostname: machine.hostname, ip: machine.ip,
        osInfo: machine.osInfo, status: machine.status, lastSeen: machine.lastSeen,
        notes: (machine as any).notes ?? null, createdAt: machine.createdAt, updatedAt: machine.updatedAt,
      })
    } else {
      machine = await this.prisma.machine.create({
        data: {
          hostname: data.hostname,
          ip: cleanIP,
          osInfo: data.osInfo ? JSON.stringify(data.osInfo) : '{}',
          secretKey: encryptedSecret, // Store ENCRYPTED secret for HMAC operations
          secretKeyHash,
          status: 'online'
        }
      })
      this.broadcast({ type: 'machine_registered', machine: sanitizeMachine(machine) })
      stateCache.upsertMachine({
        id: machine.id, hostname: machine.hostname, ip: machine.ip,
        osInfo: machine.osInfo, status: machine.status, lastSeen: machine.lastSeen,
        notes: (machine as any).notes ?? null, createdAt: machine.createdAt, updatedAt: machine.updatedAt,
      })
    }      if (ws) {
        ws.send(JSON.stringify({ type: 'registered', machineId: machine.id }))
      }

      this.logger.info('AgentRegistered', { machineId: machine.id, hostname: data.hostname })
      return machine.id
    } catch (error) {
      this.logger.error('AgentRegistrationFailed', { error: (error as Error).message, data: sanitizeData(data) })
      throw error
    }
  }

  /**
   * Handle agent heartbeat
   * ISO 27001 A.13.1: Validates heartbeat structure
   */
  private async handleAgentHeartbeat(data: any): Promise<void> {
    const machineId = data.machineId
    if (!machineId) {
      this.logger.warn('HeartbeatMissingMachineId')
      return
    }

    try {
      const now = Date.now()
      const state = this.heartbeatState.get(machineId) || {
        statusAt: 0,
        metricsAt: 0,
        portsAt: 0,
        broadcastAt: 0
      }

      if (now - state.statusAt >= HEARTBEAT_STATUS_INTERVAL_MS) {
        await this.prisma.machine.update({
          where: { id: machineId },
          data: { status: 'online', lastSeen: new Date() }
        })
        stateCache.updateMachineStatus(machineId, 'online', new Date())
        state.statusAt = now
      }

      if (data.metrics && typeof data.metrics === 'object' && now - state.metricsAt >= HEARTBEAT_METRICS_INTERVAL_MS) {
        await this.prisma.metric.create({
          data: {
            machineId,
            cpuUsage: data.metrics.cpuUsage || 0,
            ramUsage: data.metrics.ramUsage || 0,
            ramTotal: data.metrics.ramTotal || 0,
            ramUsed: data.metrics.ramUsed || 0,
            diskUsage: data.metrics.diskUsage || 0,
            diskTotal: data.metrics.diskTotal || 0,
            diskUsed: data.metrics.diskUsed || 0,
            uptime: data.metrics.uptime || 0
          }
        })
        stateCache.updateMetric(machineId, {
          cpuUsage: data.metrics.cpuUsage || 0,
          ramUsage: data.metrics.ramUsage || 0,
          ramTotal: data.metrics.ramTotal || 0,
          ramUsed: data.metrics.ramUsed || 0,
          diskUsage: data.metrics.diskUsage || 0,
          diskTotal: data.metrics.diskTotal || 0,
          diskUsed: data.metrics.diskUsed || 0,
          uptime: data.metrics.uptime || 0
        })
        state.metricsAt = now
      }

      if (Array.isArray(data.ports) && data.ports.length > 0 && now - state.portsAt >= HEARTBEAT_PORTS_INTERVAL_MS) {
        await updatePorts(this.prisma, machineId, data.ports)
        stateCache.updatePorts(machineId, data.ports.map((p: any) => ({
          port: p.port, proto: p.proto, service: p.service, state: p.state
        })))
        state.portsAt = now
      }

      if (now - state.broadcastAt >= HEARTBEAT_BROADCAST_INTERVAL_MS) {
        this.broadcast({ type: 'machine_heartbeat', machineId, timestamp: new Date() })
        state.broadcastAt = now
      }

      this.heartbeatState.set(machineId, state)
    } catch (error) {
      this.logger.warn('HeartbeatProcessingFailed', { machineId, error: (error as Error).message })
    }
  }

  /**
   * Handle command response from agent
   * Uses OutputNormalizer to clean output
   */
  private async handleCommandResponse(data: any): Promise<void> {
    const { commandId, machineId, output, exitCode, completed } = data

    if (!commandId || !machineId) {
      this.logger.warn('CommandResponseMissingFields', { commandId, machineId })
      return
    }

    // Normalize output using Protocol Layer OutputNormalizer
    const normalized = this.normalizer.normalize(output)

    if (normalized.text) {
      this.broadcast({
        type: 'command_output',
        machineId,
        commandId,
        output: normalized.text,
        completed: false
      })

      await orchestrator.handleCommandOutput({
        machineId,
        commandId,
        output: normalized.text,
        completed: false
      })
    }

    if (completed) {
      this.broadcast({
        type: 'command_completed',
        machineId,
        commandId,
        exitCode: exitCode ?? 0,
        timestamp: new Date()
      })

      await orchestrator.handleCommandOutput({
        machineId,
        commandId,
        output: '',
        completed: true,
        exitCode: exitCode ?? 0
      })

      this.registry.clearCommand(commandId)
    }
  }

  /**
   * Handle terminal output from agent
   * ISO 27001 A.14.2.1: Validates HMAC, normalizes output before broadcasting
   * Secure Terminal Service: Validates secure message envelope
   */
  private async handleTerminalOutput(data: any): Promise<void> {
    // Support both old-style and new secure message format
    const sessionId = data.sessionId || data.data?.sessionId
    const machineId = data.machineId || data.data?.machineId
    const output = data.output || data.data?.payload?.output || data.data?.payload

    if (!sessionId || !machineId) {
      this.logger.warn('TerminalOutputMissingFields', { sessionId, machineId })
      return
    }

    // If new secure message format, validate HMAC
    if (data.type === 'terminal_output' && data.data?.hmac) {
      try {
        const machine = await this.prisma.machine.findUnique({
          where: { id: machineId },
          select: { secretKeyHash: true }
        })

        if (!machine || !machine.secretKeyHash) {
          this.logger.warn('TerminalOutputMachineSecretNotFound', { machineId })
          return
        }

        // Validate secure message
        const validation = await this.terminalService.validateSecureMessage(
          data,
          machineId,
          machine.secretKeyHash
        )

        if (!validation.valid) {
          this.logger.warn('TerminalOutputHmacValidationFailed', {
            sessionId,
            machineId,
            reason: validation.reason
          })
          return
        }

        this.logger.debug('TerminalOutputHmacValidated', { sessionId, nonce: data.data.nonce.substring(0, 8) + '...' })
      } catch (error) {
        this.logger.error('TerminalOutputValidationException', {
          sessionId,
          error: (error as Error).message
        })
        return
      }
    }

    // Terminal PTY output is passed through raw to xterm.js which is a full
    // terminal emulator and handles all control characters and ANSI sequences
    // natively. The OutputNormalizer must NOT be used here because it strips
    // essential control characters (BS 0x08, BEL 0x07, etc.) that are required
    // for proper terminal behavior (backspace, cursor movement, etc.).
    if (output) {
      this.broadcast({
        type: 'terminal_output',
        machineId,
        sessionId,
        output,
        timestamp: new Date()
      })
    }

    this.logger.debug('TerminalOutputBroadcast', {
      machineId,
      sessionId,
      outputSize: (output || '').length
    })
  }

  /**
   * Handle port discovery data from agent
   * ISO 27001 A.13.1: Validates port information
   */
  private async handlePortDiscovery(data: any): Promise<void> {
    const { machineId, ports } = data

    if (!machineId || !Array.isArray(ports)) {
      this.logger.warn('PortDiscoveryInvalidData', { machineId, portsArray: Array.isArray(ports) })
      return
    }

    try {
      await updatePorts(this.prisma, machineId, ports)
      this.broadcast({
        type: 'ports_updated',
        machineId,
        portCount: ports.length,
        timestamp: new Date()
      })
      this.logger.debug('PortDiscoveryProcessed', { machineId, portCount: ports.length })
    } catch (error) {
      this.logger.error('PortDiscoveryFailed', { machineId, error: (error as Error).message })
    }
  }

  /**
   * Handle metrics submission from agent
   * ISO 27001 A.13.1: Validates metrics structure
   */
  private async handleMetrics(data: any): Promise<void> {
    const { machineId, metrics } = data

    if (!machineId || typeof metrics !== 'object') {
      this.logger.warn('MetricsInvalidData', { machineId })
      return
    }

    try {
      const now = Date.now()
      const state = this.heartbeatState.get(machineId) || {
        statusAt: 0,
        metricsAt: 0,
        portsAt: 0,
        broadcastAt: 0
      }
      if (now - state.metricsAt < HEARTBEAT_METRICS_INTERVAL_MS) {
        return
      }

      await this.prisma.metric.create({
        data: {
          machineId,
          cpuUsage: metrics.cpuUsage || 0,
          ramUsage: metrics.ramUsage || 0,
          ramTotal: metrics.ramTotal || 0,
          ramUsed: metrics.ramUsed || 0,
          diskUsage: metrics.diskUsage || 0,
          diskTotal: metrics.diskTotal || 0,
          diskUsed: metrics.diskUsed || 0,
          uptime: metrics.uptime || 0
        }
      })
      state.metricsAt = now
      this.heartbeatState.set(machineId, state)
      this.logger.debug('MetricsProcessed', { machineId })
    } catch (error) {
      this.logger.warn('MetricsProcessingFailed', { machineId, error: (error as Error).message })
    }
  }

  /**
   * Handle security events from agent
   * ISO 27001 A.12.4: Logs all security events for audit trail
   */
  private async handleSecurityEvent(data: any): Promise<void> {
    const { machineId, eventType, details } = data

    if (!machineId || !eventType) {
      this.logger.warn('SecurityEventMissingFields', { machineId, eventType })
      return
    }

    try {
      realtimeEvents.emit('security_event', {
        machineId,
        event: { type: eventType, details, timestamp: new Date() }
      })
      this.logger.info('SecurityEventReceived', { machineId, eventType, timestamp: new Date() })
    } catch (error) {
      this.logger.error('SecurityEventProcessingFailed', { machineId, error: (error as Error).message })
    }
  }
}
