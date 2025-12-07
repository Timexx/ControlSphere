# Server Architecture Refactoring Plan
**Status:** In Progress  
**Date Created:** 2025-12-06  
**Target Compliance:** ISO/IEC 27001, CREST, ISO 17025  
**Version:** 1.0

---

## 1. Executive Summary

Dieser Plan dokumentiert die Transformation des monolithischen `server/server.js` in eine modularisierte, auditierbare und ISO-konforme Architektur. Die Refaktorierung folgt **Clean Architecture** und **Layered Architecture** Prinzipien mit expliziten Verantwortlichkeitsabgrenzungen.

**Hauptziel:** Schaffung einer wartbaren, testbaren, und zertifizierungsfähigen Codebase durch Trennung der Concerns in vier dedizierte Layer.

---

## 2. Ist-Zustand Analyse

### 2.1 Aktuelle Probleme im `server.js` Monolith

| Problem | Impact | ISO-Relevanz |
|---------|--------|--------------|
| Vermischung von HTTP, WebSocket, Auth, DB in einer Datei | Hohe Komplexität, schwer zu testen | ISO 27001 A.14.2 (Secure development) |
| Keine klaren Datenbankzugriffe | Data Integrity nicht gewährleistet | ISO 27001 A.13.1 (Network security) |
| Message-Parsing inline, keine Validierung | Security Risk (Injection, Malformed) | ISO 27001 A.14.2.1 (Input validation) |
| Keine Audit-Trails auf Code-Ebene | Non-compliance mit ISO 17025 | ISO 17025 6.4.3 (Metrological traceability) |
| Business Logic gemischt mit Infrastruktur | Schwer zu wartbar und zu testen | ISO 9001-ähnliche Prinzipien |

### 2.2 Betroffene Funktionen

```
server.js (~1131 Zeilen)
├── HTTP/WebSocket Bootstrap (Zeilen 1-250)
├── JWT Secret Management (Zeilen 35-100)
├── WebSocket Connection Handler (Zeilen 250-700)
├── Agent Message Processing (Zeilen 400-800)
├── Web Client Routing (Zeilen 700-900)
├── Database Operations (über file verteilt)
├── Command Dispatch (Zeilen 125-150)
├── Output Normalization (Zeilen 15-35)
└── Event Broadcasting (Zeilen 1000-1131)
```

---

## 3. Zielarchitektur (4-Layer Model)

```
┌─────────────────────────────────────────────────────────┐
│  CLIENT LAYER (Next.js Frontend / Agent CLI)             │
└─────────────────────────────────────────────────────────┘
                         ↑ ↓
┌─────────────────────────────────────────────────────────┐
│  INFRASTRUCTURE LAYER (HTTP/WS Bootstrap, Auth, Config)  │
├─────────────────────────────────────────────────────────┤
│ • HttpServer (server start, middleware)                 │
│ • WebSocketUpgradeHandler (routing, auth)               │
│ • JwtAuthService (token generation, validation)         │
│ • SecretKeyManager (generation, storage)                │
└─────────────────────────────────────────────────────────┘
                         ↑ ↓
┌─────────────────────────────────────────────────────────┐
│  CONNECTION LAYER (Agent/Web-Client Manager)             │
├─────────────────────────────────────────────────────────┤
│ • AgentConnectionManager (lifecycle, mapping)           │
│ • WebClientConnectionManager (session tracking)         │
│ • ConnectionRegistry (discovery service)                │
└─────────────────────────────────────────────────────────┘
                         ↑ ↓
┌─────────────────────────────────────────────────────────┐
│  PROTOCOL LAYER (Message Parsing, Validation)            │
├─────────────────────────────────────────────────────────┤
│ • MessageParser (JSON extraction, error handling)       │
│ • MessageValidator (schema validation, sanitization)    │
│ • MessageRouter (type-based dispatch)                   │
│ • OutputNormalizer (chunk formatting, noise reduction)  │
└─────────────────────────────────────────────────────────┘
                         ↑ ↓
┌─────────────────────────────────────────────────────────┐
│  DOMAIN LAYER (Business Logic & Services)                │
├─────────────────────────────────────────────────────────┤
│ • CommandService (execution, tracking)                  │
│ • TerminalService (session management)                  │
│ • SecurityService (scans, events)                       │
│ • MachineService (registration, status)                 │
│ • MetricsService (collection, storage)                  │
│ • EventBroadcaster (real-time updates)                  │
│ • PortService (discovery, sync)                         │
│ • AuditService (logging, traceability)                  │
└─────────────────────────────────────────────────────────┘
                         ↑ ↓
┌─────────────────────────────────────────────────────────┐
│  DATA ACCESS LAYER (Prisma, Database)                    │
├─────────────────────────────────────────────────────────┤
│ • DatabaseClient (connection management)                │
│ • Repository Pattern für alle DB-Zugriffe              │
└─────────────────────────────────────────────────────────┘
```

---

## 4. Refactoring Phasen

### Phase 1: Planung & Dokumentation (Tag 1)
- [x] Architektur-Plan erstellen (dieses Dokument)
- [ ] Architecture Overview mit Diagrammen
- [ ] Layer-spezifische Design Docs
- [ ] Test-Strategie dokumentieren

### Phase 2: Infrastructure Layer (Tag 2-3)
- [ ] HttpServer Modul (TypeScript)
- [ ] WebSocketUpgradeHandler Modul
- [ ] JwtAuthService Modul
- [ ] SecretKeyManager Modul
- [ ] Unit Tests für alle Infrastruktur-Module
- [ ] Dokumentation: `02-INFRASTRUCTURE-LAYER.md`

### Phase 3: Connection Layer (Tag 4)
- [ ] AgentConnectionManager Modul
- [ ] WebClientConnectionManager Modul
- [ ] ConnectionRegistry Modul
- [ ] Unit Tests
- [ ] Dokumentation: `03-CONNECTION-LAYER.md`

### Phase 4: Protocol Layer (Tag 5)
- [ ] MessageParser Modul
- [ ] MessageValidator Modul
- [ ] MessageRouter Modul
- [ ] OutputNormalizer Modul
- [ ] Unit Tests
- [ ] Dokumentation: `04-PROTOCOL-LAYER.md`

### Phase 5: Domain Layer (Tag 6-8)
- [ ] CommandService Modul
- [ ] TerminalService Modul
- [ ] SecurityService Modul
- [ ] MachineService Modul
- [ ] MetricsService Modul
- [ ] EventBroadcaster Modul
- [ ] PortService Modul
- [ ] AuditService Modul
- [ ] Unit Tests für alle Services
- [ ] Dokumentation: `05-DOMAIN-LAYER.md`

### Phase 6: Integration & Migration (Tag 9)
- [ ] new server.ts erstellen (Entry Point)
- [ ] Alle Layer zusammenbinden
- [ ] Integration Tests
- [ ] Backward-Compatibility Tests

### Phase 7: Auditierung & Dokumentation (Tag 10)
- [ ] AUDIT-CHECKLIST.md mit allen Änderungen
- [ ] Code-Snippets für jede Implementierung
- [ ] Compliance-Mapping (ISO/CREST/17025)
- [ ] Deployment-Anleitung

---

## 5. ISO/IEC 27001 Compliance Mapping

### 5.1 Relevante Anforderungen

| ISO 27001 Control | Implementierung | Layer |
|-------------------|-----------------|-------|
| **A.14.2 Secure Application Development** | Code Review, Clean Code | Domain |
| **A.14.2.1 Input Validation** | MessageValidator | Protocol |
| **A.14.2.5 Secure Authentication** | JwtAuthService | Infrastructure |
| **A.13.1.3 Data Isolation** | Connection Layer Isolation | Connection |
| **A.12.4.1 Logging & Monitoring** | AuditService | Domain |
| **A.12.6.1 Management of Technical Vulnerabilities** | Unit Tests, Code Analysis | All |

### 5.2 Auditierbarkeits-Anforderungen

Jedes Modul MUSS folgende Auditierbarkeits-Eigenschaften haben:

```typescript
// 1. Explizite Error Handling
// 2. Structured Logging (mit Kontext: userId, machineId, timestamp)
// 3. Input Validation mit Reject-Gründen
// 4. Unit Tests mit 100% Critical Path Coverage
// 5. Traceability für Security Events
```

---

## 6. CREST & ISO 17025 Labore Compliance

### 6.1 Metrological Traceability (ISO 17025 6.4.3)

**Anforderung:** Nachverfolgbarkeit aller kritischen Operationen

**Implementierung:**
- AuditService loggt jeden Security Event mit `{ timestamp, userId, machineId, action, result, reason }`
- Database Schema mit `createdAt`, `updatedAt`, `createdBy` auf allen kritischen Tabellen
- Command Execution Tracking mit eindeutiger `commandId`, vollständiger Output-History

### 6.2 Technical Competence (ISO 17025 6.2)

**Anforderung:** Dokumentation aller technischen Entscheidungen und deren Begründung

**Implementierung:**
- DESIGN_DECISIONS.md mit Begründung für jede Architektur-Entscheidung
- Code Comments für komplexe Business Logic
- Test Documentation mit Test Cases und Expected Behaviors

### 6.3 Management System (ISO 17025 8.0)

**Anforderung:** Dokumentierte Prozesse und Qualitätskontrolle

**Implementierung:**
- DEVELOPMENT_PROCESS.md (Wie werden neue Features entwickelt)
- CODE_REVIEW_CHECKLIST.md (Qualitätsprüfungen vor Deployment)
- INCIDENT_RESPONSE.md (Wie werden Security Events gehandhabt)

---

## 7. Detaillierte Module-Spezifikationen

### 7.1 Infrastructure Layer

**Datei-Struktur:**
```
server/src/infrastructure/
├── http/
│   ├── HttpServer.ts (HTTP Bootstrap, Middleware)
│   └── __tests__/HttpServer.test.ts
├── websocket/
│   ├── WebSocketUpgradeHandler.ts (Routing, Auth Check)
│   ├── WebSocketConnectionManager.ts
│   └── __tests__/WebSocketUpgradeHandler.test.ts
├── auth/
│   ├── JwtAuthService.ts (Token Gen, Validation)
│   ├── SecretKeyManager.ts (Key Generation, Storage)
│   └── __tests__/JwtAuthService.test.ts
└── config/
    ├── ServerConfig.ts
    └── __tests__/ServerConfig.test.ts
```

**Responsibilities:**
- HTTP Server Setup und Lifecycle
- WebSocket Connection Establishment
- Authentication (JWT validation)
- Secret Key Management
- Configuration Loading

### 7.2 Connection Layer

**Datei-Struktur:**
```
server/src/connection/
├── AgentConnectionManager.ts (Agent Lifecycle)
├── WebClientConnectionManager.ts (Web Client Sessions)
├── ConnectionRegistry.ts (Discovery Service)
├── types/
│   ├── AgentConnection.ts
│   └── WebClientSession.ts
└── __tests__/
    ├── AgentConnectionManager.test.ts
    ├── WebClientConnectionManager.test.ts
    └── ConnectionRegistry.test.ts
```

**Responsibilities:**
- Track Agent Connections (machineId → WebSocket)
- Track Web Client Sessions (userId → WebSocket)
- Terminal Session Mapping
- Command Session Mapping
- Connection Lifecycle Events

### 7.3 Protocol Layer

**Datei-Struktur:**
```
server/src/protocol/
├── parser/
│   ├── MessageParser.ts (JSON extraction)
│   └── __tests__/MessageParser.test.ts
├── validator/
│   ├── MessageValidator.ts (Schema validation)
│   ├── schemas/ (JSON Schema definitions)
│   └── __tests__/MessageValidator.test.ts
├── router/
│   ├── MessageRouter.ts (Type-based dispatch)
│   └── __tests__/MessageRouter.test.ts
├── normalizer/
│   ├── OutputNormalizer.ts (Chunk formatting)
│   └── __tests__/OutputNormalizer.test.ts
└── types/
    ├── Message.ts (Type definitions)
    └── MessageType.ts (Enum)
```

**Responsibilities:**
- Parse JSON from binary streams
- Validate gegen Schema
- Route zu richtigem Handler
- Normalize Output Chunks
- Error Recovery (partial JSON handling)

### 7.4 Domain Layer

**Datei-Struktur:**
```
server/src/domain/
├── command/
│   ├── CommandService.ts
│   ├── types/Command.ts
│   └── __tests__/CommandService.test.ts
├── terminal/
│   ├── TerminalService.ts
│   ├── types/TerminalSession.ts
│   └── __tests__/TerminalService.test.ts
├── security/
│   ├── SecurityService.ts
│   ├── SecurityEventService.ts
│   └── __tests__/SecurityService.test.ts
├── machine/
│   ├── MachineService.ts
│   ├── types/Machine.ts
│   └── __tests__/MachineService.test.ts
├── metrics/
│   ├── MetricsService.ts
│   ├── types/Metric.ts
│   └── __tests__/MetricsService.test.ts
├── event/
│   ├── EventBroadcaster.ts
│   └── __tests__/EventBroadcaster.test.ts
├── port/
│   ├── PortService.ts
│   └── __tests__/PortService.test.ts
├── audit/
│   ├── AuditService.ts
│   ├── types/AuditEntry.ts
│   └── __tests__/AuditService.test.ts
└── repository/
    ├── DatabaseRepository.ts
    ├── MachineRepository.ts
    ├── MetricsRepository.ts
    └── __tests__/
```

**Responsibilities:**
- Business Logic Implementation
- Service Orchestration
- Database Access (nur via Repository Pattern)
- Event Publishing
- Audit Logging

---

## 8. Testing Strategy

### 8.1 Test Coverage Requirements

```
Infrastructure Layer:  ≥ 85% (kritisch für Auth/Sicherheit)
Connection Layer:      ≥ 90% (kritisch für Datenisolation)
Protocol Layer:        ≥ 95% (kritisch für Input Validation)
Domain Layer:          ≥ 80% (Business Logic)
OVERALL TARGET:        ≥ 85%
```

### 8.2 Test Types

| Test Type | Layer | Purpose |
|-----------|-------|---------|
| Unit Tests | All | Jede Funktion isoliert testen |
| Integration Tests | Connection + Protocol + Domain | Zusammenspiel testen |
| Security Tests | Infrastructure + Protocol | Input Validation, Auth |
| Performance Tests | Connection + Protocol | Load Handling |

### 8.3 Test Checklist Pro Modul

```markdown
## ModulName Test Checklist

### Happy Path Tests
- [ ] Normal Operation mit gültigen Eingaben
- [ ] Erwartete Outputs korrekt

### Error Handling Tests
- [ ] Invalid Input → Rejection mit Fehlermeldung
- [ ] Connection Loss → Graceful Degradation
- [ ] Database Error → Retry Logic or Circuit Breaker
- [ ] Malformed Message → Error Logged, nicht gecrasht

### Security Tests
- [ ] Unauthorized Access → Rejection
- [ ] SQL Injection Attempt → Escaped oder Rejection
- [ ] Buffer Overflow → Handled
- [ ] Timeout/DoS → Protected

### Edge Cases
- [ ] Empty Input
- [ ] Maximum Size Input
- [ ] Null/Undefined Values
- [ ] Concurrent Operations
```

---

## 9. Auditierbarkeits-Anforderungen

### 9.1 Code-Level Auditierbarkeit

**Jedes Modul muss folgende Properties haben:**

1. **Structured Logging:**
   ```typescript
   logger.info('CommandExecuted', {
     commandId: string,
     machineId: string,
     userId: string,
     command: string,
     timestamp: ISO8601,
     result: 'success' | 'error',
     errorReason?: string
   })
   ```

2. **Input Validation mit Rejection-Gründen:**
   ```typescript
   ValidationResult {
     isValid: boolean
     errors?: ValidationError[]
     sanitizedData?: T
   }
   ```

3. **Error Boundaries:**
   ```typescript
   try {
     // operation
   } catch (error) {
     logger.error('OperationFailed', { error, context })
     throw new DomainError(...)
   }
   ```

4. **Type Safety:**
   - 100% TypeScript (keine `any`)
   - Interface-basiertes Design
   - Strict Mode enabled

### 9.2 Documentation-Level Auditierbarkeit

**Jedes Modul muss dokumentiert sein mit:**

1. **Module Purpose:** Was macht das Modul?
2. **Input Contracts:** Was wird akzeptiert?
3. **Output Contracts:** Was wird zurückgegeben?
4. **Error Scenarios:** Welche Fehler können auftreten?
5. **Security Considerations:** Welche Sicherheitsrisiken wurden berücksichtigt?
6. **Test Coverage:** Welche Tests decken welche Pfade ab?

### 9.3 Audit Checklist Template

```markdown
## [ModulName] Audit Checklist

**Date:** YYYY-MM-DD  
**Auditor:** [Name]  
**Status:** [Pass/Fail]

### Code Review
- [ ] No hardcoded secrets
- [ ] No SQL injection vulnerabilities
- [ ] Proper error handling
- [ ] Logging for critical operations
- [ ] Input validation on all entry points

### Test Review
- [ ] Unit tests cover happy path
- [ ] Unit tests cover error cases
- [ ] Security tests present
- [ ] Test coverage ≥ threshold

### Documentation Review
- [ ] README/comments present
- [ ] Input/output contracts documented
- [ ] Security considerations noted
- [ ] Audit trail generation confirmed

### Compliance Review
- [ ] ISO 27001 requirements met
- [ ] CREST requirements met
- [ ] Data isolation verified
- [ ] No unauthorized access possible

**Findings:**
- [ ] No critical issues
- [ ] Issues resolved: ...
- [ ] Deferred to next review: ...

**Sign-off:** [Signature] [Date]
```

---

## 10. Migration Strategy (Big Bang)

### 10.1 Parallel Running Phase (Optional Safety Buffer)

```
Week 1-2: Develop & Test new architecture in parallel
Week 3: Integration testing
Week 4: Deploy new server.ts (replace old server.js)
Week 5: Monitor for issues
```

### 10.2 Rollback Plan

```
1. Keep server.js as backup
2. Git tag current working version
3. If critical issues: git revert and debug
4. Once stable (7 days): delete server.js backup
```

---

## 11. Deliverables

### 11.1 Code Deliverables

```
server/src/
├── infrastructure/        (All modules + tests)
├── connection/           (All modules + tests)
├── protocol/             (All modules + tests)
├── domain/               (All modules + tests)
├── types/                (Global type definitions)
├── config/               (Configuration)
└── server.ts             (New entry point)
```

### 11.2 Documentation Deliverables

```
docs/architecture/
├── 00-REFACTORING-PLAN.md (this file)
├── 01-ARCHITECTURE-OVERVIEW.md
├── 02-INFRASTRUCTURE-LAYER.md
├── 03-CONNECTION-LAYER.md
├── 04-PROTOCOL-LAYER.md
├── 05-DOMAIN-LAYER.md
├── 06-DESIGN-DECISIONS.md
├── 07-DEVELOPMENT-PROCESS.md
├── 08-CODE-REVIEW-CHECKLIST.md
├── 09-INCIDENT-RESPONSE.md
├── 10-AUDIT-CHECKLIST.md
└── AUDIT-CHECKLIST.md (completed checklist)
```

### 11.3 Audit Deliverable

```
AUDIT-CHECKLIST.md
├── Phase 1: Infrastructure Layer
│   ├── Module: HttpServer
│   ├── Module: WebSocketUpgradeHandler
│   ├── Module: JwtAuthService
│   └── Module: SecretKeyManager
├── Phase 2: Connection Layer
│   ├── Module: AgentConnectionManager
│   └── ...
├── Phase 3: Protocol Layer
│   └── ...
├── Phase 4: Domain Layer
│   └── ...
└── Sign-off & Metrics
```

---

## 12. Success Criteria

### 12.1 Code Quality

- ✅ 100% TypeScript, no `any` types
- ✅ ≥ 85% Test Coverage Overall
- ✅ Zero Critical Security Issues
- ✅ All SonarQube/ESLint checks pass
- ✅ No circular dependencies

### 12.2 Auditability

- ✅ Every module has comprehensive tests
- ✅ Every security path has logging
- ✅ Compliance mapping documented
- ✅ Audit checklist signed off

### 12.3 Documentation

- ✅ All layers documented with examples
- ✅ ISO/CREST mapping complete
- ✅ Development process documented
- ✅ Deployment runbook created

---

## 13. Risk Assessment & Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| Breaking Changes | Medium | High | Integration tests, gradual rollout |
| Performance Regression | Low | High | Load tests, benchmarking |
| TypeScript Compilation | Low | Medium | Strong type checking in CI |
| Database Migration Issues | Low | High | Database schema validation, backup |
| Knowledge Loss | Low | Medium | Documentation, code comments |

---

## 14. Timeline & Resource Allocation

```
Total Estimated Time: 8-10 working days

Day 1:   Planning & Documentation (this phase)        [1 person]
Day 2-3: Infrastructure Layer                         [1 person]
Day 4:   Connection Layer                             [1 person]
Day 5:   Protocol Layer                               [1 person]
Day 6-8: Domain Layer                                 [1 person]
Day 9:   Integration & Testing                        [1 person]
Day 10:  Audit Documentation & Deployment             [1 person]
```

---

## 15. Sign-Off & Approval

**Plan Approved By:** [To be filled]  
**Date:** [To be filled]  
**Next Steps:** Proceed to Phase 2: Infrastructure Layer

---

## Appendix A: Glossary

- **Layer:** Horizontale Schicht mit spezifischer Verantwortung
- **Module:** Vertikale Code-Einheit innerhalb eines Layer
- **Service:** Business Logic Klasse mit spezifischer Domain-Verantwortung
- **Repository:** Data Access Object Pattern für Datenbankzugriffe
- **Traceability:** Fähigkeit, alle Operationen zu einem Audit-Trail nachzuverfolgen

---

**End of Document**
