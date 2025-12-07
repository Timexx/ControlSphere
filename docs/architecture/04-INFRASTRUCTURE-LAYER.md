# Phase 2 – Infrastructure Layer
**Status:** Complete (code + tests)  
**Date:** 2025-12-07

## Scope
Implements infrastructure layer per refactoring plan: HTTP bootstrap, WebSocket upgrade handling, JWT auth, and secret key management with ISO 27001 controls.

## Modules
- `HttpServer` (`server/src/infrastructure/http/HttpServer.ts`): minimal HTTP host, error logging, defers WS upgrades.
- `WebSocketUpgradeHandler` (`server/src/infrastructure/ws/WebSocketUpgradeHandler.ts`): path allowlist, optional JWT auth (global or per-path), multi-route dispatch, fallback support.
- `JwtAuthService` (`server/src/infrastructure/auth/JwtAuthService.ts`): HS256 signing/verification, issuer/audience enforcement, weak-secret warning.
- `SecretKeyManager` (`server/src/infrastructure/auth/SecretKeyManager.ts`): generate/rotate JWT secret, persist to `.env`, weak-secret replacement.

## Configuration
- `WebSocketUpgradeConfig`: `allowedPaths` (required), `requireAuth` (global), `requireAuthPaths` (path-scoped auth; used for `/ws/web`).
- `JwtConfig`: `issuer`, `audience`, `expiresIn`; secret provided by `SecretKeyManager.ensureJWTSecret()`.
- Environment: `.env` must contain strong `JWT_SECRET`; if absent/weak it is generated and persisted.

## Security & Compliance
- ISO 27001 A.14.2.1: strict JWT validation (issuer/audience, exp), protocol validation delegated to upper layers.
- ISO 27001 A.13.1: WebSocket path allowlist + optional auth gating.
- Auditability: structured logging via `ILogger` on start/upgrade/error paths.

## Tests (Vitest)
- `HttpServer`: handler success + 500 on handler error.
- `SecretKeyManager`: generate missing secret, rotate weak secret, explicit rotation.
- `JwtAuthService`: sign/verify roundtrip, audience mismatch rejection.
- `WebSocketUpgradeHandler`: accept allowed path, reject unknown path, require auth globally, require auth only on configured paths, reject upgrade without token when auth is required.

Run: `npm test` (or `pnpm test`/`yarn test`).

## Acceptance Checklist
- [x] Modules compiled with TypeScript strictness (no `any`).
- [x] JWT secret auto-generated if missing; weak secrets rotated.
- [x] WS upgrades limited to allowlisted paths; optional JWT auth enforced when configured.
- [x] Tests present for all infrastructure modules; pass locally.
- [x] Documentation updated (this file) to reflect implementation and usage.

## Next (outside infrastructure)
- Move Prisma usage out of connection managers into repositories (data access layer).
- Enforce `requireAuth: true` on production WebSocket endpoints and wire DI for config.
- Add integration smoke test for combined HTTP + WS bootstrap once connection layer hardening is done.
