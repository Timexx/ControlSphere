# Server.js → New Architecture: Code Migration Mapping

**Date:** 2025-12-06  
**Purpose:** Show exact code transformations from monolithic `server.js` to modular architecture  
**Version:** 1.0  

---

## Executive Summary

Dieses Dokument zeigt, wie jede Funktion und Variable aus `server.js` in die neue modulare Architektur refaktoriert wird. Dies ist die **Grundlage für auditierbare Transformationen** gemäß ISO 17025 Traceability-Anforderungen.

**Mapping Format:**
```
OLD (server.js):  Lines XXX-YYY, function/variable name
NEW (Architecture): Layer/Module/Class.method()
STATUS: ✅ Planned / 🔄 In Progress / ⏳ Not Started
```

---

## 1. HTTP Server Bootstrap (Lines 1-250)

### OLD: `createServer()` HTTP Setup
**File:** server.js, Lines ~200-250  
**Current Implementation:**
```javascript
const server = createServer(async (req, res) => {
  if (req.headers.upgrade === 'websocket') {
    return
  }
  try {
    await handler(req, res)
  } catch (err) {
    console.error('Error occurred handling', req.url, err)
    res.statusCode = 500
    res.end('internal server error')
  }
})
```

### NEW: Infrastructure Layer HttpServer Module
**Module:** `src/infrastructure/http/HttpServer.ts`  
**Status:** ⏳ Phase 2 Implementation  

```typescript
// NEW: HttpServer.ts
import { createServer, IncomingMessage, ServerResponse } from 'http'
import { ILogger } from '../../types/logger'

export interface IHttpServer {
  start(): Promise<void>
  stop(): Promise<void>
  onRequest(req: IncomingMessage, res: ServerResponse): Promise<void>
}

export class HttpServer implements IHttpServer {
  private server: ReturnType<typeof createServer> | null = null

  constructor(
    private config: ServerConfig,
    private nextHandler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
    private logger: ILogger
  ) {}

  async start(): Promise<void> {
    this.server = createServer(async (req, res) => {
      // Skip Next.js handler for WebSocket upgrades
      if (req.headers.upgrade === 'websocket') {
        this.logger.debug('WebSocketUpgrade', { url: req.url })
        return
      }

      try {
        await this.nextHandler(req, res)
      } catch (error) {
        this.logger.error('HttpRequestFailed', {
          url: req.url,
          method: req.method,
          error: error instanceof Error ? error.message : String(error)
        })
        if (!res.headersSent) {
          res.statusCode = 500
          res.end('Internal Server Error')
        }
      }
    })

    return new Promise((resolve, reject) => {
      this.server!.listen(this.config.port, this.config.hostname, () => {
        this.logger.info('HttpServerStarted', {
          port: this.config.port,
          hostname: this.config.hostname
        })
        resolve()
      })
      this.server!.on('error', reject)
    })
  }

  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve()
        return
      }
      this.server.close((err) => {
        if (err) reject(err)
        else {
          this.logger.info('HttpServerStopped', {})
          resolve()
        }
      })
    })
  }
}
```

**Unit Test Template:**
```typescript
describe('HttpServer', () => {
  test('should listen on configured port', async () => {
    const server = new HttpServer(config, mockHandler, logger)
    await server.start()
    const response = await fetch(`http://localhost:${config.port}/health`)
    expect(response.status).toBe(200)
    await server.stop()
  })

  test('should skip WebSocket upgrade to Next.js handler', async () => {
    const server = new HttpServer(config, mockHandler, logger)
    await server.start()
    // WebSocket upgrade will be handled by server.on('upgrade')
    await server.stop()
  })

  test('should return 500 on handler error', async () => {
    const mockHandler = jest.fn().mockRejectedValue(new Error('Test error'))
    const server = new HttpServer(config, mockHandler, logger)
    await server.start()
    // Should not crash
    await server.stop()
  })
})
```

---

## 2. JWT Secret Management (Lines 35-110)

### OLD: `ensureJWTSecret()` & `generateAndSaveSecret()`
**File:** server.js, Lines ~35-110  

```javascript
function ensureJWTSecret() {
  const envPath = path.join(__dirname, '.env')
  let envContent = ''
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8')
  }
  
  const secret = process.env.JWT_SECRET
  const needsGeneration = !secret || secret.length < 32
  
  if (secret) {
    const insecurePatterns = ['change-me', 'secret', 'password', 'test', 'demo', '123456']
    const lowerSecret = secret.toLowerCase()
    for (const pattern of insecurePatterns) {
      if (lowerSecret.includes(pattern)) {
        return generateAndSaveSecret(envPath, envContent)
      }
    }
  }
  
  if (needsGeneration) {
    return generateAndSaveSecret(envPath, envContent)
  }
  
  return secret
}

function generateAndSaveSecret(envPath, existingContent) {
  const newSecret = crypto.randomBytes(64).toString('base64')
  // ... .env manipulation code ...
  fs.writeFileSync(envPath, newContent, 'utf8')
  process.env.JWT_SECRET = newSecret
  return newSecret
}
```

### NEW: Infrastructure Layer SecretKeyManager
**Module:** `src/infrastructure/auth/SecretKeyManager.ts`  
**Status:** ⏳ Phase 2 Implementation  

```typescript
// NEW: SecretKeyManager.ts
import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import { ILogger } from '../../types/logger'

export interface ISecretKeyManager {
  ensureJWTSecret(): Promise<string>
  getOrGenerateSecret(): Promise<string>
  rotateSecret(): Promise<string>
}

export class SecretKeyManager implements ISecretKeyManager {
  private readonly INSECURE_PATTERNS = [
    'change-me', 'secret', 'password', 'test', 'demo',
    '123456', 'admin', 'root', 'default'
  ]
  private readonly MIN_SECRET_LENGTH = 32
  private readonly SECRET_BYTE_SIZE = 64

  constructor(
    private envPath: string,
    private logger: ILogger
  ) {}

  async ensureJWTSecret(): Promise<string> {
    try {
      const existingSecret = process.env.JWT_SECRET
      
      // Check if secret exists and is strong
      if (existingSecret && this.isSecretStrong(existingSecret)) {
        this.logger.info('JwtSecretValidated', {})
        return existingSecret
      }
      
      // Secret missing or weak - generate new one
      if (existingSecret) {
        this.logger.warn('WeakSecretDetected', {
          reason: this.getWeakSecretReason(existingSecret)
        })
      } else {
        this.logger.warn('MissingJwtSecret', {})
      }
      
      return await this.generateAndSaveSecret()
    } catch (error) {
      this.logger.error('JwtSecretManagementFailed', {
        error: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  }

  private isSecretStrong(secret: string): boolean {
    // Check length
    if (secret.length < this.MIN_SECRET_LENGTH) {
      return false
    }
    
    // Check for insecure patterns
    const lowerSecret = secret.toLowerCase()
    for (const pattern of this.INSECURE_PATTERNS) {
      if (lowerSecret.includes(pattern)) {
        return false
      }
    }
    
    return true
  }

  private getWeakSecretReason(secret: string): string {
    if (secret.length < this.MIN_SECRET_LENGTH) {
      return `Too short (${secret.length} < ${this.MIN_SECRET_LENGTH})`
    }
    
    const lowerSecret = secret.toLowerCase()
    for (const pattern of this.INSECURE_PATTERNS) {
      if (lowerSecret.includes(pattern)) {
        return `Contains insecure pattern: "${pattern}"`
      }
    }
    
    return 'Unknown'
  }

  private async generateAndSaveSecret(): Promise<string> {
    this.logger.info('GeneratingNewSecret', {})
    
    // Generate cryptographically secure secret
    const newSecret = crypto.randomBytes(this.SECRET_BYTE_SIZE).toString('base64')
    
    // Update .env file
    try {
      let envContent = ''
      try {
        envContent = await fs.readFile(this.envPath, 'utf-8')
      } catch (e) {
        // File doesn't exist yet - create new content
      }
      
      const lines = envContent.split('\n')
      let secretUpdated = false
      
      // Update existing JWT_SECRET line
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('JWT_SECRET=')) {
          lines[i] = `JWT_SECRET=${newSecret}`
          secretUpdated = true
          break
        }
      }
      
      // Add new JWT_SECRET if not found
      if (!secretUpdated) {
        lines.push('')
        lines.push(`# Auto-generated JWT Secret (${new Date().toISOString()})`)
        lines.push(`JWT_SECRET=${newSecret}`)
      }
      
      const newContent = lines.join('\n')
      await fs.writeFile(this.envPath, newContent, 'utf-8')
      
      // Update process.env
      process.env.JWT_SECRET = newSecret
      
      this.logger.info('SecretGenerated', {
        length: newSecret.length,
        file: this.envPath
      })
      
      return newSecret
    } catch (error) {
      this.logger.error('SecretGenerationFailed', {
        error: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  }

  async rotateSecret(): Promise<string> {
    this.logger.warn('RotatingSecret', {})
    const oldSecret = process.env.JWT_SECRET
    const newSecret = await this.generateAndSaveSecret()
    
    this.logger.info('SecretRotated', {
      newSecretLength: newSecret.length,
      // Note: old secret NOT logged for security
    })
    
    return newSecret
  }
}
```

**Unit Tests:**
```typescript
describe('SecretKeyManager', () => {
  test('should detect weak secrets', () => {
    const manager = new SecretKeyManager('.env.test', logger)
    const weakSecrets = [
      'change-me',
      'secret123',
      'password',
      'test'
    ]
    
    weakSecrets.forEach(secret => {
      expect(manager.isSecretStrong(secret)).toBe(false)
    })
  })

  test('should generate strong secrets', async () => {
    const manager = new SecretKeyManager('.env.test', logger)
    const secret = await manager.generateAndSaveSecret()
    
    expect(secret.length).toBeGreaterThan(32)
    expect(manager.isSecretStrong(secret)).toBe(true)
  })

  test('should not log secrets in audit trail', async () => {
    const manager = new SecretKeyManager('.env.test', logger)
    const logSpy = jest.spyOn(logger, 'info')
    
    await manager.generateAndSaveSecret()
    
    const calls = logSpy.mock.calls
    const allLogs = JSON.stringify(calls)
    expect(allLogs).not.toContain('JWT_SECRET=')
  })
})
```

---

## 3. WebSocket Agent Connection Handler (Lines 250-700)

### OLD: WebSocket Agent Handler
**File:** server.js, Lines ~250-700  
**Key Functions:**
```javascript
wss.on('connection', (ws, req) => {
  let machineId = null
  
  ws.on('message', async (data) => {
    let message = JSON.parse(data)
    // ... complex message processing logic ...
  })
  
  ws.on('close', async () => {
    // ... cleanup logic ...
  })
  
  ws.on('error', (error) => {
    // ... error handling ...
  })
})
```

### NEW: Three Separate Modules

**Module 1:** `src/infrastructure/websocket/WebSocketUpgradeHandler.ts`  
```typescript
export class WebSocketUpgradeHandler {
  async handleUpgrade(request: http.IncomingMessage, socket: net.Socket, head: Buffer) {
    const pathname = new URL(request.url, `http://${request.headers.host}`).pathname
    
    if (pathname === '/ws/agent') {
      return this.handleAgentUpgrade(request, socket, head)
    } else if (pathname === '/ws/web') {
      return this.handleWebClientUpgrade(request, socket, head)
    } else {
      socket.destroy()
    }
  }
  
  private async handleAgentUpgrade(request, socket, head) {
    // Agent doesn't need auth - just upgrade
    this.agentWss.handleUpgrade(request, socket, head, (ws) => {
      this.agentWss.emit('connection', ws, request)
    })
  }
  
  private async handleWebClientUpgrade(request, socket, head) {
    // Web client needs JWT validation
    const cookies = this.parseCookies(request.headers.cookie)
    const token = cookies['session']
    
    const payload = await this.jwtService.verify(token)
    if (!payload) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }
    
    this.webWss.handleUpgrade(request, socket, head, (ws) => {
      this.webWss.emit('connection', ws, request, payload)
    })
  }
}
```

**Module 2:** `src/connection/AgentConnectionManager.ts`  
```typescript
export class AgentConnectionManager {
  private machineConnections: Map<string, WebSocket> = new Map()
  private terminalSessions: Map<string, string> = new Map()
  private commandSessions: Map<string, { machineId: string; timestamp: number }> = new Map()

  registerConnection(ws: WebSocket, machineId: string): void {
    this.machineConnections.set(machineId, ws)
    this.logger.info('AgentConnected', { machineId })
  }

  getConnection(machineId: string): WebSocket | null {
    return this.machineConnections.get(machineId) || null
  }

  onDisconnect(machineId: string): void {
    this.machineConnections.delete(machineId)
    
    // Clean up sessions
    for (const [cmdId, info] of this.commandSessions.entries()) {
      if (info.machineId === machineId) {
        this.commandSessions.delete(cmdId)
      }
    }
    
    this.logger.info('AgentDisconnected', { machineId })
  }
  
  // ... more methods ...
}
```

**Module 3:** `src/protocol/router/MessageRouter.ts`  
```typescript
export class MessageRouter {
  constructor(
    private machineService: IMachineService,
    private commandService: ICommandService,
    private terminalService: ITerminalService,
    private securityService: ISecurityService,
    // ... other services ...
  ) {}

  async routeAgentMessage(message: ValidatedMessage, machineId: string): Promise<void> {
    switch (message.type) {
      case 'register':
        return await this.machineService.register(message.data)
      
      case 'heartbeat':
        return await this.machineService.updateHeartbeat(machineId, message.data)
      
      case 'command_output':
        return await this.commandService.handleOutput(machineId, message.data)
      
      case 'terminal_output':
        return await this.terminalService.handleOutput(machineId, message.data)
      
      default:
        this.logger.warn('UnknownMessageType', { type: message.type })
    }
  }
}
```

---

## 4. Message Parsing & Validation (Inline in OLD)

### OLD: Inline Message Processing
**File:** server.js, Lines ~300-450  
```javascript
let message
try {
  message = JSON.parse(rawText)
} catch (err) {
  // Partial JSON recovery logic mixed with validation...
  if (looksLikePartialJson) {
    // ... extract JSON part ...
  }
}
```

### NEW: Protocol Layer Modules

**Module:** `src/protocol/parser/MessageParser.ts`  
```typescript
export interface ParseResult {
  isValid: boolean
  message?: any
  partialContent?: string
  error?: string
}

export class MessageParser {
  private readonly textDecoder = new TextDecoder('utf-8', { fatal: false })

  parse(data: Buffer | string): ParseResult {
    try {
      const text = typeof data === 'string'
        ? data
        : this.textDecoder.decode(data)
      
      // Try to parse as complete JSON
      try {
        const message = JSON.parse(text)
        return { isValid: true, message }
      } catch (e) {
        // Not complete JSON - try partial recovery
        return this.recoverPartialJson(text)
      }
    } catch (error) {
      return {
        isValid: false,
        error: error instanceof Error ? error.message : 'Parse error'
      }
    }
  }

  private recoverPartialJson(text: string): ParseResult {
    const jsonStart = text.indexOf('{"type":"')
    
    if (jsonStart > 0) {
      // Content before JSON
      const outputPart = text.slice(0, jsonStart).trim()
      const jsonPart = text.slice(jsonStart)
      
      try {
        const message = JSON.parse(jsonPart)
        return {
          isValid: true,
          message,
          partialContent: outputPart
        }
      } catch (e) {
        // Partial JSON can't be parsed - ignore
        return {
          isValid: false,
          partialContent: outputPart,
          error: 'Truncated JSON'
        }
      }
    }
    
    return { isValid: false, error: 'Invalid format' }
  }
}
```

**Module:** `src/protocol/validator/MessageValidator.ts`  
```typescript
export class MessageValidator {
  validate(message: any): ValidationResult {
    // 1. Type check
    if (typeof message !== 'object' || !message.type) {
      return { isValid: false, errors: ['Missing message type'] }
    }
    
    // 2. Schema validation
    const schema = this.getSchema(message.type)
    if (!schema) {
      return { isValid: false, errors: [`Unknown message type: ${message.type}`] }
    }
    
    const schemaResult = this.validateSchema(message, schema)
    if (!schemaResult.valid) {
      return { isValid: false, errors: schemaResult.errors }
    }
    
    // 3. Security validation
    const securityCheck = this.checkSecurity(message)
    if (!securityCheck.valid) {
      this.logger.warn('SecurityCheckFailed', { type: message.type, reason: securityCheck.reason })
      return { isValid: false, errors: securityCheck.errors }
    }
    
    // 4. Sanitization
    const sanitized = this.sanitize(message)
    
    return { isValid: true, sanitizedData: sanitized }
  }

  private checkSecurity(message: any): { valid: boolean; reason?: string; errors?: string[] } {
    // Check for SQL injection
    const json = JSON.stringify(message)
    if (this.looksLikeSqlInjection(json)) {
      return { valid: false, reason: 'SQL injection detected', errors: ['Invalid input pattern'] }
    }
    
    // Check size limits
    if (json.length > 10 * 1024 * 1024) {
      return { valid: false, reason: 'Oversized', errors: ['Message too large'] }
    }
    
    return { valid: true }
  }
}
```

---

## 5. Domain Services (Scattered Throughout server.js)

### OLD: Mixed Logic
**File:** server.js, Lines ~500-600+  
```javascript
// Machine registration mixed with message parsing
if (regData.hostname && regData.secretKey) {
  let machine = await prisma.machine.findFirst({...})
  if (!machine) {
    machine = await prisma.machine.create({...})
    broadcastToWebClients({...})
  }
}

// Command execution mixed with message routing
else if (message.type === 'execute_command') {
  const sent = sendCommandToAgent(machineId, messageData.commandId, messageData.command)
}

// Helper function scattered
function sendCommandToAgent(machineId, commandId, command) {
  const agentWs = machineConnections.get(machineId)
  // ...
}
```

### NEW: Domain Layer Services

**Module:** `src/domain/machine/MachineService.ts`  
```typescript
export interface IMachineService {
  registerMachine(hostname: string, ip: string, osInfo: any, secretKey: string): Promise<Machine>
  updateStatus(machineId: string, status: 'online' | 'offline'): Promise<void>
  updateHeartbeat(machineId: string, metrics: any): Promise<void>
  getOnlineMachines(): Promise<Machine[]>
}

export class MachineService implements IMachineService {
  constructor(
    private machineRepository: IMachineRepository,
    private auditService: IAuditService,
    private eventBroadcaster: IEventBroadcaster,
    private logger: ILogger
  ) {}

  async registerMachine(hostname: string, ip: string, osInfo: any, secretKey: string): Promise<Machine> {
    // 1. Validate input
    if (!hostname || !secretKey) {
      throw new ValidationError('Missing required fields')
    }
    
    // 2. Check if machine exists
    const secretHash = this.hashSecret(secretKey)
    let machine = await this.machineRepository.findBySecretHash(secretHash)
    
    if (!machine) {
      // 3. Create new machine
      machine = await this.machineRepository.create({
        hostname,
        ip: this.cleanIpAddress(ip),
        osInfo,
        secretKeyHash: secretHash,
        status: 'online'
      })
      
      // 4. Emit event
      this.eventBroadcaster.emit('machine_registered', machine)
    } else {
      // 5. Update existing machine
      machine = await this.machineRepository.update(machine.id, {
        hostname,
        ip: this.cleanIpAddress(ip),
        status: 'online',
        lastSeen: new Date()
      })
    }
    
    // 6. Audit log
    await this.auditService.log({
      eventType: 'machine_registered',
      machineId: machine.id,
      hostname,
      timestamp: new Date()
    })
    
    this.logger.info('MachineRegistered', {
      machineId: machine.id,
      hostname
    })
    
    return machine
  }

  private hashSecret(secret: string): string {
    return crypto.createHash('sha256').update(secret).digest('hex')
  }

  private cleanIpAddress(ip: string): string {
    if (!ip || ip === 'auto-detect') {
      return 'unknown'
    }
    if (ip.startsWith('::ffff:')) {
      return ip.substring(7)
    }
    return ip
  }
}
```

**Module:** `src/domain/command/CommandService.ts`  
```typescript
export class CommandService implements ICommandService {
  async execute(machineId: string, userId: string, command: string, commandId: string): Promise<void> {
    // 1. Authorization
    const hasAccess = await this.authService.canUserAccessMachine(userId, machineId)
    if (!hasAccess) {
      await this.auditService.log({
        eventType: 'access_denied',
        userId,
        machineId,
        resource: 'command_execute'
      })
      throw new UnauthorizedError()
    }
    
    // 2. Check machine is online
    if (!this.connectionManager.isMachineOnline(machineId)) {
      throw new MachineNotOnlineError(machineId)
    }
    
    // 3. Store session mapping
    this.commandSessions.set(commandId, {
      machineId,
      userId,
      timestamp: Date.now(),
      command
    })
    
    // 4. Send to agent via connection manager
    this.connectionManager.sendCommandToAgent(machineId, commandId, command)
    
    // 5. Audit log
    await this.auditService.log({
      eventType: 'command_requested',
      commandId,
      userId,
      machineId,
      command,
      timestamp: new Date()
    })
  }

  async handleOutput(commandId: string, output: string, completed: boolean): Promise<void> {
    const session = this.commandSessions.get(commandId)
    if (!session) {
      this.logger.warn('OrphanCommandOutput', { commandId })
      return
    }
    
    // Store output
    await this.commandRepository.appendOutput(commandId, output)
    
    // Broadcast to web clients
    this.eventBroadcaster.emit('command_output', {
      commandId,
      machineId: session.machineId,
      output,
      completed
    })
    
    // If completed, store final result
    if (completed) {
      await this.commandRepository.markCompleted(commandId)
      this.commandSessions.delete(commandId)
      
      await this.auditService.log({
        eventType: 'command_completed',
        commandId,
        machineId: session.machineId,
        userId: session.userId
      })
    }
  }
}
```

---

## 6. Audit Logging (Currently Implicit)

### OLD: No Structured Audit Layer
**File:** server.js  
- Some logging via `console.log()`
- No structured format
- No persistent audit trail

### NEW: Domain Layer AuditService
**Module:** `src/domain/audit/AuditService.ts`  
```typescript
export interface IAuditService {
  log(entry: AuditEntry): Promise<void>
  getEntries(filter?: AuditFilter): Promise<AuditEntry[]>
}

export class AuditService implements IAuditService {
  constructor(
    private auditRepository: IAuditRepository,
    private logger: ILogger
  ) {}

  async log(entry: {
    eventType: 'command_executed' | 'user_login' | 'access_denied' | 'machine_registered'
    userId?: string
    machineId?: string
    details?: Record<string, any>
    severity?: 'low' | 'medium' | 'high' | 'critical'
  }): Promise<void> {
    const auditEntry: AuditEntry = {
      id: uuid(),
      ...entry,
      timestamp: new Date(),
      severity: entry.severity || 'low'
    }
    
    // 1. Structured logging
    this.logger.info('AuditEvent', auditEntry)
    
    // 2. Persistent storage
    try {
      await this.auditRepository.create(auditEntry)
    } catch (error) {
      this.logger.error('AuditLogFailed', { error, entry })
      // Don't throw - audit failure shouldn't crash app
    }
    
    // 3. If critical - alert
    if (auditEntry.severity === 'critical') {
      this.logger.warn('CriticalSecurityEvent', auditEntry)
    }
  }

  async getEntries(filter?: AuditFilter): Promise<AuditEntry[]> {
    return this.auditRepository.find(filter)
  }
}
```

---

## 7. Real-time Event Broadcasting (Lines 1000-1131)

### OLD: Mixed Event Emission
**File:** server.js, Lines ~1000-1131  
```javascript
function broadcastToWebClients(data) {
  const message = JSON.stringify(data)
  webClients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(message)
    }
  })
}

realtimeEvents.on('security_event', (data) => {
  broadcastToWebClients({...})
})
```

### NEW: Domain Layer EventBroadcaster
**Module:** `src/domain/event/EventBroadcaster.ts`  
```typescript
export interface IDomainEvent {
  type: 'machine_online' | 'machine_offline' | 'command_output' | 'security_event' | 'scan_completed'
  timestamp: Date
  data: Record<string, any>
}

export class EventBroadcaster {
  private emitter = new EventEmitter()
  private webClientConnections: WebSocket[] = []

  registerWebClient(ws: WebSocket): void {
    this.webClientConnections.push(ws)
    ws.on('close', () => {
      const idx = this.webClientConnections.indexOf(ws)
      if (idx >= 0) {
        this.webClientConnections.splice(idx, 1)
      }
    })
  }

  emit<T extends IDomainEvent>(event: T): void {
    // 1. Internal event handling
    this.emitter.emit(event.type, event)
    
    // 2. Broadcast to web clients
    this.broadcastToClients(event)
    
    // 3. Log significant events
    if (['security_event', 'scan_completed'].includes(event.type)) {
      this.logger.info('DomainEventBroadcasted', event)
    }
  }

  private broadcastToClients(event: IDomainEvent): void {
    const message = JSON.stringify({
      type: event.type,
      timestamp: event.timestamp.toISOString(),
      data: event.data
    })
    
    let sentCount = 0
    for (const ws of this.webClientConnections) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(message)
          sentCount++
        } catch (error) {
          this.logger.error('BroadcastFailed', { error, clientCount: this.webClientConnections.length })
        }
      }
    }
    
    this.logger.debug('EventBroadcasted', {
      type: event.type,
      sentToClients: sentCount
    })
  }

  // Allow services to subscribe to events
  on(event: IDomainEvent['type'], handler: (event: IDomainEvent) => void): void {
    this.emitter.on(event, handler)
  }
}
```

---

## Summary: Code Migration Map

| Component | OLD Location | NEW Module | Status |
|-----------|--------------|-----------|--------|
| HTTP Server | server.js:200-250 | `infrastructure/http/HttpServer.ts` | ⏳ Phase 2 |
| JWT Secret Mgmt | server.js:35-110 | `infrastructure/auth/SecretKeyManager.ts` | ⏳ Phase 2 |
| WebSocket Auth | server.js:250-350 | `infrastructure/websocket/WebSocketUpgradeHandler.ts` | ⏳ Phase 2 |
| Agent Connection | server.js:350-550 | `connection/AgentConnectionManager.ts` | ⏳ Phase 3 |
| Message Parsing | server.js:400-500 | `protocol/parser/MessageParser.ts` | ⏳ Phase 4 |
| Message Validation | Inline | `protocol/validator/MessageValidator.ts` | ⏳ Phase 4 |
| Message Routing | Inline | `protocol/router/MessageRouter.ts` | ⏳ Phase 4 |
| Machine Service | server.js:500-600 | `domain/machine/MachineService.ts` | ⏳ Phase 5 |
| Command Service | server.js:600-700 | `domain/command/CommandService.ts` | ⏳ Phase 5 |
| Terminal Service | Inline | `domain/terminal/TerminalService.ts` | ⏳ Phase 5 |
| Security Service | Inline | `domain/security/SecurityService.ts` | ⏳ Phase 5 |
| Metrics Service | Inline | `domain/metrics/MetricsService.ts` | ⏳ Phase 5 |
| Port Service | Inline | `domain/port/PortService.ts` | ⏳ Phase 5 |
| Audit Service | (Missing) | `domain/audit/AuditService.ts` | ⏳ Phase 5 |
| Event Broadcaster | server.js:1000-1131 | `domain/event/EventBroadcaster.ts` | ⏳ Phase 5 |
| Output Normalizer | server.js:15-35 | `protocol/normalizer/OutputNormalizer.ts` | ⏳ Phase 4 |

---

## Auditability: Code Change Tracking

**Purpose:** Track every line of code migration for ISO 17025 compliance.

**Format for Documentation:**

```markdown
# Code Migration: [Component Name]

## OLD CODE (server.js)
Lines: XXX-YYY
Context: [what it does]

\`\`\`javascript
[original code]
\`\`\`

## NEW CODE ([Layer]/[Module].ts)
Lines: [file location]

\`\`\`typescript
[refactored code]
\`\`\`

## Changes Made:
- Change 1: [description]
- Change 2: [description]

## Why:
- Reason 1: [modularity/testability/compliance/performance]
- Reason 2: [...]

## Tests Added:
- Unit test for [functionality]
- Security test for [vulnerability]

## Audit Trail:
- Issue ID: ARCH-XXX
- Reviewed by: [Name]
- Approved: [Date]
```

---

## Phase 2 Deliverable: Code Migration Docs

When Phase 2 begins, each layer documentation will include:
1. This migration mapping (line-by-line)
2. Before/after code comparison
3. Unit tests for each refactored component
4. Audit trail for compliance
5. Sign-off checklist

Example: `04-INFRASTRUCTURE-LAYER.md` will contain:
```markdown
# Infrastructure Layer: Code Migration

## 1. HTTP Server Migration
OLD: server.js lines 200-250
NEW: src/infrastructure/http/HttpServer.ts
[complete mapping with code]

## 2. JWT Secret Manager Migration
OLD: server.js lines 35-110
NEW: src/infrastructure/auth/SecretKeyManager.ts
[complete mapping with code]

... and so on for all 4 infrastructure modules
```

---

**End of Code Migration Mapping**

This document will be expanded during Phase 2-5 with complete code migrations, unit tests, and audit trails.

