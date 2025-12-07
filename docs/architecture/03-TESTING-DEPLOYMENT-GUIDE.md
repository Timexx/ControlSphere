# Testing & Deployment Guide
**Version:** 1.0  
**Date:** 2025-12-06  
**Status:** Implementation Reference  

---

## 1. Testing Strategy Overview

### 1.1 Testing Pyramid

```
                        ▲
                       /|\
                      / | \
                     /  |  \  E2E Tests (5%)
                    /   |   \
                   /    |    \
                  /     |     \
                 /      |      \ Integration Tests (25%)
                /       |       \
               /        |        \
              /         |         \
             /___________|_________\ Unit Tests (70%)
```

**Coverage Target: ≥ 85%**

---

## 2. Unit Testing Guide

### 2.1 Unit Test Template

```typescript
// src/infrastructure/auth/__tests__/JwtAuthService.test.ts

import { JwtAuthService } from '../JwtAuthService'
import { ServerConfig } from '../../config/ServerConfig'

describe('JwtAuthService', () => {
  let service: JwtAuthService
  let config: ServerConfig

  beforeEach(() => {
    config = {
      JWT_SECRET: 'test-secret-key-at-least-32-chars-long!!!!',
      SECRET_VERSION: 'test-v1'
    } as ServerConfig
    service = new JwtAuthService(config)
  })

  describe('generateToken', () => {
    test('should generate valid JWT token', () => {
      const token = service.generateToken('user-123', 'john')
      expect(token).toBeDefined()
      expect(typeof token).toBe('string')
      expect(token.split('.').length).toBe(3) // JWT format
    })

    test('should include user claims in token', () => {
      const token = service.generateToken('user-123', 'john')
      const payload = service.verifyToken(token)
      expect(payload?.userId).toBe('user-123')
      expect(payload?.username).toBe('john')
    })

    test('should set token expiry to 24 hours', () => {
      const token = service.generateToken('user-123', 'john')
      const payload = service.verifyToken(token)
      const expiryDiff = payload!.exp - payload!.iat
      expect(expiryDiff).toBe(86400) // 24 hours in seconds
    })

    test('should include secret version for rotation tracking', () => {
      const token = service.generateToken('user-123', 'john')
      const payload = service.verifyToken(token)
      expect(payload?.secretVersion).toBe('test-v1')
    })
  })

  describe('verifyToken', () => {
    test('should verify valid token', () => {
      const token = service.generateToken('user-123', 'john')
      const payload = service.verifyToken(token)
      expect(payload).not.toBeNull()
    })

    test('should reject tampered token', () => {
      const token = service.generateToken('user-123', 'john')
      const tampered = token.slice(0, -10) + 'tampered!!'
      const payload = service.verifyToken(tampered)
      expect(payload).toBeNull()
    })

    test('should reject expired token', async () => {
      // Create token with 1 second expiry
      const token = service.generateTokenWithExpiry('user-123', 'john', 1)
      await new Promise(resolve => setTimeout(resolve, 1100))
      const payload = service.verifyToken(token)
      expect(payload).toBeNull()
    })

    test('should reject token with different secret version', () => {
      const token = service.generateToken('user-123', 'john')
      // Simulate secret rotation
      service.config.SECRET_VERSION = 'test-v2'
      const payload = service.verifyToken(token)
      expect(payload).toBeNull()
    })

    test('should reject malformed token', () => {
      const payload = service.verifyToken('not.a.token')
      expect(payload).toBeNull()
    })

    test('should reject URL-encoded token issues', () => {
      const token = service.generateToken('user-123', 'john')
      const malformed = token.replace(/\./g, '%2E')
      const payload = service.verifyToken(malformed)
      // Should still work after URL decoding attempt
      expect(payload).not.toBeNull()
    })
  })

  describe('Security Requirements', () => {
    test('should have no hardcoded secrets in code', () => {
      const sourceCode = require('fs').readFileSync(__filename, 'utf8')
      expect(sourceCode).not.toMatch(/secret.*=.*['\"].*['\"]/i)
    })

    test('should reject weak secrets on initialization', () => {
      expect(() => {
        new JwtAuthService({
          JWT_SECRET: 'weak',
          SECRET_VERSION: 'v1'
        } as any)
      }).toThrow('JWT_SECRET too weak')
    })
  })

  describe('Logging & Audit', () => {
    test('should log failed token verification attempts', () => {
      const logSpy = jest.spyOn(console, 'warn')
      service.verifyToken('invalid.token.here')
      expect(logSpy).toHaveBeenCalled()
      logSpy.mockRestore()
    })
  })
})
```

### 2.2 Unit Test Checklist Per Module

Every module must have unit tests covering:

- [ ] **Happy Path:** Normal operation with valid inputs
- [ ] **Error Cases:** Invalid inputs, edge cases
- [ ] **Security:** Authorization, injection, overflow
- [ ] **Performance:** No O(n²) operations, timeout handling
- [ ] **Logging:** Critical events logged
- [ ] **Cleanup:** Resources released (connections closed, etc.)

---

## 3. Integration Testing Guide

### 3.1 Integration Test Template

```typescript
// src/__tests__/integration/auth-flow.test.ts

import { HttpServer } from '../../infrastructure/http/HttpServer'
import { WebSocketUpgradeHandler } from '../../infrastructure/websocket/WebSocketUpgradeHandler'
import { JwtAuthService } from '../../infrastructure/auth/JwtAuthService'
import WebSocket from 'ws'

describe('Authentication Flow Integration', () => {
  let server: HttpServer
  let wsHandler: WebSocketUpgradeHandler
  let authService: JwtAuthService
  let wsClient: WebSocket

  beforeAll(async () => {
    // Setup server
    authService = new JwtAuthService(config)
    wsHandler = new WebSocketUpgradeHandler(authService)
    server = new HttpServer(config, authService)
    await server.start()
  })

  afterAll(async () => {
    await server.stop()
  })

  afterEach(() => {
    if (wsClient?.readyState === WebSocket.OPEN) {
      wsClient.close()
    }
  })

  test('authenticated web client should connect successfully', async () => {
    return new Promise((resolve, reject) => {
      // Generate valid token
      const token = authService.generateToken('user-123', 'john')

      // Try to connect
      wsClient = new WebSocket(`ws://localhost:3000/ws/web`, {
        headers: {
          cookie: `session=${token}`
        }
      })

      wsClient.on('open', () => {
        expect(wsClient.readyState).toBe(WebSocket.OPEN)
        resolve(undefined)
      })

      wsClient.on('error', reject)
      setTimeout(() => reject(new Error('Timeout')), 5000)
    })
  })

  test('unauthenticated client should be rejected', async () => {
    return new Promise((resolve, reject) => {
      wsClient = new WebSocket(`ws://localhost:3000/ws/web`)

      wsClient.on('close', (code) => {
        expect(code).toBe(1008) // Policy violation
        resolve(undefined)
      })

      wsClient.on('error', reject)
      setTimeout(() => reject(new Error('Timeout')), 5000)
    })
  })

  test('client with expired token should be rejected', async () => {
    return new Promise((resolve, reject) => {
      const expiredToken = authService.generateTokenWithExpiry('user-123', 'john', 0)
      await sleep(100)

      wsClient = new WebSocket(`ws://localhost:3000/ws/web`, {
        headers: {
          cookie: `session=${expiredToken}`
        }
      })

      wsClient.on('close', (code) => {
        expect(code).toBe(1008)
        resolve(undefined)
      })

      wsClient.on('error', reject)
      setTimeout(() => reject(new Error('Timeout')), 5000)
    })
  })
})
```

---

## 4. Security Testing Guide

### 4.1 Input Validation Security Tests

```typescript
// src/protocol/__tests__/security/input-validation.test.ts

describe('Protocol Layer: Input Validation Security', () => {
  let validator: MessageValidator

  beforeEach(() => {
    validator = new MessageValidator()
  })

  describe('SQL Injection Protection', () => {
    test('should reject SQL injection in command field', () => {
      const malicious = {
        type: 'execute_command',
        data: {
          command: "'; DROP TABLE machines; --"
        }
      }
      const result = validator.validate(malicious)
      expect(result.isValid).toBe(false)
      expect(result.errors).toContain(expect.stringContaining('injection'))
    })

    test('should reject UNION-based SQL injection', () => {
      const malicious = {
        type: 'execute_command',
        data: {
          command: "df -h' UNION SELECT * FROM users --"
        }
      }
      const result = validator.validate(malicious)
      expect(result.isValid).toBe(false)
    })
  })

  describe('Buffer Overflow Protection', () => {
    test('should reject oversized command (>10MB)', () => {
      const huge = {
        type: 'execute_command',
        data: {
          command: 'x'.repeat(10 * 1024 * 1024 + 1)
        }
      }
      const result = validator.validate(huge)
      expect(result.isValid).toBe(false)
      expect(result.errors).toContain(expect.stringContaining('size'))
    })
  })

  describe('Path Traversal Protection', () => {
    test('should reject path traversal attempts', () => {
      const traversal = {
        type: 'execute_command',
        data: {
          command: 'cat ../../../../etc/passwd'
        }
      }
      const result = validator.validate(traversal)
      // May be valid command, but logged as suspicious
      if (result.isValid) {
        expect(result.warnings).toContain(expect.stringContaining('path traversal'))
      }
    })
  })

  describe('Type Coercion Protection', () => {
    test('should not accept numeric values as command string', () => {
      const typeCoercion = {
        type: 'execute_command',
        data: {
          command: 123 // number instead of string
        }
      }
      const result = validator.validate(typeCoercion)
      expect(result.isValid).toBe(false)
    })

    test('should not accept null as command', () => {
      const nullValue = {
        type: 'execute_command',
        data: {
          command: null
        }
      }
      const result = validator.validate(nullValue)
      expect(result.isValid).toBe(false)
    })
  })

  describe('Cross-Site Scripting (XSS) Prevention', () => {
    test('should sanitize HTML/JS in output fields', () => {
      const xssPayload = {
        type: 'command_output',
        data: {
          output: '<img src=x onerror="alert(\'xss\')">'
        }
      }
      const result = validator.validate(xssPayload)
      const sanitized = result.sanitizedData?.data?.output
      expect(sanitized).not.toContain('onerror')
    })
  })
})
```

### 4.2 Authorization Security Tests

```typescript
// src/__tests__/security/authorization.test.ts

describe('Authorization Security', () => {
  let connectionManager: WebClientConnectionManager
  let machineService: MachineService
  let user1Session: WebSocket
  let user2Session: WebSocket

  beforeEach(() => {
    connectionManager = new WebClientConnectionManager()
    machineService = new MachineService(machineRepo, auditService)
  })

  test('user should not access other users machines', async () => {
    // Setup: User 2 owns machine B
    connectionManager.registerSession(user2Session, {
      userId: 'user-2',
      username: 'alice',
      machineAccess: ['machine-b']
    })

    // Try: User 1 access User 2's machine
    const result = await machineService.getStatus('user-1', 'machine-b')

    expect(result).toBeNull()
    expect(auditLog).toContainEvent({
      type: 'access_denied',
      userId: 'user-1',
      machineId: 'machine-b'
    })
  })

  test('user can access their own machines', async () => {
    connectionManager.registerSession(user1Session, {
      userId: 'user-1',
      username: 'bob',
      machineAccess: ['machine-a']
    })

    const result = await machineService.getStatus('user-1', 'machine-a')
    expect(result).not.toBeNull()
  })

  test('privilege escalation attempts should be blocked', async () => {
    // Attacker tries to modify JWT to add access to other machines
    const validToken = authService.generateToken('user-1', 'bob')
    // Attempt to forge admin token (will fail with valid signature check)
    const forgedToken = createFakeAdminToken()

    const payload = authService.verifyToken(forgedToken)
    expect(payload).toBeNull()
  })
})
```

---

## 5. Test Execution & Coverage

### 5.1 Running Tests

```bash
# Run all tests
npm test

# Run with coverage
npm test -- --coverage

# Run specific test file
npm test -- __tests__/JwtAuthService.test.ts

# Run only security tests
npm test -- --testPathPattern=security

# Run with watch mode (development)
npm test -- --watch

# Generate coverage report
npm run test:coverage
```

### 5.2 Coverage Thresholds (enforced by CI)

```javascript
// jest.config.js
module.exports = {
  coverageThresholds: {
    global: {
      branches: 85,
      functions: 85,
      lines: 85,
      statements: 85
    },
    './src/infrastructure/': {
      branches: 90,  // Auth is critical
      functions: 90,
      lines: 90,
      statements: 90
    },
    './src/protocol/': {
      branches: 95,  // Input validation is critical
      functions: 95,
      lines: 95,
      statements: 95
    }
  }
}
```

### 5.3 Coverage Report Analysis

```bash
# Generate HTML coverage report
npm test -- --coverage

# Open report
open coverage/lcov-report/index.html
```

Expected output:
```
---------- Coverage summary -----------
Statements   : 87.3% ( 1250/1432 )
Branches     : 86.1% ( 445/516 )
Functions    : 88.2% ( 89/101 )
Lines        : 87.9% ( 1180/1343 )
-------------------------------------------
```

---

## 6. CI/CD Integration Testing

### 6.1 GitHub Actions Workflow

```yaml
# .github/workflows/test.yml
name: Test & Coverage

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    
    steps:
      - uses: actions/checkout@v3
      
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'
      
      - run: npm ci
      
      - run: npm run type-check
      
      - run: npm run lint
      
      - run: npm test -- --coverage
      
      - uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info
          fail_ci_if_error: true
          verbose: true
      
      - name: Check coverage threshold
        run: npm run test:threshold
```

---

## 7. Deployment Testing

### 7.1 Pre-Deployment Checklist

```markdown
## Pre-Deployment Security Checklist

- [ ] All tests passing (100% CI green)
- [ ] Coverage ≥ 85% overall
- [ ] Security tests passed (no injection/bypass found)
- [ ] Type checking: `npm run type-check` passes
- [ ] Linting: `npm run lint` passes (0 errors)
- [ ] Code review approved (2+ approvals)
- [ ] Security review completed
- [ ] Performance regression tests passed
- [ ] Database migration tested
- [ ] Secrets not in code (npm audit passed)
- [ ] Documentation updated
- [ ] Rollback plan documented

## Sign-Off
- [ ] Tech Lead approval
- [ ] Security approval
- [ ] Product approval
```

### 7.2 Deployment Stages

```
┌─ STAGE 0: Build & Test (CI/CD)
│  ├─ Compile TypeScript
│  ├─ Run all tests
│  ├─ Generate coverage
│  └─ Security scan
│
├─ STAGE 1: Canary Deployment (5% traffic)
│  ├─ Deploy new server.ts to 1 instance
│  ├─ Monitor error rate (target: 0% increase)
│  ├─ Monitor response time (target: ±5%)
│  ├─ Monitor resource usage
│  └─ Verify audit logs working
│
├─ STAGE 2: Progressive Rollout (25% → 50% → 100%)
│  ├─ If canary stable: roll out to more instances
│  ├─ Continue monitoring
│  ├─ Prepare rollback if issues
│  └─ Verify all machines reconnect properly
│
└─ STAGE 3: Post-Deployment Verification
   ├─ Run smoke tests
   ├─ Verify audit trail complete
   ├─ Check for security events
   └─ Get stakeholder sign-off
```

### 7.3 Smoke Tests (Post-Deployment)

```typescript
// src/__tests__/smoke/post-deployment.test.ts

describe('Post-Deployment Smoke Tests', () => {
  test('Server should start on configured port', async () => {
    const response = await fetch('http://localhost:3000/health')
    expect(response.status).toBe(200)
  })

  test('WebSocket endpoint should be accessible', async () => {
    const ws = new WebSocket('ws://localhost:3000/ws/web')
    // Should connect (or reject with auth, not 404)
    // Wait for response
    await new Promise((resolve, reject) => {
      ws.on('open', () => resolve(null))
      ws.on('close', () => resolve(null))
      setTimeout(() => reject(new Error('Timeout')), 5000)
    })
  })

  test('JWT authentication should work', async () => {
    const token = authService.generateToken('test-user', 'test')
    expect(authService.verifyToken(token)).not.toBeNull()
  })

  test('Database connection should be healthy', async () => {
    const health = await prisma.$queryRaw`SELECT 1`
    expect(health).toBeTruthy()
  })

  test('Audit logging should work', async () => {
    const logCount = await auditLogRepository.count()
    expect(logCount).toBeGreaterThanOrEqual(0)
  })
})
```

---

## 8. Rollback Procedure

### 8.1 Rollback Decision Criteria

**Automatic Rollback triggered if:**
- Error rate > 5% (vs baseline)
- Response time > 1000ms (vs 200-300ms baseline)
- Pod crashes repeatedly
- Database connection errors > 10%
- Security events detected

### 8.2 Rollback Steps

```bash
# 1. Identify issue
kubectl logs -f deployment/server --tail=100

# 2. Prepare rollback
git tag pre-migration-backup
git checkout server.js.backup

# 3. Rebuild old server.js version
npm run build

# 4. Deploy rollback
kubectl rollout undo deployment/server
kubectl rollout status deployment/server

# 5. Verify rollback
curl http://localhost:3000/health
npm run test:smoke

# 6. Post-mortem
# - Analyze what went wrong
# - Fix in new refactoring
# - Deploy again after fixes
```

---

## 9. Monitoring Post-Deployment

### 9.1 Key Metrics to Monitor (First 7 Days)

```
HTTP Endpoints:
  - Response time (target: 95th percentile < 500ms)
  - Error rate (target: < 0.1%)
  - Request throughput (target: ≥ baseline)

WebSocket Connections:
  - Active connections (target: match baseline)
  - Connection establishment time (target: < 100ms)
  - Disconnection rate (target: 0% unexpected)

Database:
  - Query latency (target: < 50ms p95)
  - Connection pool usage (target: < 80%)
  - Lock wait times (target: 0)

Security:
  - Failed auth attempts (target: log all)
  - Access denials (target: 0 should be 0)
  - Audit log writes (target: 100% success)

Application:
  - Memory usage (target: stable, no leaks)
  - CPU usage (target: < 70%)
  - Goroutine count (if Go) or async operations (JS)
```

### 9.2 Alerting Rules

```yaml
# Prometheus alerting rules
groups:
  - name: server-deployment
    interval: 30s
    rules:
      - alert: HighErrorRate
        expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.05
        for: 5m
        annotations:
          summary: "High error rate detected"
          
      - alert: WebSocketDisconnectRateHigh
        expr: rate(websocket_disconnects_total[5m]) > 0.1
        for: 5m
        annotations:
          summary: "Unexpected WebSocket disconnects"
          
      - alert: DatabaseLatencyHigh
        expr: histogram_quantile(0.95, db_query_duration_seconds) > 0.05
        for: 5m
        annotations:
          summary: "Database latency spike"
```

---

## 10. Documentation & Sign-Off

### 10.1 Deployment Report Template

```markdown
# Deployment Report: Architecture Refactoring

**Date:** 2025-12-[XX]  
**Release Version:** v2.0-refactored  
**Deployed By:** [Name]  
**Reviewed By:** [Names]  

## Changes Summary
- [x] Migrated to 4-layer architecture
- [x] Implemented 45 new TypeScript modules
- [x] Added 250+ unit tests (85%+ coverage)
- [x] Full audit logging implemented
- [x] Zero security vulnerabilities found

## Deployment Phases
- [x] Phase 1: Canary (5% traffic) - PASSED
- [x] Phase 2: Progressive rollout - PASSED
- [x] Phase 3: Full deployment - PASSED

## Metrics (Post-Deployment)
- Response time: 245ms (↓ 5% vs old)
- Error rate: 0.02% (stable)
- Audit logs: 100% success
- No security events

## Sign-Off
- [x] Tech Lead: [Signature]
- [x] Security: [Signature]
- [x] Product: [Signature]

**Status:** ✅ COMPLETE
```

---

**Document Version:** 1.0  
**Last Updated:** 2025-12-06
