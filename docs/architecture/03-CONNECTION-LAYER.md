# Phase 3 – Connection Layer
**Status:** In Progress (code migrated to repositories, docs added)**  
**Date:** 2025-12-07

## Scope
Manage lifecycle and routing for agent and web-client WebSockets, enforce per-path authentication, and delegate DB access via repositories. Aligns with ISO 27001 controls for network security (A.13.1) and input validation (A.14.2.1).

## Modules
- `AgentConnectionManager` (`server/src/connection/AgentConnectionManager.ts`): Handles agent registration, heartbeat, port/metric ingestion, command & terminal output routing, HMAC validation for secure messages.
- `WebClientConnectionManager` (`server/src/connection/WebClientConnectionManager.ts`): Authenticates JWT sessions, spawns terminals, wraps input/resize/command messages with HMAC via `SecureRemoteTerminalService`.
- `ConnectionRegistry` (`server/src/connection/ConnectionRegistry.ts`): Maps machineId → agent WS, userId → web WS, sessionId → machineId, commandId → machineId.
- **Repositories (new)** (`server/src/domain/repository`):
  - `MachineRepository`: Machine lookup, create/update, status/heartbeat tracking, secret retrieval.
  - `PortRepository`: Idempotent port sync (upsert + prune stale ports).
  - `MetricRepository`: Metric ingestion per heartbeat.

## Key Responsibilities
- Enforce per-path auth: `/ws/web` requires JWT; `/ws/agent` open for trusted agent + secretKey registration.
- Strict protocol: messages without `type` rejected; schemas validated before routing.
- Secure terminal flow: session tokens + HMAC envelopes for stdin/resize/execute_command (nonce, timestamp, replay protection).
- Data isolation: all DB access routed through repositories (no Prisma in connection managers).

## Configuration
- WebSocket upgrade (`server/src/server.ts`):
  - `allowedPaths`: `/ws/agent`, `/ws/web`
  - `requireAuthPaths`: `/ws/web`
- JWT: `JWT_ISSUER`, `JWT_AUDIENCE`, `JWT_EXPIRES_IN`, `JWT_SECRET` (via SecretKeyManager).
- Terminal: `SESSION_TOKEN_SECRET` **required** (32-byte/64-hex) for session/HMAC signing.

## Security & Compliance
- **ISO 27001 A.13.1**: Path allowlist + JWT gating for web clients.
- **ISO 27001 A.14.2.1**: Message validation before handlers; sanitized payloads; HMAC integrity for terminal streams.
- **ISO 27001 A.12.4**: Structured logging (connect/disconnect, validation failures, security events).
- **Replay/Tamper Protection**: Nonce tracking, timestamp skew checks, HMAC verification using machine secret.

## Tests
- Unit/Integration (Vitest):
  - `WebSocketUpgradeHandler` auth/allowlist coverage.
  - `SecureRemoteTerminalService` HMAC, replay, rate limiting.
  - `integration-ws-upgrade.test.ts` (new): end-to-end HTTP→WS upgrade, auth required for `/ws/web`, allowed for `/ws/agent`.

## Acceptance Checklist
- [x] Connection managers free of direct Prisma usage; repositories injected.
- [x] Per-path auth enforced (`/ws/web` JWT required; `/ws/agent` open for agents).
- [x] Terminal messages HMAC-wrapped end-to-end; agent validation passes.
- [x] Integration smoke test covers HTTP + WS upgrade + JWT auth.
- [ ] Additional repository unit tests (Machine/Port/Metric) – pending.

## Next Steps
1) Add repository unit tests and mocks to validate queries and pruning logic.
2) Extend integration tests: full terminal spawn→input→output round-trip with agent/web WS stubs.
3) Document ACL model and future RBAC in this layer.
4) Migrate remaining domain services to repositories (Session/Audit) to complete data-access separation.
