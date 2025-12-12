# Security Event Handling (Integrity Noise Mitigation)

This note documents how integrity events are deduplicated and filtered to keep dashboards actionable (ISO 27001 evidence: noise control, signal preservation).

## Rules applied on `/api/agent/security-events`

- **Ignore list (integrity)**: Events with paths in these locations are suppressed because they churn during scans and normal ops:
  - `/var/log/**`, `/var/log/journal/**`, `/var/log/samba/**`
  - `/var/lib/docker/containers/**`
  - `/var/cache/apt/**`, `/var/lib/apt/**`, `/var/lib/dpkg/**`
  - `/var/tmp/**`
- **Fingerprinting**: Each event carries a fingerprint (`type:path` for integrity; fallback to `type:message`). Stored in `data.fingerprint`.
- **Cooldown**: For integrity events, if the same fingerprint was updated in the last 30 minutes and is still `open`, the event is skipped (no re-open spam during scans).
- **User intent respected**: If an event was `ack`/`resolved`, it is not re-opened; only metadata updates are applied.
- **Suppression metric**: Response includes `suppressed` to track how many events were ignored by the rules.

## Operational impact

- Dashboards stop flooding with repetitive log/cache changes from scans.
- Critical files (e.g., `/etc/ssh/sshd_config`, `/etc/shadow`) still raise events immediately.
- Acks/resolutions are preserved; no “zombie reopen” behaviour.

## Change log

- Added ignore list + cooldown to integrity events.
- Added consistent fingerprinting and suppression counter.***
