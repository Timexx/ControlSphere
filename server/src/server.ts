import next from 'next'
import path from 'path'
import { ConsoleLogger } from './types/logger'
import { HttpServer } from './infrastructure/http/HttpServer'
import { SecretKeyManager } from './infrastructure/auth/SecretKeyManager'
import { JwtAuthService } from './infrastructure/auth/JwtAuthService'
import { WebSocketUpgradeHandler } from './infrastructure/ws/WebSocketUpgradeHandler'
import type { JwtConfig, ServerConfig, WebSocketUpgradeConfig } from './types/config'
import { ConnectionRegistry } from './connection/ConnectionRegistry'
import { AgentConnectionManager } from './connection/AgentConnectionManager'
import { WebClientConnectionManager } from './connection/WebClientConnectionManager'
import { SecureRemoteTerminalService } from './domain/services/SecureRemoteTerminalService'
import { orchestrator } from './lib/orchestrator'
import { SecretEncryptionService } from './infrastructure/crypto/SecretEncryptionService'
import { startCveMirrorService } from './services/cve-mirror'
import { stateCache } from './lib/state-cache'

const dev = process.env.NODE_ENV !== 'production'
const hostname = process.env.HOSTNAME || '0.0.0.0'
const port = Number(process.env.PORT || 3000)

async function bootstrap(): Promise<void> {
  const logger = new ConsoleLogger()
  // Use the shared singleton PrismaClient (cached across hot reloads)
  const { prisma } = await import('./lib/prisma')

  // Warm in-memory state cache before accepting requests
  await stateCache.warmCache(prisma)
  const registry = new ConnectionRegistry()

  const serverConfig: ServerConfig = {
    port,
    hostname
  }

  const envPath = path.join(process.cwd(), '.env')
  const secretKeyManager = new SecretKeyManager(envPath, logger)

  const jwtConfig: JwtConfig = {
    issuer: process.env.JWT_ISSUER || 'maintainer.local',
    audience: process.env.JWT_AUDIENCE || 'maintainer.clients',
    expiresIn: process.env.JWT_EXPIRES_IN || '1h'
  }

  const secretProvider = async () => secretKeyManager.ensureJWTSecret()
  const jwtAuthService = new JwtAuthService(secretProvider, jwtConfig, logger)
  const secretEncryption = new SecretEncryptionService(await secretProvider())

  const broadcast = (data: any) => {
    const message = JSON.stringify(data)
    for (const client of registry.listWebClients()) {
      if (client.readyState === 1) {
        client.send(message)
      }
    }
  }

  const app = next({ dev, hostname, port, dir: process.cwd() })
  await app.prepare()
  const handler = app.getRequestHandler()
  const nextUpgradeHandler = (app as any).getUpgradeHandler?.()

  const httpServer = new HttpServer(serverConfig, (req, res) => handler(req, res), logger)
  await httpServer.start()
  // Delay CVE mirror start by 30s so user requests are served immediately on boot
  setTimeout(() => startCveMirrorService(undefined, prisma), 30_000)

  // Initialize SecureRemoteTerminalService
  // Configuration via environment variables:
  // - SESSION_TOKEN_SECRET (required): 32-byte hex for session token HMAC
  // - SESSION_EXPIRY_SECONDS (optional): session lifetime in seconds
  // - RATE_LIMIT_TOKENS_PER_SEC (optional): tokens per second
  // - RATE_LIMIT_BURST_TOKENS (optional): burst allowance
  // - CLOCK_SKEW_TOLERANCE_SECONDS (optional): timestamp tolerance
  // - NONCE_HISTORY_LIMIT (optional): max nonces per machine
  const terminalService = new SecureRemoteTerminalService(prisma, logger)

  // Get JWT secret for encryption
  const jwtSecretValue = await secretProvider()

  const agentManager = new AgentConnectionManager(prisma, registry, broadcast, logger, terminalService, jwtSecretValue)
  const webClientManager = new WebClientConnectionManager(prisma, registry, broadcast, secretProvider, logger, terminalService)

  // Configure orchestrator with dispatchers
  orchestrator.configure({
    sendCommand: async (machineId: string, executionId: string, command: string) => {
      const agentWs = registry.getMachine(machineId)
      if (!agentWs || agentWs.readyState !== 1) {
        logger.warn('OrchestratorSendCommandFailed', { machineId, executionId, reason: 'agent not connected' })
        return false
      }

      try {
        // Get agent secret for HMAC signing
        const machine = await prisma.machine.findUnique({
          where: { id: machineId },
          select: { secretKey: true }
        })

        if (!machine?.secretKey) {
          logger.error('OrchestratorSendCommandFailed', { machineId, executionId, reason: 'no secret hash found' })
          return false
        }

        // Decrypt stored secret key (same as terminal path)
        const plainSecret = secretEncryption.decrypt(machine.secretKey)

        // Create session token for execute_command capability
        const sessionToken = await terminalService.issueSessionToken(
          'system', // System user for orchestrator jobs
          machineId,
          ['execute_command']
        )

        // Create secure message with HMAC
        const secureMsg = await terminalService.createSecureMessage(
          sessionToken,
          'execute_command',
          { commandId: executionId, command },
          plainSecret
        )

        logger.info('SecureCommandDispatched', {
          machineId,
          executionId,
          sessionId: sessionToken.sessionId,
          commandLength: command.length
        })

        agentWs.send(JSON.stringify(secureMsg))
        return true
      } catch (error) {
        logger.error('OrchestratorSendCommandFailed', {
          machineId,
          executionId,
          error: (error as Error).message
        })
        return false
      }
    },
    isMachineOnline: (machineId: string) => {
      const agentWs = registry.getMachine(machineId)
      return agentWs && agentWs.readyState === 1
    },
    broadcast
  })

  const wsConfig: WebSocketUpgradeConfig = {
    allowedPaths: ['/ws/agent', '/ws/web'],
    requireAuthPaths: ['/ws/web']
  }

  const routes = {
    '/ws/agent': (socket: any, request: any) => agentManager.handleConnection(socket, request),
    '/ws/web': (socket: any, request: any) => webClientManager.handleConnection(socket, request)
  }

  const wsUpgrade = new WebSocketUpgradeHandler(
    httpServer.instance!,
    wsConfig,
    jwtAuthService,
    logger,
    routes,
    nextUpgradeHandler
  )
  wsUpgrade.attach()

  logger.info('ServerReady', { url: `http://${hostname}:${port}`, ws: ['/ws/agent', '/ws/web'] })
}

bootstrap().catch((error) => {
  console.error('Fatal bootstrap error', error)
  process.exit(1)
})
