# Audit Logging Enhancement Plan für ISO-Zertifizierungen

**Version:** 1.0  
**Datum:** 7. Dezember 2025  
**Ziel:** Umfassendes Audit-Logging für ISO/IEC 27001:2022, CREST & ISO/IEC 17025:2017 Compliance

---

## 1. Executive Summary

Aktuell werden bereits grundlegende Security-Events (Command Execution, Shell Sessions, Agent Events) geloggt. Für ISO-Zertifizierungen müssen wir das Audit-Logging auf **alle sicherheitsrelevanten Systemaktivitäten** ausweiten.

### Aktuelle Situation
✅ **Bereits geloggt:**
- Command Execution (`COMMAND_EXEC`)
- Shell Sessions (`SHELL_OPEN`, `SHELL_CLOSE`)
- Agent Events (`AGENT_EVENT`)
- Terminal Sessions (`SESSION_CREATED`, `SESSION_ENDED`)
- Rate Limiting (`RATE_LIMIT_EXCEEDED`)
- Security Events (HMAC, Replay Detection)

❌ **Fehlende Audit-Events für ISO 27001:**
- User Management (Create, Update, Delete, Password Changes)
- Authentication Events (Login, Logout, Failed Attempts, Session Expiry)
- Authorization Failures (Access Denied)
- Configuration Changes (System Settings, Security Policies)
- Data Access (Machine Details, Sensitive Information)
- Administrative Actions (Machine Registration, Deletion, Group Management)
- Security Policy Changes
- Secret Key Rotation
- Bulk Operations
- API Access

---

## 2. ISO 27001:2022 Anforderungen (A.12.4.1)

### Pflicht-Events nach ISO 27001

| Kategorie | Event | Severity | Pflichtfelder |
|-----------|-------|----------|---------------|
| **Authentication** | User Login Success | info | userId, username, ip, timestamp, method |
| | User Login Failed | warn | username, ip, timestamp, reason |
| | User Logout | info | userId, username, sessionDuration |
| | Session Expired | info | userId, username, sessionId |
| | Password Changed | warn | userId, changedBy, timestamp |
| | Failed Password Attempt | warn | userId, attemptCount, ip |
| **Authorization** | Access Denied | warn | userId, resource, action, reason |
| | Privilege Escalation Attempt | critical | userId, requestedRole, currentRole |
| **User Management** | User Created | info | newUserId, createdBy, timestamp |
| | User Updated | info | userId, updatedBy, changedFields |
| | User Deleted | warn | userId, deletedBy, timestamp |
| **Machine Management** | Machine Registered | info | machineId, hostname, ip, registeredBy |
| | Machine Deleted | warn | machineId, hostname, deletedBy |
| | Machine Secret Rotated | warn | machineId, rotatedBy, timestamp |
| **Configuration** | System Config Changed | warn | configKey, oldValue, newValue, changedBy |
| | Security Policy Changed | critical | policyId, changes, changedBy |
| | Group Created/Modified | info | groupId, action, changedBy |
| **Data Access** | Sensitive Data Accessed | info | userId, dataType, recordId |
| | Bulk Data Export | warn | userId, recordCount, dataType |
| **Security Events** | Security Scan Triggered | info | machineId, triggeredBy, scanType |
| | Security Event Resolved | info | eventId, resolvedBy, resolution |
| | Vulnerability Detected | critical | machineId, cveId, severity |
| **API Access** | API Key Generated | warn | userId, keyId, scope |
| | API Rate Limit Exceeded | warn | apiKeyId, endpoint, count |
| | Unauthorized API Access | critical | ip, endpoint, reason |

---

## 3. Erweiterte Event-Typen

### 3.1 Authentication & Session Management

```typescript
// Neue Actions für AuditLog
enum AuditAction {
  // Authentication
  LOGIN_SUCCESS = 'LOGIN_SUCCESS',
  LOGIN_FAILED = 'LOGIN_FAILED',
  LOGOUT = 'LOGOUT',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  SESSION_RENEWED = 'SESSION_RENEWED',
  PASSWORD_CHANGED = 'PASSWORD_CHANGED',
  PASSWORD_RESET_REQUESTED = 'PASSWORD_RESET_REQUESTED',
  MFA_ENABLED = 'MFA_ENABLED',
  MFA_DISABLED = 'MFA_DISABLED',
  
  // Authorization
  ACCESS_DENIED = 'ACCESS_DENIED',
  PRIVILEGE_ESCALATION_ATTEMPT = 'PRIVILEGE_ESCALATION_ATTEMPT',
  PERMISSION_GRANTED = 'PERMISSION_GRANTED',
  PERMISSION_REVOKED = 'PERMISSION_REVOKED',
  
  // User Management
  USER_CREATED = 'USER_CREATED',
  USER_UPDATED = 'USER_UPDATED',
  USER_DELETED = 'USER_DELETED',
  USER_LOCKED = 'USER_LOCKED',
  USER_UNLOCKED = 'USER_UNLOCKED',
  
  // Machine Management
  MACHINE_REGISTERED = 'MACHINE_REGISTERED',
  MACHINE_UPDATED = 'MACHINE_UPDATED',
  MACHINE_DELETED = 'MACHINE_DELETED',
  MACHINE_SECRET_ROTATED = 'MACHINE_SECRET_ROTATED',
  MACHINE_STATUS_CHANGED = 'MACHINE_STATUS_CHANGED',
  
  // Configuration
  CONFIG_CHANGED = 'CONFIG_CHANGED',
  SECURITY_POLICY_CREATED = 'SECURITY_POLICY_CREATED',
  SECURITY_POLICY_UPDATED = 'SECURITY_POLICY_UPDATED',
  SECURITY_POLICY_DELETED = 'SECURITY_POLICY_DELETED',
  GROUP_CREATED = 'GROUP_CREATED',
  GROUP_UPDATED = 'GROUP_UPDATED',
  GROUP_DELETED = 'GROUP_DELETED',
  
  // Data Access
  SENSITIVE_DATA_ACCESSED = 'SENSITIVE_DATA_ACCESSED',
  BULK_EXPORT = 'BULK_EXPORT',
  MACHINE_DETAILS_VIEWED = 'MACHINE_DETAILS_VIEWED',
  SECURITY_EVENTS_VIEWED = 'SECURITY_EVENTS_VIEWED',
  
  // Security Operations
  SECURITY_SCAN_TRIGGERED = 'SECURITY_SCAN_TRIGGERED',
  SECURITY_SCAN_COMPLETED = 'SECURITY_SCAN_COMPLETED',
  SECURITY_EVENT_RESOLVED = 'SECURITY_EVENT_RESOLVED',
  VULNERABILITY_DETECTED = 'VULNERABILITY_DETECTED',
  VULNERABILITY_PATCHED = 'VULNERABILITY_PATCHED',
  
  // API & Integration
  API_KEY_GENERATED = 'API_KEY_GENERATED',
  API_KEY_REVOKED = 'API_KEY_REVOKED',
  API_RATE_LIMIT_EXCEEDED = 'API_RATE_LIMIT_EXCEEDED',
  UNAUTHORIZED_API_ACCESS = 'UNAUTHORIZED_API_ACCESS',
  WEBHOOK_CONFIGURED = 'WEBHOOK_CONFIGURED',
  
  // Bulk Operations
  BULK_COMMAND_EXECUTED = 'BULK_COMMAND_EXECUTED',
  BULK_UPDATE_APPLIED = 'BULK_UPDATE_APPLIED',
  
  // Existing (keep for compatibility)
  COMMAND_EXEC = 'COMMAND_EXEC',
  SHELL_OPEN = 'SHELL_OPEN',
  SHELL_CLOSE = 'SHELL_CLOSE',
  AGENT_EVENT = 'AGENT_EVENT',
  SESSION_CREATED = 'SESSION_CREATED',
  SESSION_ENDED = 'SESSION_ENDED',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
}
```

### 3.2 Details Schema für verschiedene Event-Typen

```typescript
// LOGIN_SUCCESS Details
{
  ip: string
  userAgent: string
  method: 'password' | 'mfa' | 'api-key'
  sessionId: string
}

// ACCESS_DENIED Details
{
  resource: string
  action: string
  reason: string
  requiredPermission?: string
  currentPermissions?: string[]
}

// MACHINE_REGISTERED Details
{
  hostname: string
  ip: string
  osInfo: string
  registeredBy: string
  registrationMethod: 'manual' | 'auto'
}

// CONFIG_CHANGED Details
{
  configKey: string
  oldValue: string | null
  newValue: string
  category: 'security' | 'system' | 'network' | 'notifications'
}

// SECURITY_SCAN_COMPLETED Details
{
  scanId: string
  duration: number
  findingsCount: number
  criticalCount: number
  highCount: number
  mediumCount: number
  lowCount: number
}

// BULK_COMMAND_EXECUTED Details
{
  command: string
  targetCount: number
  successCount: number
  failureCount: number
  machineIds: string[]
}
```

---

## 4. Implementierungsplan

### Phase 1: Datenbankschema erweitern (1 Tag)

**Änderungen am AuditLog Model:**

```prisma
model AuditLog {
  id        String   @id @default(cuid())
  machineId String?
  userId    String?
  action    String   // Erweiterte Action-Liste (siehe oben)
  eventType String?  // Für Terminal/Session Events
  details   String?  // JSON mit event-spezifischen Details
  severity  String   @default("info") // info, warn, critical
  
  // Neue Felder für ISO Compliance
  ip        String?  // IP-Adresse des Initiators
  userAgent String?  // Browser/Client Info
  resource  String?  // Betroffene Ressource (z.B. "machine:abc123")
  outcome   String?  // success, failure, denied
  duration  Int?     // Dauer der Operation in ms
  
  createdAt DateTime @default(now())

  machine Machine? @relation(fields: [machineId], references: [id], onDelete: Cascade)
  user    User?    @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@index([machineId, createdAt])
  @@index([userId, createdAt])
  @@index([action])
  @@index([eventType])
  @@index([severity])
  @@index([outcome])
  @@index([createdAt])
}
```

### Phase 2: Audit Service Layer (2 Tage)

**Erstelle zentralen AuditService:**

```typescript
// src/domain/services/AuditService.ts
import { prisma } from '@/lib/prisma'
import { NextRequest } from 'next/server'

export class AuditService {
  /**
   * Log a security-relevant event
   * ISO 27001 A.12.4.1 compliant
   */
  static async log(params: {
    action: string
    userId?: string
    machineId?: string
    eventType?: string
    details?: Record<string, any>
    severity?: 'info' | 'warn' | 'critical'
    ip?: string
    userAgent?: string
    resource?: string
    outcome?: 'success' | 'failure' | 'denied'
    duration?: number
  }) {
    try {
      await prisma.auditLog.create({
        data: {
          action: params.action,
          userId: params.userId,
          machineId: params.machineId,
          eventType: params.eventType,
          details: params.details ? JSON.stringify(params.details) : null,
          severity: params.severity || 'info',
          ip: params.ip,
          userAgent: params.userAgent,
          resource: params.resource,
          outcome: params.outcome,
          duration: params.duration,
        },
      })
    } catch (error) {
      console.error('AuditLog failed:', error)
      // Never throw - audit failure shouldn't crash the app
    }
  }

  /**
   * Extract IP and UserAgent from NextRequest
   */
  static extractRequestInfo(req: NextRequest) {
    const ip = req.headers.get('x-forwarded-for') || 
               req.headers.get('x-real-ip') || 
               'unknown'
    const userAgent = req.headers.get('user-agent') || 'unknown'
    return { ip, userAgent }
  }

  /**
   * Helper: Log authentication event
   */
  static async logAuth(params: {
    action: 'LOGIN_SUCCESS' | 'LOGIN_FAILED' | 'LOGOUT'
    userId?: string
    username?: string
    ip: string
    userAgent: string
    reason?: string
    sessionId?: string
  }) {
    await this.log({
      action: params.action,
      userId: params.userId,
      severity: params.action === 'LOGIN_FAILED' ? 'warn' : 'info',
      ip: params.ip,
      userAgent: params.userAgent,
      outcome: params.action === 'LOGIN_FAILED' ? 'failure' : 'success',
      details: {
        username: params.username,
        reason: params.reason,
        sessionId: params.sessionId,
      },
    })
  }

  /**
   * Helper: Log access denial
   */
  static async logAccessDenied(params: {
    userId: string
    resource: string
    action: string
    reason: string
    ip: string
  }) {
    await this.log({
      action: 'ACCESS_DENIED',
      userId: params.userId,
      severity: 'warn',
      resource: params.resource,
      outcome: 'denied',
      ip: params.ip,
      details: {
        action: params.action,
        reason: params.reason,
      },
    })
  }

  /**
   * Helper: Log configuration change
   */
  static async logConfigChange(params: {
    userId: string
    configKey: string
    oldValue: any
    newValue: any
    category: string
  }) {
    await this.log({
      action: 'CONFIG_CHANGED',
      userId: params.userId,
      severity: 'warn',
      resource: `config:${params.configKey}`,
      outcome: 'success',
      details: {
        configKey: params.configKey,
        oldValue: params.oldValue,
        newValue: params.newValue,
        category: params.category,
      },
    })
  }

  /**
   * Helper: Log user management event
   */
  static async logUserManagement(params: {
    action: 'USER_CREATED' | 'USER_UPDATED' | 'USER_DELETED'
    performedBy: string
    targetUserId: string
    targetUsername?: string
    changes?: Record<string, any>
  }) {
    await this.log({
      action: params.action,
      userId: params.performedBy,
      severity: params.action === 'USER_DELETED' ? 'warn' : 'info',
      resource: `user:${params.targetUserId}`,
      outcome: 'success',
      details: {
        targetUsername: params.targetUsername,
        changes: params.changes,
      },
    })
  }

  /**
   * Helper: Log machine management event
   */
  static async logMachineManagement(params: {
    action: 'MACHINE_REGISTERED' | 'MACHINE_UPDATED' | 'MACHINE_DELETED' | 'MACHINE_SECRET_ROTATED'
    performedBy?: string
    machineId: string
    hostname?: string
    details?: Record<string, any>
  }) {
    await this.log({
      action: params.action,
      userId: params.performedBy,
      machineId: params.machineId,
      severity: params.action === 'MACHINE_DELETED' ? 'warn' : 'info',
      resource: `machine:${params.machineId}`,
      outcome: 'success',
      details: {
        hostname: params.hostname,
        ...params.details,
      },
    })
  }
}
```

### Phase 3: Integration in bestehende API-Routes (3 Tage)

**Beispiele für Integration:**

```typescript
// /api/auth/login/route.ts
import { AuditService } from '@/domain/services/AuditService'

export async function POST(req: NextRequest) {
  const { ip, userAgent } = AuditService.extractRequestInfo(req)
  const { username, password } = await req.json()
  
  const user = await verifyCredentials(username, password)
  
  if (!user) {
    await AuditService.logAuth({
      action: 'LOGIN_FAILED',
      username,
      ip,
      userAgent,
      reason: 'Invalid credentials',
    })
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }
  
  const sessionId = createSession(user)
  
  await AuditService.logAuth({
    action: 'LOGIN_SUCCESS',
    userId: user.id,
    username: user.username,
    ip,
    userAgent,
    sessionId,
  })
  
  return NextResponse.json({ success: true })
}

// /api/auth/logout/route.ts
export async function POST(req: NextRequest) {
  const session = await getSession()
  const { ip, userAgent } = AuditService.extractRequestInfo(req)
  
  if (session?.user) {
    await AuditService.logAuth({
      action: 'LOGOUT',
      userId: session.user.id,
      username: session.user.username,
      ip,
      userAgent,
    })
  }
  
  await destroySession()
  return NextResponse.json({ success: true })
}

// /api/machines/[id]/route.ts (DELETE)
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  const machine = await prisma.machine.findUnique({ where: { id: params.id } })
  
  if (!machine) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  
  await prisma.machine.delete({ where: { id: params.id } })
  
  await AuditService.logMachineManagement({
    action: 'MACHINE_DELETED',
    performedBy: session.user.id,
    machineId: params.id,
    hostname: machine.hostname,
  })
  
  return NextResponse.json({ success: true })
}

// /api/vms/[id]/security/route.ts (GET - Data Access Logging)
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  
  await AuditService.log({
    action: 'SECURITY_EVENTS_VIEWED',
    userId: session.user.id,
    machineId: params.id,
    severity: 'info',
    resource: `machine:${params.id}/security`,
    outcome: 'success',
  })
  
  const events = await prisma.securityEvent.findMany({ where: { machineId: params.id } })
  return NextResponse.json({ events })
}
```

### Phase 4: Middleware für automatisches Logging (1 Tag)

**Erstelle Audit Middleware:**

```typescript
// src/middleware/auditMiddleware.ts
import { NextRequest, NextResponse } from 'next/server'
import { AuditService } from '@/domain/services/AuditService'
import { getSession } from '@/lib/auth'

const SENSITIVE_ENDPOINTS = [
  '/api/auth/',
  '/api/machines/',
  '/api/vms/',
  '/api/groups/',
  '/api/jobs/',
]

export async function auditMiddleware(req: NextRequest) {
  const { pathname } = new URL(req.url)
  const { ip, userAgent } = AuditService.extractRequestInfo(req)
  const session = await getSession()
  
  // Log sensitive endpoint access
  if (SENSITIVE_ENDPOINTS.some(prefix => pathname.startsWith(prefix))) {
    const startTime = Date.now()
    
    // Continue with request
    const response = NextResponse.next()
    
    // Log after response
    const duration = Date.now() - startTime
    const outcome = response.status < 400 ? 'success' : 'failure'
    
    await AuditService.log({
      action: 'API_ACCESS',
      userId: session?.user?.id,
      severity: outcome === 'failure' ? 'warn' : 'info',
      resource: pathname,
      outcome,
      duration,
      ip,
      userAgent,
      details: {
        method: req.method,
        statusCode: response.status,
      },
    })
  }
  
  return NextResponse.next()
}
```

### Phase 5: Frontend-Integration (1 Tag)

**Erweitere Audit-Logs-Seite:**

```typescript
// Neue Filter-Optionen
const ACTION_CATEGORIES = {
  authentication: ['LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT', 'SESSION_EXPIRED'],
  authorization: ['ACCESS_DENIED', 'PRIVILEGE_ESCALATION_ATTEMPT'],
  userManagement: ['USER_CREATED', 'USER_UPDATED', 'USER_DELETED'],
  machineManagement: ['MACHINE_REGISTERED', 'MACHINE_UPDATED', 'MACHINE_DELETED'],
  configuration: ['CONFIG_CHANGED', 'SECURITY_POLICY_CREATED', 'SECURITY_POLICY_UPDATED'],
  dataAccess: ['SENSITIVE_DATA_ACCESSED', 'BULK_EXPORT'],
  security: ['SECURITY_SCAN_TRIGGERED', 'VULNERABILITY_DETECTED'],
}

// Neue Statistiken
const stats = {
  authenticationEvents: logs.filter(l => ACTION_CATEGORIES.authentication.includes(l.action)).length,
  failedLogins: logs.filter(l => l.action === 'LOGIN_FAILED').length,
  accessDenials: logs.filter(l => l.action === 'ACCESS_DENIED').length,
  configChanges: logs.filter(l => ACTION_CATEGORIES.configuration.includes(l.action)).length,
}
```

### Phase 6: Dokumentation & Compliance-Report (1 Tag)

**Erstelle Compliance-Report Generator:**

```typescript
// src/lib/complianceReport.ts
export async function generateISO27001Report(dateFrom: Date, dateTo: Date) {
  const logs = await prisma.auditLog.findMany({
    where: {
      createdAt: { gte: dateFrom, lte: dateTo },
    },
    include: {
      user: { select: { username: true } },
      machine: { select: { hostname: true } },
    },
  })
  
  return {
    period: { from: dateFrom, to: dateTo },
    summary: {
      totalEvents: logs.length,
      criticalEvents: logs.filter(l => l.severity === 'critical').length,
      failedLogins: logs.filter(l => l.action === 'LOGIN_FAILED').length,
      accessDenials: logs.filter(l => l.action === 'ACCESS_DENIED').length,
      configChanges: logs.filter(l => l.action === 'CONFIG_CHANGED').length,
    },
    eventsByCategory: groupByCategory(logs),
    topUsers: getTopUsers(logs),
    securityIncidents: logs.filter(l => l.severity === 'critical'),
    complianceChecks: {
      authenticationLogged: checkAuthenticationLogging(logs),
      accessControlLogged: checkAccessControlLogging(logs),
      configChangesLogged: checkConfigChangesLogging(logs),
      dataAccessLogged: checkDataAccessLogging(logs),
    },
  }
}
```

---

## 5. Priorisierung nach ISO-Relevanz

### Kritisch (Must-Have für ISO 27001)
1. ✅ Authentication Events (Login, Logout, Failed Attempts)
2. ✅ Authorization Failures (Access Denied)
3. ✅ User Management (Create, Update, Delete)
4. ✅ Configuration Changes
5. ✅ Security Policy Changes
6. ✅ Secret/Credential Rotation

### Wichtig (Should-Have)
7. Machine Management Events
8. Data Access Logging
9. API Access Logging
10. Security Scan Events

### Nice-to-Have (Good Practice)
11. Performance Metrics in Logs
12. Bulk Operation Tracking
13. Webhook Events
14. Integration Events

---

## 6. Compliance-Checkliste

### ISO/IEC 27001:2022 A.12.4.1

- [ ] Alle User-Aktivitäten werden geloggt
- [ ] Alle Administrator-Aktivitäten werden geloggt
- [ ] Alle System-Exceptions werden geloggt
- [ ] Alle Security-Events werden geloggt
- [ ] Logs enthalten Timestamp, User, Action, Outcome
- [ ] Logs sind gegen Manipulation geschützt
- [ ] Logs werden für Audit-Zwecke aufbewahrt
- [ ] Kritische Events lösen Alerts aus

### ISO/IEC 17025:2017

- [ ] Alle Test-relevanten Aktivitäten sind nachvollziehbar
- [ ] Änderungen an Konfigurationen sind dokumentiert
- [ ] Zugriffe auf Test-Daten sind geloggt

### CREST

- [ ] Penetration-Test-Aktivitäten sind geloggt
- [ ] Finding-Management ist nachvollziehbar
- [ ] Evidence-Collection ist dokumentiert

---

## 7. Zeitplan

| Phase | Aufgabe | Dauer | Abhängigkeiten |
|-------|---------|-------|----------------|
| 1 | Schema erweitern | 1 Tag | - |
| 2 | AuditService implementieren | 2 Tage | Phase 1 |
| 3 | API-Integration | 3 Tage | Phase 2 |
| 4 | Middleware | 1 Tag | Phase 2 |
| 5 | Frontend | 1 Tag | Phase 3 |
| 6 | Dokumentation | 1 Tag | Phase 5 |
| **Total** | | **9 Tage** | |

---

## 8. Testing & Validation

### Unit Tests
```typescript
describe('AuditService', () => {
  test('logs authentication success', async () => {
    await AuditService.logAuth({
      action: 'LOGIN_SUCCESS',
      userId: 'user123',
      username: 'admin',
      ip: '192.168.1.100',
      userAgent: 'Mozilla/5.0',
      sessionId: 'sess-abc',
    })
    
    const logs = await prisma.auditLog.findMany({
      where: { action: 'LOGIN_SUCCESS' },
    })
    
    expect(logs).toHaveLength(1)
    expect(logs[0].severity).toBe('info')
    expect(logs[0].outcome).toBe('success')
  })
})
```

### Integration Tests
```typescript
describe('Audit Logging Integration', () => {
  test('DELETE machine logs MACHINE_DELETED event', async () => {
    const response = await fetch('/api/machines/machine123', {
      method: 'DELETE',
      headers: { Cookie: sessionCookie },
    })
    
    expect(response.status).toBe(200)
    
    const auditLog = await prisma.auditLog.findFirst({
      where: { action: 'MACHINE_DELETED', machineId: 'machine123' },
    })
    
    expect(auditLog).toBeTruthy()
    expect(auditLog.userId).toBe(currentUser.id)
  })
})
```

---

## 9. Nächste Schritte

1. **Review & Approval**: Diesen Plan vom Team reviewen lassen
2. **Prisma Migration**: Schema-Änderungen umsetzen
3. **AuditService**: Zentralen Service implementieren
4. **Schrittweise Integration**: Pro Woche 2-3 API-Routes erweitern
5. **Testing**: Parallel zu Integration
6. **Dokumentation**: ISO-Compliance-Report erstellen
7. **Audit**: Interne Security-Audit durchführen

---

## 10. Metriken & KPIs

### Tracking während Implementation
- **Coverage**: % der API-Endpoints mit Audit-Logging
- **Event-Volume**: Anzahl Audit-Events pro Tag
- **Critical Events**: Anzahl critical-severity Events
- **Response Time**: Impact auf API-Performance
- **Compliance Score**: % erfüllte ISO-Anforderungen

### Ziel-Metriken für ISO-Zertifizierung
- ✅ 100% der Authentication-Events geloggt
- ✅ 100% der Authorization-Failures geloggt
- ✅ 100% der Admin-Actions geloggt
- ✅ 100% der Configuration-Changes geloggt
- ✅ < 10ms Overhead durch Audit-Logging

---

**Status:** ⏳ Planungsphase  
**Next:** Schema-Migration & AuditService Implementation
