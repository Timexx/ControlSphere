# ISO/IEC 27001 & CREST/ISO 17025 Compliance Framework

**Version:** 1.0  
**Date:** 2025-12-06  
**Status:** Implementation Guide  

---

## 1. Introduction

Dieses Dokument maps die neue Architektur direkt zu den Anforderungen von:
- **ISO/IEC 27001:2022** (Information Security Management)
- **CREST** (Scheme for Testing)
- **ISO/IEC 17025:2017** (General requirements for competence of testing laboratories)

Das Ziel: Mit der neuen Architektur werden die Grundlagen für zukünftige Zertifizierungen gelegt.

---

## 2. ISO/IEC 27001:2022 Mapping

### 2.1 Relevant Control Objectives (A.14: System Development)

#### A.14.2: Secure Software Development

**Requirement:** 
> Ensure that information system development follows a secure development lifecycle.

**Implementation:**

| Control | How We Implement | Layer | Evidence |
|---------|-----------------|-------|----------|
| **A.14.2.1** Requirement for access control | `WebSocketUpgradeHandler` validates JWT before connection upgrade | Infrastructure | Test: `test-auth-required.ts` |
| **A.14.2.2** Secure development environment | TypeScript, strict mode, ESLint, no hardcoded secrets | All | `tsconfig.json`, `.eslintrc` |
| **A.14.2.3** Secure development policy | Documented in `DEVELOPMENT_PROCESS.md` | - | Document link |
| **A.14.2.5** Logging access to sensitive data | `AuditService` logs all command executions | Domain | Test: `test-audit-logging.ts` |

#### A.14.2.1: Input Validation

**Requirement:**
> All user input and system interfaces must be validated.

**Implementation:**

```typescript
// Protocol Layer: MessageValidator
class MessageValidator {
  validate(rawData: unknown): ValidationResult {
    // 1. Type check
    if (typeof rawData !== 'object') {
      return { isValid: false, errors: ['Invalid message type'] }
    }
    
    // 2. Schema validation (JSON Schema)
    const schemaValidation = this.validateAgainstSchema(rawData)
    if (!schemaValidation.valid) {
      return { isValid: false, errors: schemaValidation.errors }
    }
    
    // 3. Sanitization (prevent injection)
    const sanitized = this.sanitize(rawData)
    
    // 4. Business logic validation
    const businessValidation = this.validateBusinessRules(sanitized)
    
    return {
      isValid: businessValidation.valid,
      errors: businessValidation.errors || [],
      sanitizedData: businessValidation.valid ? sanitized : undefined
    }
  }
}

// Evidence: Test in `protocol/__tests__/MessageValidator.test.ts`
describe('MessageValidator: Input Validation', () => {
  test('SQL injection attempt is rejected', () => {
    const malicious = { command: "'; DROP TABLE machines; --" }
    const result = validator.validate(malicious)
    expect(result.isValid).toBe(false)
    expect(result.errors).toContain('SQL injection detected')
  })
  
  test('Oversized input is rejected', () => {
    const huge = { data: 'x'.repeat(10 * 1024 * 1024) }
    const result = validator.validate(huge)
    expect(result.isValid).toBe(false)
  })
})
```

#### A.14.2.5: Secure Authentication

**Requirement:**
> Authentication mechanisms must be properly implemented and tested.

**Implementation:**

```typescript
// Infrastructure Layer: JwtAuthService
class JwtAuthService {
  generateToken(userId: string, username: string): string {
    const payload = {
      userId,
      username,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 86400, // 24h expiry
      secretVersion: this.config.SECRET_VERSION // Invalidate on secret rotation
    }
    
    return jwtSign(payload, this.config.JWT_SECRET, {
      algorithm: 'HS256'
    })
  }
  
  verifyToken(token: string): TokenPayload | null {
    try {
      const payload = jwtVerify(token, this.config.JWT_SECRET, {
        algorithms: ['HS256']
      })
      
      // Check expiry
      if (payload.exp < Math.floor(Date.now() / 1000)) {
        logger.warn('ExpiredToken', { userId: payload.userId })
        return null
      }
      
      // Check secret version (supports rotation)
      if (payload.secretVersion !== this.config.SECRET_VERSION) {
        logger.warn('InvalidSecretVersion', { userId: payload.userId })
        return null
      }
      
      return payload
    } catch (error) {
      logger.error('TokenVerificationFailed', { error, token_start: token.slice(0, 20) })
      return null
    }
  }
}

// Evidence: Integration test
describe('JwtAuthService: Authentication', () => {
  test('Valid token is accepted', () => {
    const token = service.generateToken('user1', 'john')
    const payload = service.verifyToken(token)
    expect(payload).not.toBeNull()
    expect(payload?.userId).toBe('user1')
  })
  
  test('Tampered token is rejected', () => {
    const token = service.generateToken('user1', 'john')
    const tampered = token.slice(0, -10) + 'tampered!!'
    const payload = service.verifyToken(tampered)
    expect(payload).toBeNull()
  })
  
  test('Expired token is rejected', () => {
    // Create token with 1 second expiry
    const token = service.generateTokenWithExpiry('user1', 'john', 1)
    await sleep(2000)
    const payload = service.verifyToken(token)
    expect(payload).toBeNull()
  })
})
```

---

### 2.2 A.13.1: Network Security

#### A.13.1.1: Network Architecture

**Requirement:**
> Groups of information services shall be segregated by network architecture.

**Implementation:**

```
┌─ Infrastructure Layer
│  ├─ HTTP Requests (port 3000)
│  └─ WebSocket Upgrade (port 3000)
│
├─ Auth Boundary (JwtAuthService)
│  ├─ Agents: Secret Key verification
│  └─ Web Clients: JWT token verification
│
├─ Connection Layer
│  ├─ Agent Pool: machineId → WebSocket mapping (isolated)
│  └─ Client Pool: userId → WebSocket mapping (isolated)
│
└─ Domain Layer (processes only authenticated messages)
```

**Audit Trail:**

```typescript
// AuditService logs every access attempt
class AuditService {
  logAccessAttempt(event: {
    userId?: string
    machineId?: string
    action: string
    result: 'success' | 'denied'
    reason?: string
    timestamp: Date
  }) {
    logger.info('AccessAttempt', event)
    // Store to database for audit purposes
  }
}
```

#### A.13.1.3: Data Isolation

**Requirement:**
> Data of different organizations/users shall be isolated.

**Implementation:**

```typescript
// Connection Layer: Each user/agent has isolated session
class WebClientConnectionManager {
  private sessions: Map<WebSocket, {
    userId: string
    username: string
    machineAccess: string[] // Machines this user can access
  }>
  
  // Authorization check before any operation
  canUserAccessMachine(userId: string, machineId: string): boolean {
    const session = this.sessions.get(ws)
    if (!session) return false
    return session.machineAccess.includes(machineId)
  }
}

// Domain Layer: Services respect authorization
class MachineService {
  async getMetrics(userId: string, machineId: string) {
    // Step 1: Verify user can access this machine
    if (!this.authService.canAccess(userId, machineId)) {
      throw new UnauthorizedAccessError(userId, machineId)
    }
    
    // Step 2: Fetch and return only this machine's data
    return this.machineRepo.findById(machineId)
  }
}

// Evidence: Security test
describe('Data Isolation', () => {
  test('User A cannot access User B machines', async () => {
    const userA = 'user-a'
    const userB = 'user-b'
    const machineB = 'machine-b'
    
    // User B owns machine B
    await authService.grantAccess(userB, machineB)
    
    // User A tries to access
    const result = await machineService.getMetrics(userA, machineB)
    
    expect(result).toBeNull() // or throws error
    expect(auditLog).toContainEvent({
      action: 'access_denied',
      userId: userA,
      reason: 'unauthorized'
    })
  })
})
```

---

### 2.3 A.12.4: Logging and Monitoring

#### A.12.4.1: Event Logging

**Requirement:**
> User and administrator activities, system exceptions and security events shall be recorded.

**Implementation:**

```typescript
// AuditService logs all security-relevant events
class AuditService {
  private loggers: ILogger[] // Can be file, database, SIEM, etc.
  
  async logSecurityEvent(event: {
    eventType: 'user_login' | 'command_execution' | 'access_denied' | 'scan_completed'
    userId?: string
    machineId?: string
    details: Record<string, any>
    timestamp: Date
    severity: 'low' | 'medium' | 'high' | 'critical'
  }) {
    const auditEntry = {
      ...event,
      id: uuid(),
      signature: this.sign(event) // Tamper detection
    }
    
    // 1. Log to file
    await this.fileLogger.log(auditEntry)
    
    // 2. Store to database (for historical analysis)
    await this.auditLogRepository.create(auditEntry)
    
    // 3. If critical: alert
    if (event.severity === 'critical') {
      await this.alertManager.notify(auditEntry)
    }
  }
}

// Evidence: Log entry example
{
  id: 'audit-20251206-001',
  eventType: 'command_execution',
  userId: 'user-123',
  machineId: 'mach-456',
  command: 'df -h',
  timestamp: '2025-12-06T10:30:45.123Z',
  result: 'success',
  exitCode: 0,
  duration: 245,
  severity: 'low',
  signature: 'hmac-sha256-...' // Prevents tampering
}
```

**Logging Coverage:**

| Event | Logger Call | Layer | Fields |
|-------|------------|-------|--------|
| User Login | `auditService.logUserLogin()` | Infrastructure | userId, ip, timestamp, status |
| Command Execution | `auditService.logCommandExecution()` | Domain | userId, machineId, command, exitCode |
| Access Denied | `auditService.logAccessDenied()` | Connection | userId, resource, reason |
| Security Scan | `auditService.logSecurityScan()` | Domain | machineId, scanId, findings |
| Configuration Change | `auditService.logConfigChange()` | Domain | userId, oldValue, newValue |

---

## 3. CREST Compliance

### 3.1 CREST Technical Requirements

**CREST Test Security Requirements:**
- Clear scope definition
- Repeatable and documented methodology
- Evidence collection for findings
- Professional code quality
- Secure handling of sensitive data

**Implementation in New Architecture:**

```typescript
// 1. Scope Definition (documented in architecture docs)
// 2. Repeatable Methodology (standardized message formats)
// 3. Evidence Collection (audit logs)
// 4. Code Quality (TypeScript + ESLint + SonarQube)
// 5. Sensitive Data (secrets never logged, JWT tokens in separate audit log)
```

### 3.2 Security Testing Standards

**CREST requires:**
1. **Input Validation Testing** ✅ Protocol Layer + Unit Tests
2. **Authentication Testing** ✅ JwtAuthService + Integration Tests
3. **Authorization Testing** ✅ Connection Layer + Security Tests
4. **Cryptography Testing** ✅ Secret Key Manager + Unit Tests
5. **Configuration Testing** ✅ ServerConfig + Tests

**Evidence Directory Structure:**
```
docs/architecture/
├── security-testing/
│   ├── 01-input-validation-tests.md
│   ├── 02-authentication-tests.md
│   ├── 03-authorization-tests.md
│   ├── 04-cryptography-tests.md
│   └── 05-configuration-tests.md
└── test-results/
    ├── unit-test-coverage.json
    ├── security-scan-results.json
    └── penetration-test-report.pdf
```

---

## 4. ISO/IEC 17025:2017 Mapping

### 4.1 General Requirements

#### 4.2 Personnel Competence

**Requirement:** Documented procedures for ensuring personnel competence

**Implementation:**

```markdown
docs/DEVELOPMENT_PROCESS.md
├── 1. Developer Onboarding
│   ├── Architecture training (01-ARCHITECTURE-OVERVIEW.md)
│   ├── Code review process (08-CODE-REVIEW-CHECKLIST.md)
│   └── Security guidelines (SECURITY_GUIDELINES.md)
├── 2. Code Quality Standards
│   ├── TypeScript strict mode required
│   ├── SonarQube quality gate ≥ A
│   ├── Test coverage ≥ 85%
│   └── All tests must pass before merge
└── 3. Documentation
    ├── Every module has README
    ├── Every public function has JSDoc
    └── Every security decision documented
```

#### 4.3 Infrastructure & Environment

**Requirement:** Appropriate infrastructure for testing activities

**Implementation:**

```typescript
// Development Environment
src/config/environments.ts:
- DEVELOPMENT: Full logging, mock databases
- TEST: Isolated databases, fast feedback
- PRODUCTION: Security hardened, monitoring enabled

// Infrastructure as Code
docker-compose.test.yml:
- PostgreSQL for test isolation
- Redis for session cache
- All services containerized for reproducibility
```

#### 4.4 Metrological Traceability

**Requirement:** Measurements traceable to SI standards

**Implementation:**

```typescript
// Timestamps: ISO 8601 with millisecond precision
timestamp: new Date().toISOString() // "2025-12-06T10:30:45.123Z"

// Measurement data: SI units
{
  cpuUsage: 45.2, // Percent (0-100)
  ramUsage: 8192, // Megabytes
  diskUsage: 256, // Gigabytes
  uptime: 86400, // Seconds
  responseTime: 245 // Milliseconds
}

// Audit Trail: Full traceability
{
  measurement_id: 'meas-20251206-001',
  machine_id: 'mach-456',
  timestamp: '2025-12-06T10:30:45.123Z',
  measurement_type: 'cpu_usage',
  value: 45.2,
  unit: 'percent',
  measurement_method: 'proc-stat-parser',
  calibration_date: '2025-12-01T00:00:00Z',
  next_calibration: '2026-12-01T00:00:00Z'
}
```

### 4.2 Technical Requirements (8.0)

#### 8.2 Selection and Verification of Methods

**Requirement:** Testing methods shall be appropriate and documented

**Implementation:**

```markdown
# Testing Methods Documentation

## Unit Testing Method
- Framework: Jest
- Coverage Threshold: 85%
- Execution: npm test
- Documentation: Each test file

## Integration Testing Method
- Scope: Between layers
- Setup: Docker Compose
- Coverage: Critical paths
- Documentation: Integration tests

## Security Testing Method
- Input validation fuzzing
- Injection attempt detection
- Authentication bypass attempts
- Authorization boundary testing
```

#### 8.3 Evaluation of Measurement Uncertainty

**Requirement:** Uncertainty in measurements must be evaluated

**Implementation:**

```typescript
// Performance Metrics with Uncertainty
class PerformanceMetrics {
  // Measurement uncertainty ±2% due to OS jitter
  cpuUsage: {
    value: 45.2,
    unit: 'percent',
    uncertainty: '±2%',
    confidence: '95%' // 2-sigma
  }
  
  // Logging response time with capture
  logResponseTime(duration: number) {
    // Duration measured from message receive to send
    // Uncertainty sources:
    // - Network latency: ±5ms
    // - Disk I/O: ±10ms
    // - CPU scheduling: ±1ms
    // Total uncertainty: ±16ms
    this.metrics.push({
      duration,
      uncertainty: 16,
      sources: ['network', 'disk_io', 'cpu_scheduling']
    })
  }
}
```

#### 8.4 Ensuring Validity of Results

**Requirement:** Quality assurance for test results

**Implementation:**

```typescript
// Quality Assurance Checklist
class QualityAssurance {
  async verifyTestResult(commandId: string): Promise<boolean> {
    const result = await commandRepository.findById(commandId)
    
    // Checklist
    const checks = {
      dataIntegrity: await this.checkChecksum(result),
      completeness: this.checkAllFieldsPresent(result),
      reasonableness: this.checkValuesAreReasonable(result),
      traceability: this.checkAuditTrail(commandId),
      authorization: await this.checkAuthorization(result)
    }
    
    const allPassed = Object.values(checks).every(v => v === true)
    
    if (!allPassed) {
      logger.error('QA_FailedChecks', { commandId, checks })
    }
    
    return allPassed
  }
}
```

---

## 5. Compliance Checklist for Implementation

### 5.1 Infrastructure Layer Compliance

- [ ] **A.14.2.1 - Input Validation**: WebSocket auth required before connection
- [ ] **A.14.2.5 - Authentication**: JWT token validation implemented
- [ ] **A.12.4.1 - Logging**: All authentication attempts logged
- [ ] **CREST - Auth Testing**: Unit tests for token validation
- [ ] **ISO 17025 - Methods**: Auth method documented

### 5.2 Connection Layer Compliance

- [ ] **A.13.1.3 - Data Isolation**: Per-user connection isolation verified
- [ ] **A.12.4.1 - Logging**: Access attempts logged with user/machine
- [ ] **CREST - Authorization Testing**: Boundary testing in place
- [ ] **ISO 17025 - Traceability**: Session tracking with IDs

### 5.3 Protocol Layer Compliance

- [ ] **A.14.2.1 - Input Validation**: Message schema validation
- [ ] **CREST - Injection Testing**: SQL injection tests present
- [ ] **CREST - Format Testing**: Oversized input rejection tested
- [ ] **ISO 17025 - Methods**: Validation method documented

### 5.4 Domain Layer Compliance

- [ ] **A.12.4.1 - Logging**: All commands logged with context
- [ ] **A.13.1.3 - Authorization**: Verify user access before operation
- [ ] **CREST - Complete**: Full audit trail for every action
- [ ] **ISO 17025 - Uncertainty**: Measurement uncertainty documented

---

## 6. Compliance Evidence Collection

### 6.1 Automated Evidence

```bash
# Test Coverage Report (CI/CD generates weekly)
npm run test:coverage

# Security Scan (SonarQube)
npm run sonar:scan

# Type Safety Check (TypeScript)
npm run type-check

# Dependency Audit (npm)
npm audit --audit-level=moderate

# Code Quality (ESLint)
npm run lint
```

### 6.2 Manual Audit Evidence

```markdown
docs/architecture/compliance/
├── code-review-log.md        (All code reviews)
├── security-testing-log.md   (All security tests)
├── incident-log.md           (Security incidents)
├── deployment-log.md         (All deployments)
└── training-records.md       (Developer training)
```

---

## 7. Implementation Roadmap

### Phase 1: Foundation (Week 1-2)
- [ ] Implement Infrastructure Layer with full logging
- [ ] Generate compliance documentation
- [ ] Set up audit logging database

### Phase 2: Build (Week 3-4)
- [ ] Implement remaining layers
- [ ] Add security tests per CREST requirements
- [ ] Document testing methods

### Phase 3: Verification (Week 5)
- [ ] Internal security audit
- [ ] Compliance checklist review
- [ ] Gap analysis

### Phase 4: Certification (Week 6+)
- [ ] External audit kickoff
- [ ] Evidence package delivery
- [ ] Certification body review

---

## 8. Contact & Escalation

**Compliance Owner:** [Name]  
**Security Lead:** [Name]  
**QA Lead:** [Name]  

**Escalation Path:**
1. Compliance question → Compliance Owner
2. Security concern → Security Lead
3. Test quality issue → QA Lead
4. Certification blocker → Project Manager

---

**Document Version:** 1.0  
**Last Updated:** 2025-12-06  
**Next Review:** 2025-12-13

