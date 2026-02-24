# Security Event Handling (Integrity Noise Mitigation)

This note documents how integrity events are deduplicated and filtered to keep dashboards actionable (ISO 27001 evidence: noise control, signal preservation).

## Rules applied on `/api/agent/security-events` and `/api/agent/scan`

**Centralized Filter Module**: All integrity event filtering is centralized in `server/src/lib/integrity-filters.ts` to ensure consistency across both entry points.

### Ignore list (integrity)

Events with paths matching these patterns are suppressed because they churn during normal operations and create excessive noise. These are **completely filtered** and never persisted to the database:

#### Linux Paths
- **Package Management**: `/var/cache/apt/**`, `/var/lib/apt/**`, `/var/lib/dpkg/**`
- **Docker & Containers**: `/var/lib/docker/containers/**`, `/var/lib/docker/overlay2/**`, `/var/log/journal/**`
- **PostgreSQL**: `/var/lib/postgresql/**/pg_wal/**`, `/var/lib/postgresql/**/pg_xact/**`, `/var/lib/postgresql/**/pg_subtrans/**`, `/var/lib/postgresql/**/pg_multixact/**`, `/var/lib/postgresql/**/base/**`, `/var/lib/postgresql/**/global/pg_control`
- **MySQL/MariaDB**: `/var/lib/mysql/**/ib_logfile*`, `/var/lib/mysql/**/*.ibd`, `/var/lib/mysql/**/ibdata*`
- **Redis**: `/var/lib/redis/**`
- **Logs & Temp**: `/var/log/**`, `/var/tmp/**`, `/tmp/**`, `**/*.log`
- **Application Logs**: `**/.pm2/logs/**`, `**/.npm/_logs/**`

#### Node.js & Next.js Build Artifacts
- **Next.js**: `**/.next/static/**`, `**/.next/cache/**`, `**/.next/server/**`, `**/.next/trace`
- **Node.js**: `**/node_modules/.cache/**`, `**/.npm/**`, `**/.yarn/**`

#### Windows Paths
- **System Maintenance**: `C:\Windows\WinSxS\**`, `C:\Windows\SoftwareDistribution\**`, `C:\Windows\Temp\**`, `C:\Windows\Prefetch\**`, `C:\Windows\Logs\**`
- **System Volumes**: `C:\$Recycle.Bin\**`, `C:\System Volume Information\**`
- **User Temp**: `C:\Users\*\AppData\Local\Temp\**`

### Fingerprinting

Each event carries a fingerprint (`type:path` for integrity; fallback to `type:message`). Stored in `data.fingerprint`.

### Cooldown

- **security-events route**: 30-minute cooldown for integrity events
- **scan route**: 15-minute cooldown for integrity events

If the same fingerprint was updated within the cooldown period and is still `open`, the event is skipped (no re-open spam during scans).

### User intent respected

If an event was `ack`/`resolved`, it is not re-opened; only metadata updates are applied.

### Suppression metric

Response includes `suppressed` to track how many events were ignored by the filter rules.

## Operational impact

- Dashboards no longer flood with PostgreSQL WAL changes, Next.js build artifacts, or npm cache updates
- Critical files (e.g., `/etc/ssh/sshd_config`, `/etc/shadow`) still raise events immediately
- Acks/resolutions are preserved; no "zombie reopen" behaviour
- Reduced database growth from operational file churn

## Future enhancements

- UI-based custom ignore patterns per machine or globally
- Configurable cooldown periods
- Agent-side filtering to reduce network traffic

## Change log

- **2026-02**: Added centralized filter module with comprehensive patterns (PostgreSQL, MySQL, Redis, Next.js, Node.js build artifacts)
- Added ignore list + cooldown to integrity events
- Added consistent fingerprinting and suppression counter
