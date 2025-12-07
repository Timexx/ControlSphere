# Server Architecture Overview
**Version:** 1.0  
**Date:** 2025-12-06  
**Status:** Implementation Target  

---

## 1. Executive Summary

Das VMMaintainer Server-System wird von einem **monolithischen `server.js`** zu einer **schichtenbasierten, modularen Architektur** refaktoriert. Diese Transformation folgt **Clean Architecture** und **Domain-Driven Design** Prinzipien und ist optimiert für **ISO/IEC 27001** und **CREST/ISO 17025** Zertifizierungen.

**Hauptmerkmal:** Klare Verantwortlichkeitstrennung in 4 Layern + 1 Datenzugriffs-Layer mit expliziten Schnittstellen und umfassenden Unit-Tests.

---

## 2. Layered Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────┐
│                       CLIENT LAYER                                  │
│    (Next.js Frontend UI / Agent CLI / External API Consumers)      │
└────────────────────────────────────────────────────────────────────┘
                               ↑ ↓
                         HTTP / WebSocket
                               ↑ ↓
┌────────────────────────────────────────────────────────────────────┐
│           INFRASTRUCTURE LAYER (HTTP/WS Bootstrap)                 │
├────────────────────────────────────────────────────────────────────┤
│ ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐ │
│ │   HttpServer     │  │ WebSocket        │  │  JwtAuthService  │ │
│ │                  │  │ UpgradeHandler   │  │                  │ │
│ │ • Server create  │  │ • Path routing   │  │ • Token verify   │ │
│ │ • Port binding   │  │ • Auth check     │  │ • Token generate │ │
│ │ • Middleware     │  │ • Upgrade to WS  │  │ • Secret version │ │
│ │ • Graceful close │  │                  │  │                  │ │
│ └──────────────────┘  └──────────────────┘  └──────────────────┘ │
│                                                                     │
│ ┌──────────────────────────────────────────────────────────────┐  │
│ │           SecretKeyManager                                   │  │
│ │ • Key generation (crypto.randomBytes)                        │  │
│ │ • .env persistence                                           │  │
│ │ • Weak secret detection                                      │  │
│ └──────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
                               ↑ ↓
           Connection Establishment & Session Init
                               ↑ ↓
┌────────────────────────────────────────────────────────────────────┐
│        CONNECTION LAYER (Agent & Web-Client Manager)                │
├────────────────────────────────────────────────────────────────────┤
│ ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐ │
│ │ AgentConnection  │  │ WebClientConn    │  │ ConnectionRegistry│
│ │ Manager          │  │ Manager          │  │                  │
│ │                  │  │                  │  │ • Discovery API  │
│ │ • machineId→WS   │  │ • userId→WS      │  │ • Health check   │
│ │   mapping        │  │   mapping        │  │ • Statistics     │
│ │ • Online/Offline │  │ • Session data   │  │                  │
│ │ • Lifecycle mgmt │  │ • Auth validation│  │                  │
│ │ • Cleanup on DC  │  │ • Session expiry │  │                  │
│ └──────────────────┘  └──────────────────┘  └──────────────────┘ │
│                                                                     │
│  Terminal Session Mapping: sessionId → machineId (for tty)        │
│  Command Session Mapping: commandId → (machineId, timestamp)      │
└────────────────────────────────────────────────────────────────────┘
                               ↑ ↓
           Serialized Messages (JSON Frames)
                               ↑ ↓
┌────────────────────────────────────────────────────────────────────┐
│          PROTOCOL LAYER (Message Parsing & Validation)              │
├────────────────────────────────────────────────────────────────────┤
│ ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐ │
│ │  MessageParser   │  │MessageValidator  │  │  MessageRouter   │ │
│ │                  │  │                  │  │                  │ │
│ │ • JSON extract   │  │ • Schema check   │  │ • Type → Handler │
│ │ • Binary→UTF-8   │  │ • Sanitization   │  │ • Registration   │
│ │ • Partial JSON   │  │ • Format valid   │  │ • Heartbeat      │
│ │   recovery       │  │ • Size limits    │  │ • Terminal_data  │
│ │ • Noise filter   │  │ • Injection test │  │ • Command_output │
│ └──────────────────┘  └──────────────────┘  └──────────────────┘ │
│                                                                     │
│ ┌──────────────────────────────────────────────────────────────┐  │
│ │  OutputNormalizer                                            │  │
│ │  • Chunk normalization (text extraction)                     │  │
│ │  • Noise reduction (non-printable filtering)                 │  │
│ │  • JSON stringify fallback                                   │  │
│ │  • TextDecoder with error handling                           │  │
│ └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  Validated, Type-Safe Messages Ready for Domain Logic             │
└────────────────────────────────────────────────────────────────────┘
                               ↑ ↓
        Structured Service Calls with Context
                               ↑ ↓
┌────────────────────────────────────────────────────────────────────┐
│           DOMAIN LAYER (Business Logic & Services)                  │
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Machine Management          Command Execution        Monitoring    │
│  ┌─────────────────────┐    ┌──────────────────┐     ┌──────────┐ │
│  │ MachineService      │    │ CommandService   │     │Metrics   │ │
│  │ • Registration      │    │ • Dispatch       │     │Service   │ │
│  │ • Status tracking   │    │ • Result waiting │     │ • Store  │ │
│  │ • Connection track  │    │ • Output stream  │     │ • Aggr   │ │
│  └─────────────────────┘    │ • Timeout mgmt   │     └──────────┘ │
│                             │ • Retry logic    │                   │
│                             └──────────────────┘                   │
│                                                                     │
│  Terminal Management         Security & Audit                      │
│  ┌─────────────────────┐    ┌──────────────────┐                  │
│  │ TerminalService     │    │ SecurityService  │                  │
│  │ • Session spawn     │    │ • Scan trigger   │                  │
│  │ • Input/Output I/O  │    │ • Event logging  │                  │
│  │ • Resize handling   │    │ • Result storage │                  │
│  │ • Cleanup on close  │    └──────────────────┘                  │
│  └─────────────────────┘                                           │
│                             ┌──────────────────┐                  │
│  Port Management            │ AuditService     │                  │
│  ┌─────────────────────┐    │ • Log events     │                  │
│  │ PortService         │    │ • Structured log │                  │
│  │ • Discover ports    │    │ • Traceability   │                  │
│  │ • Track changes     │    │ • Compliance     │                  │
│  │ • Sync with DB      │    └──────────────────┘                  │
│  └─────────────────────┘                                           │
│                                                                     │
│  Real-Time Broadcasting                                            │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ EventBroadcaster                                          │    │
│  │ • Publish security_event, audit_log, scan_completed      │    │
│  │ • Subscribe/emit pattern                                  │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                     │
└────────────────────────────────────────────────────────────────────┘
                               ↑ ↓
        Structured Repository Calls with Validation
                               ↑ ↓
┌────────────────────────────────────────────────────────────────────┐
│      DATA ACCESS LAYER (Database & Persistence)                     │
├────────────────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────────────────┐   │
│  │  Repository Pattern (MachineRepository, CommandRepository) │   │
│  │  • Encapsulate Prisma calls                               │   │
│  │  • Transaction support                                    │   │
│  │  • Error handling & retry                                 │   │
│  │  • Query optimization                                     │   │
│  └────────────────────────────────────────────────────────────┘   │
│                               ↑ ↓                                  │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                  Prisma Client                              │  │
│  │  (PrismaClient with connection pooling & error handling)   │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                               ↑ ↓                                  │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                  PostgreSQL Database                        │  │
│  │  (Machine, Metric, Port, Command, SecurityEvent, Audit)   │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                     │
└────────────────────────────────────────────────────────────────────┘
```

---

## 3. Layer Responsibilities

### 3.1 Infrastructure Layer
**Purpose:** Bootstrap HTTP/WebSocket server, handle authentication and configuration

**Modules:**
- `HttpServer`: Create HTTP server, bind port, handle shutdown gracefully
- `WebSocketUpgradeHandler`: Route WebSocket upgrade requests, validate auth tokens
- `JwtAuthService`: Generate and validate JWT tokens, manage secret versioning
- `SecretKeyManager`: Generate cryptographic secrets, store in `.env`, detect weak secrets

**Boundaries:**
- ✅ Creates network connections
- ✅ Validates authentication tokens
- ✅ Manages configuration
- ❌ Does NOT process messages
- ❌ Does NOT access database
- ❌ Does NOT route to agents

**Testing:** Auth flows, token validation, secret generation, error conditions

---

### 3.2 Connection Layer
**Purpose:** Manage lifecycle of Agent and Web-Client connections

**Modules:**
- `AgentConnectionManager`: Track agent WebSocket connections, map machineId → WebSocket
- `WebClientConnectionManager`: Track web client connections, manage session data
- `ConnectionRegistry`: Central discovery service for connection lookup

**State Managed:**
```typescript
// AgentConnectionManager state
machineConnections: Map<machineId, WebSocket>
terminalSessions: Map<sessionId, machineId>
commandSessions: Map<commandId, { machineId, timestamp }>

// WebClientConnectionManager state
webClientSessions: Map<ws, { userId, username }>
```

**Boundaries:**
- ✅ Manages WebSocket references
- ✅ Tracks session mappings
- ✅ Detects disconnections
- ❌ Does NOT validate messages
- ❌ Does NOT execute business logic
- ❌ Does NOT access database

**Testing:** Connection tracking, session lifecycle, cleanup on disconnect

---

### 3.3 Protocol Layer
**Purpose:** Parse, validate, and route messages from agents and web clients

**Modules:**
- `MessageParser`: Extract JSON from binary streams, handle partial messages, noise filtering
- `MessageValidator`: Validate message structure against schema, sanitize inputs
- `MessageRouter`: Route validated messages to appropriate handlers based on type
- `OutputNormalizer`: Format and denoise command output chunks

**Message Flow:**
```
Raw Binary Data (from WebSocket)
    ↓
MessageParser (JSON extraction, error recovery)
    ↓
MessageValidator (schema check, sanitization)
    ↓
ValidationResult { isValid, errors, sanitizedData }
    ↓
MessageRouter (type-based handler dispatch)
    ↓
Domain Service Handlers
```

**Boundaries:**
- ✅ Parses and validates all messages
- ✅ Detects malformed/malicious input
- ✅ Routes to domain handlers
- ❌ Does NOT execute business logic
- ❌ Does NOT access database
- ❌ Does NOT manage connections

**Testing:** JSON parsing edge cases, schema validation, injection attempts, noise handling

---

### 3.4 Domain Layer
**Purpose:** Implement business logic, orchestrate services, interact with database

**Modules:**

| Service | Responsibility |
|---------|-----------------|
| `MachineService` | Registration, status tracking, lifecycle |
| `CommandService` | Execution dispatch, result aggregation, timeout |
| `TerminalService` | PTY session management, I/O streaming |
| `SecurityService` | Scan triggering, event storage |
| `MetricsService` | Metric collection, aggregation, storage |
| `PortService` | Port discovery, change tracking |
| `EventBroadcaster` | Real-time event publishing to web clients |
| `AuditService` | Structured logging, compliance audit trail |

**Responsibilities per Service:**

```typescript
// Example: MachineService
- registerMachine(hostname, ip, osInfo, secretKey): Machine
- updateStatus(machineId, status): void
- getOnlineMachines(): Machine[]
- handleDisconnect(machineId): void

// Example: CommandService
- executeCommand(machineId, userId, command): commandId
- handleOutput(commandId, chunk, completed): void
- getCommandResult(commandId): CommandResult
- cancelCommand(commandId): void

// Example: AuditService
- logSecurityEvent(event: SecurityEvent): void
- logCommand(command: CommandLog): void
- logUserAction(action: UserAction): void
```

**Boundaries:**
- ✅ Implements business logic
- ✅ Calls repositories for database access
- ✅ Publishes events
- ✅ Logs audit trail
- ❌ Does NOT handle HTTP/WebSocket directly
- ❌ Does NOT validate input (assumes Protocol layer did it)
- ❌ Does NOT create connections

**Testing:** Business logic paths, error scenarios, database interactions, event publishing

---

### 3.5 Data Access Layer
**Purpose:** Abstract database operations via Repository Pattern

**Pattern:**
```typescript
// Base Repository Interface
interface IRepository<T> {
  create(data: CreateInput): Promise<T>
  findById(id: string): Promise<T | null>
  findAll(where?: Where): Promise<T[]>
  update(id: string, data: UpdateInput): Promise<T>
  delete(id: string): Promise<void>
  transaction<R>(fn: () => Promise<R>): Promise<R>
}

// Specific Repositories
class MachineRepository implements IRepository<Machine>
class CommandRepository implements IRepository<Command>
class MetricsRepository implements IRepository<Metric>
// etc.
```

**Boundaries:**
- ✅ Encapsulates Prisma calls
- ✅ Handles transactions
- ✅ Retries on transient errors
- ❌ Does NOT implement business logic
- ❌ Does NOT validate data (assumes caller did it)

**Testing:** Prisma mock, transaction rollback, error handling

---

## 4. Data Flow Examples

### 4.1 Agent Registration Flow

```
Agent WebSocket Connection
    ↓
Infrastructure Layer:
    - WebSocketUpgradeHandler.upgrade()
    - JwtAuthService validates (N/A for agents)
    ↓
Connection Layer:
    - AgentConnectionManager.registerConnection(ws, machineId)
    ↓
Agent sends: { type: "register", data: { hostname, secretKey, ip, osInfo } }
    ↓
Protocol Layer:
    - MessageParser.parse() → JSON extract
    - MessageValidator.validate() → Schema check (check secretKey format)
    - MessageRouter.route() → calls MachineService handler
    ↓
Domain Layer:
    - MachineService.register(hostname, secretKey, ip, osInfo)
      - Check if machine exists by secretKey hash
      - If not: create new Machine record
      - If yes: update lastSeen
    - AuditService.log("machine_registered", { machineId, hostname })
    - EventBroadcaster.emit("machine_online", machineId)
    ↓
Data Access Layer:
    - MachineRepository.create() or update() → Prisma
    ↓
Response sent back:
    - { type: "registered", machineId }
```

### 4.2 Command Execution Flow

```
Web Client sends: { type: "execute_command", machineId, commandId, command }
    ↓
Infrastructure Layer:
    - WebSocketUpgradeHandler authenticated this client (JWT valid)
    ↓
Connection Layer:
    - WebClientConnectionManager verifies session exists
    ↓
Protocol Layer:
    - MessageValidator checks command format, sanitizes
    - MessageRouter routes to CommandService handler
    ↓
Domain Layer:
    - CommandService.execute(machineId, userId, command)
      - Verify machine is online
      - CommandSessions.set(commandId, { machineId, timestamp })
      - Dispatch to agent via AgentConnectionManager
      - AuditService.log("command_requested", { commandId, userId, machineId })
    ↓
Agent processes and sends: { type: "command_output", commandId, output, completed }
    ↓
Protocol Layer (same validation as registration)
    ↓
Domain Layer:
    - CommandService.handleOutput(commandId, output, completed)
      - StreamOutput to web clients via EventBroadcaster
      - If completed: store CommandResult to database
      - AuditService.log("command_completed", { commandId, exitCode })
    ↓
Web Client receives via WebSocket:
    - { type: "command_output", commandId, output, completed }
```

### 4.3 Security Event Flow

```
Agent runs scan: { type: "scan_completed", scanId, summary, timestamp }
    ↓
Protocol Layer → MessageRouter → SecurityService handler
    ↓
Domain Layer:
    - SecurityService.handleScanCompletion(scanId, summary)
      - Parse findings (vulnerability_found, port_open, service_outdated)
      - Store SecurityEvent records
      - AuditService.log("security_scan_completed", { scanId, findingCount })
      - EventBroadcaster.emit("scan_completed", { scanId, summary })
    ↓
Data Access Layer:
    - SecurityEventRepository.create() for each finding
    ↓
Web Client receives:
    - { type: "scan_completed", scanId, summary, timestamp }
    - Dashboard updates in real-time
```

---

## 5. Dependency Injection & IoC

**Pattern:** Constructor-based dependency injection (no framework)

```typescript
// Infrastructure Layer bootstraps all services
const jwtService = new JwtAuthService(config)
const secretKeyManager = new SecretKeyManager(config)
const httpServer = new HttpServer(config, jwtService)
const wsUpgradeHandler = new WebSocketUpgradeHandler(jwtService)

// Connection Layer
const agentConnManager = new AgentConnectionManager()
const webClientConnManager = new WebClientConnectionManager()
const connRegistry = new ConnectionRegistry(agentConnManager, webClientConnManager)

// Protocol Layer
const messageParser = new MessageParser()
const messageValidator = new MessageValidator()
const outputNormalizer = new OutputNormalizer()
const messageRouter = new MessageRouter()

// Domain Layer (receives repositories)
const machineRepo = new MachineRepository(prisma)
const machineService = new MachineService(machineRepo, auditService, eventBroadcaster)
const commandService = new CommandService(commandRepo, auditService)
// ...

// Wire everything together in server.ts
```

**Benefit:** Easy to mock for testing, clear dependencies, no magic

---

## 6. Error Handling Strategy

### 6.1 Error Hierarchy

```typescript
// Base error class
class ApplicationError extends Error {
  constructor(
    public code: string,
    public statusCode: number,
    public isOperational: boolean,
    message: string
  ) {
    super(message)
  }
}

// Infrastructure errors
class AuthenticationError extends ApplicationError { }
class ConfigurationError extends ApplicationError { }

// Connection errors
class ConnectionNotFoundError extends ApplicationError { }
class MachineNotOnlineError extends ApplicationError { }

// Protocol errors
class MessageValidationError extends ApplicationError { }
class ParseError extends ApplicationError { }

// Domain errors
class MachineNotFoundError extends ApplicationError { }
class CommandTimeoutError extends ApplicationError { }
class UnauthorizedAccessError extends ApplicationError { }
```

### 6.2 Error Handling Rules

| Layer | Handle | Log | Propagate |
|-------|--------|-----|-----------|
| Infrastructure | ❌ | ✅ | → Client (500) |
| Connection | Partial | ✅ | → Protocol |
| Protocol | ✅ (validation) | ✅ | ❌ (reject message) |
| Domain | ✅ (business logic) | ✅ | → Caller |
| Data Access | ✅ (retry, transaction) | ✅ | → Domain |

**Logging Format (structured):**
```typescript
logger.error('CommandExecutionFailed', {
  timestamp: ISO8601,
  commandId: string,
  machineId: string,
  userId: string,
  errorCode: string,
  errorMessage: string,
  stackTrace: string,
  context: { /* relevant context */ }
})
```

---

## 7. Configuration & Secrets Management

**File Structure:**
```
server/
├── .env (git-ignored, auto-generated)
├── .env.example (template)
└── src/config/
    ├── ServerConfig.ts (type-safe config loader)
    ├── constants.ts (magic strings)
    └── __tests__/ServerConfig.test.ts
```

**Config Loading Pattern:**
```typescript
// ServerConfig.ts
interface IServerConfig {
  node_env: 'development' | 'production' | 'test'
  port: number
  hostname: string
  jwt_secret: string
  jwt_secret_version: string
  database_url: string
  log_level: string
}

class ServerConfig implements IServerConfig {
  static fromEnv(): IServerConfig {
    const env = process.env
    
    // Validate required vars
    const required = ['JWT_SECRET', 'DATABASE_URL']
    for (const key of required) {
      if (!env[key]) throw new ConfigurationError(`Missing ${key}`)
    }
    
    // Type-safe loading with defaults
    return {
      node_env: (env.NODE_ENV as any) || 'development',
      port: parseInt(env.PORT || '3000', 10),
      hostname: env.HOSTNAME || 'localhost',
      jwt_secret: env.JWT_SECRET!,
      database_url: env.DATABASE_URL!,
      // ...
    }
  }
}

// Usage in server.ts
const config = ServerConfig.fromEnv()
```

---

## 8. Logging & Audit Trail

### 8.1 Structured Logging

```typescript
// Logger interface
interface ILogger {
  info(message: string, context?: Record<string, any>): void
  warn(message: string, context?: Record<string, any>): void
  error(message: string, context?: Record<string, any>): void
  debug(message: string, context?: Record<string, any>): void
}

// Usage
logger.info('CommandExecuted', {
  commandId: '123',
  machineId: 'mach-456',
  userId: 'user-789',
  command: 'df -h',
  exitCode: 0,
  duration: 250,
  timestamp: new Date().toISOString()
})
```

### 8.2 Audit Trail Requirements (ISO 27001 A.12.4.1)

**Every security-relevant operation must log:**

| Event Type | Required Fields |
|-----------|----------------|
| User Login | userId, timestamp, ip, status |
| Command Execution | userId, machineId, commandId, command, timestamp |
| Security Scan | machineId, scanId, findingCount, timestamp |
| Configuration Change | userId, what, oldValue, newValue, timestamp |
| Access Denial | userId, resource, reason, timestamp |

---

## 9. Testing Strategy

### 9.1 Test Structure

```
server/src/
├── infrastructure/
│   ├── HttpServer.ts
│   └── __tests__/
│       └── HttpServer.test.ts      (100% critical path)
├── connection/
│   ├── AgentConnectionManager.ts
│   └── __tests__/
│       └── AgentConnectionManager.test.ts  (95%+ coverage)
├── protocol/
│   ├── MessageParser.ts
│   └── __tests__/
│       └── MessageParser.test.ts   (95%+ coverage)
├── domain/
│   ├── MachineService.ts
│   └── __tests__/
│       └── MachineService.test.ts  (80%+ coverage)
```

### 9.2 Test Types per Layer

| Layer | Unit | Integration | Security | Performance |
|-------|------|-------------|----------|-------------|
| Infrastructure | ✅ | ✅ | ✅ | - |
| Connection | ✅ | ✅ | - | ✅ |
| Protocol | ✅ | ✅ | ✅ | - |
| Domain | ✅ | ✅ | ✅ | - |
| Data Access | ✅ | ✅ | - | ✅ |

---

## 10. Migration Path

### Phase 1: Development
- Write all new modules in TypeScript
- 100% test coverage
- Keep server.js unchanged

### Phase 2: Integration
- Create new server.ts entry point
- Wire all layers together
- Integration tests pass

### Phase 3: Deployment
- Deploy new server.ts
- Monitor for issues (1 week)
- If stable: delete old server.js

### Phase 4: Cleanup
- Remove server.js
- Update documentation
- Archive as reference

---

## 11. File Structure After Refactoring

```
server/
├── src/
│   ├── server.ts                          # New entry point
│   ├── infrastructure/
│   │   ├── http/
│   │   │   ├── HttpServer.ts
│   │   │   └── __tests__/HttpServer.test.ts
│   │   ├── websocket/
│   │   │   ├── WebSocketUpgradeHandler.ts
│   │   │   ├── WebSocketConnectionManager.ts
│   │   │   └── __tests__/...
│   │   ├── auth/
│   │   │   ├── JwtAuthService.ts
│   │   │   ├── SecretKeyManager.ts
│   │   │   └── __tests__/...
│   │   ├── config/
│   │   │   ├── ServerConfig.ts
│   │   │   ├── constants.ts
│   │   │   └── __tests__/...
│   │   └── __tests__/...
│   ├── connection/
│   │   ├── AgentConnectionManager.ts
│   │   ├── WebClientConnectionManager.ts
│   │   ├── ConnectionRegistry.ts
│   │   ├── types/
│   │   │   ├── AgentConnection.ts
│   │   │   ├── WebClientSession.ts
│   │   │   └── TerminalSession.ts
│   │   └── __tests__/...
│   ├── protocol/
│   │   ├── parser/
│   │   │   ├── MessageParser.ts
│   │   │   └── __tests__/...
│   │   ├── validator/
│   │   │   ├── MessageValidator.ts
│   │   │   ├── schemas/
│   │   │   │   ├── agentMessages.schema.ts
│   │   │   │   ├── webClientMessages.schema.ts
│   │   │   │   └── common.schema.ts
│   │   │   └── __tests__/...
│   │   ├── router/
│   │   │   ├── MessageRouter.ts
│   │   │   └── __tests__/...
│   │   ├── normalizer/
│   │   │   ├── OutputNormalizer.ts
│   │   │   └── __tests__/...
│   │   ├── types/
│   │   │   ├── Message.ts
│   │   │   ├── MessageType.ts
│   │   │   └── ValidationResult.ts
│   │   └── __tests__/...
│   ├── domain/
│   │   ├── command/
│   │   │   ├── CommandService.ts
│   │   │   ├── types/Command.ts
│   │   │   └── __tests__/...
│   │   ├── terminal/
│   │   │   ├── TerminalService.ts
│   │   │   ├── types/TerminalSession.ts
│   │   │   └── __tests__/...
│   │   ├── security/
│   │   │   ├── SecurityService.ts
│   │   │   ├── SecurityEventService.ts
│   │   │   ├── types/SecurityEvent.ts
│   │   │   └── __tests__/...
│   │   ├── machine/
│   │   │   ├── MachineService.ts
│   │   │   ├── types/Machine.ts
│   │   │   └── __tests__/...
│   │   ├── metrics/
│   │   │   ├── MetricsService.ts
│   │   │   ├── types/Metric.ts
│   │   │   └── __tests__/...
│   │   ├── port/
│   │   │   ├── PortService.ts
│   │   │   ├── types/Port.ts
│   │   │   └── __tests__/...
│   │   ├── event/
│   │   │   ├── EventBroadcaster.ts
│   │   │   ├── types/DomainEvent.ts
│   │   │   └── __tests__/...
│   │   ├── audit/
│   │   │   ├── AuditService.ts
│   │   │   ├── types/AuditEntry.ts
│   │   │   └── __tests__/...
│   │   ├── repository/
│   │   │   ├── IRepository.ts (interface)
│   │   │   ├── MachineRepository.ts
│   │   │   ├── CommandRepository.ts
│   │   │   ├── MetricsRepository.ts
│   │   │   ├── SecurityEventRepository.ts
│   │   │   ├── PortRepository.ts
│   │   │   ├── AuditLogRepository.ts
│   │   │   └── __tests__/...
│   │   └── __tests__/...
│   ├── types/
│   │   ├── index.ts (global types)
│   │   ├── errors.ts
│   │   └── logger.ts
│   └── config/
│       ├── logger.ts
│       └── di.ts (dependency injection bootstrap)
├── jest.config.js
├── tsconfig.json
└── package.json
```

---

## 12. Comparison: Before vs After

| Aspect | Before (Monolith) | After (Layered) |
|--------|-------------------|-----------------|
| Lines per file | ~1131 | 200-400 per module |
| Responsibilities | All mixed | 1 per module |
| Testability | Difficult | Easy (isolated) |
| Maintainability | Low | High |
| Auditability | None | Full audit trail |
| Security Testing | Limited | Comprehensive |
| Time to add feature | High | Low |
| Knowledge required | Entire codebase | Specific layer |
| ISO Compliance | ❌ | ✅ Ready |

---

## 13. Next Steps

1. **Review this overview** and confirm architecture aligns with goals
2. **Proceed to Phase 2:** Infrastructure Layer implementation
3. **Each phase** creates detailed documentation + working code + tests
4. **Final phase:** Integrate all layers into new server.ts

---

**Document Version:** 1.0  
**Last Updated:** 2025-12-06  
**Maintained By:** [Architecture Team]
