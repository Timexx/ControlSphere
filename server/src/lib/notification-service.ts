/**
 * NotificationService – listens to system events and dispatches emails.
 *
 * All steps are logged with [notifications] prefix — check server logs to trace flow.
 */

import { realtimeEvents } from './realtime-events'
import { prisma } from './prisma'
import { sendEmail, type SmtpConfig } from './email'
import {
  renderImmediateEmail,
  renderDigestEmail,
  NOTIFICATION_EVENTS,
  type NotificationEventKey,
  type NotificationMode,
  type DigestItem,
} from './email-templates'

interface NotificationConfig {
  enabled: boolean
  smtpHost: string | null
  smtpPort: number
  smtpUsername: string | null
  smtpPassword: string | null
  smtpFromEmail: string | null
  smtpFromName: string
  smtpTls: boolean
  smtpVerifyCert: boolean
  recipientEmails: string
  eventSettings: string
  digestEnabled: boolean
  digestHour: number
  digestMinute: number
  digestDays: string
}

// ─── Rate limiting ────────────────────────────────────────────────────────────

const rateLimitCounters: Map<string, { count: number; resetAt: number }> = new Map()
const MAX_IMMEDIATE_PER_HOUR = 10

function isRateLimited(eventKey: string): boolean {
  const now = Date.now()
  const entry = rateLimitCounters.get(eventKey)
  if (!entry || entry.resetAt < now) {
    rateLimitCounters.set(eventKey, { count: 1, resetAt: now + 3_600_000 })
    return false
  }
  if (entry.count >= MAX_IMMEDIATE_PER_HOUR) {
    console.log(`[notifications] rate-limited: ${eventKey} (${entry.count} in last hour)`)
    return true
  }
  entry.count++
  return false
}

// ─── Shared state on globalThis (survives hot-reload + shared across webpack/server modules) ──

const g = globalThis as typeof globalThis & {
  __notifDigestBuffer?: DigestItem[]
  __notifDigestTimer?: ReturnType<typeof setTimeout> | null
  __notifHandlers?: Record<string, (...args: unknown[]) => void>
}
if (!g.__notifDigestBuffer) g.__notifDigestBuffer = []

function getDigestBuffer(): DigestItem[] { return g.__notifDigestBuffer! }
function getDigestTimer(): ReturnType<typeof setTimeout> | null { return g.__notifDigestTimer ?? null }
function setDigestTimer(t: ReturnType<typeof setTimeout> | null): void { g.__notifDigestTimer = t }

function queueForDigest(item: DigestItem): void {
  getDigestBuffer().push(item)
  console.log(`[notifications] queued for digest: ${item.event} (buffer size: ${getDigestBuffer().length})`)
}

// ─── Config helpers ───────────────────────────────────────────────────────────

async function getConfig(): Promise<NotificationConfig | null> {
  try {
    const cfg = await prisma.notificationConfig.findUnique({ where: { id: 'global' } })
    if (!cfg) {
      console.log('[notifications] getConfig: no config row in DB')
      return null
    }
    if (!cfg.enabled) {
      console.log('[notifications] getConfig: notifications disabled (enabled=false)')
      return null
    }
    if (!cfg.smtpHost) {
      console.log('[notifications] getConfig: missing smtpHost')
      return null
    }
    if (!cfg.smtpFromEmail) {
      console.log('[notifications] getConfig: missing smtpFromEmail')
      return null
    }
    if (!cfg.recipientEmails) {
      console.log('[notifications] getConfig: no recipients configured')
      return null
    }
    return cfg
  } catch (err) {
    console.error('[notifications] getConfig DB error:', err)
    return null
  }
}

function parseEventSettings(raw: string): Record<string, NotificationMode> {
  try {
    return JSON.parse(raw) as Record<string, NotificationMode>
  } catch {
    return {}
  }
}

function getMode(settings: Record<string, NotificationMode>, key: NotificationEventKey): NotificationMode {
  return settings[key] ?? NOTIFICATION_EVENTS[key]?.defaultMode ?? 'off'
}

function buildSmtpConfig(cfg: NotificationConfig): SmtpConfig {
  return {
    smtpHost:       cfg.smtpHost!,
    smtpPort:       cfg.smtpPort,
    smtpUsername:   cfg.smtpUsername,
    smtpPassword:   cfg.smtpPassword,
    smtpFromEmail:  cfg.smtpFromEmail!,
    smtpFromName:   cfg.smtpFromName,
    smtpTls:        cfg.smtpTls,
    smtpVerifyCert: cfg.smtpVerifyCert,
  }
}

function parseRecipients(raw: string): string[] {
  return raw.split(',').map(s => s.trim()).filter(Boolean)
}

// ─── Dispatch helper ──────────────────────────────────────────────────────────

async function dispatchImmediate(
  cfg: NotificationConfig,
  eventKey: NotificationEventKey,
  opts: {
    title: string
    description: string
    machineName?: string
    machineId?: string
    severity?: string
    extra?: Record<string, string>
    serverUrl?: string | null
    lang?: string
  }
): Promise<void> {
  if (isRateLimited(eventKey)) {
    queueForDigest({ event: eventKey, ...opts, timestamp: new Date() })
    return
  }

  const recipients = parseRecipients(cfg.recipientEmails)
  if (recipients.length === 0) {
    console.log('[notifications] dispatchImmediate: no recipients parsed from config')
    return
  }

  console.log(`[notifications] sending immediate email for "${eventKey}" to: ${recipients.join(', ')}`)

  const { subject, html, text } = renderImmediateEmail({
    event: eventKey,
    timestamp: new Date(),
    ...opts,
  })

  const smtp = buildSmtpConfig(cfg)
  await sendEmail(smtp, {
    to: recipients,
    subject,
    html,
    text,
    eventKey,
    machineId: opts.machineId,
  })

  console.log(`[notifications] email sent: "${subject}"`)
}

async function maybeNotify(
  eventKey: NotificationEventKey,
  opts: {
    title: string
    description: string
    machineName?: string
    machineId?: string
    severity?: string
    extra?: Record<string, string>
  }
): Promise<void> {
  console.log(`[notifications] maybeNotify called: eventKey=${eventKey}`)
  try {
    const cfg = await getConfig()
    if (!cfg) return

    const settings = parseEventSettings(cfg.eventSettings)
    const mode = getMode(settings, eventKey)
    console.log(`[notifications] event="${eventKey}" mode="${mode}" (settings keys: ${Object.keys(settings).join(', ') || 'none'})`)

    if (mode === 'off') {
      console.log(`[notifications] event "${eventKey}" is set to off — skipping`)
      return
    }

    const [serverUrl, lang] = await Promise.all([getServerUrl(), getAdminLanguage()])
    console.log(`[notifications] admin language: ${lang}`)

    if (mode === 'immediate') {
      await dispatchImmediate(cfg, eventKey, { ...opts, serverUrl, lang })
    } else if (mode === 'digest') {
      queueForDigest({ event: eventKey, ...opts, timestamp: new Date() })
    }
  } catch (err) {
    console.error(`[notifications] error in maybeNotify for "${eventKey}":`, err)
  }
}

async function getServerUrl(): Promise<string | null> {
  try {
    const sc = await prisma.serverConfig.findUnique({ where: { id: 'global' } })
    return sc?.serverUrl ?? null
  } catch {
    return null
  }
}

async function getAdminLanguage(): Promise<string> {
  try {
    const admin = await prisma.user.findFirst({
      where: { role: 'admin', active: true },
      select: { language: true },
      orderBy: { createdAt: 'asc' },
    })
    return admin?.language ?? 'en'
  } catch {
    return 'en'
  }
}

async function getMachineName(machineId: string): Promise<string> {
  try {
    const m = await prisma.machine.findUnique({ where: { id: machineId }, select: { hostname: true } })
    return m?.hostname || machineId
  } catch {
    return machineId
  }
}

// ─── Event listeners ──────────────────────────────────────────────────────────

async function onSecurityEvent(data: unknown): Promise<void> {
  const { machineId, event } = data as {
    machineId: string
    event: { type: string; severity: string; message: string }
  }
  console.log(`[notifications] onSecurityEvent: type=${event.type} severity=${event.severity} machine=${machineId}`)

  let eventKey: NotificationEventKey = 'securityEvent'
  if (event.type === 'integrity') eventKey = 'integrityViolation'

  const machineName = await getMachineName(machineId)
  await maybeNotify(eventKey, {
    title: `Security Event: ${event.message}`,
    description: `A security event was detected on ${machineName}.`,
    machineName,
    machineId,
    severity: event.severity,
    extra: { Type: event.type },
  })
}

async function onScanCompleted(data: unknown): Promise<void> {
  const { machineId, summary } = data as {
    machineId: string
    summary: {
      criticalCount?: number
      highCount?: number
      mediumCount?: number
      lowCount?: number
      totalPackages?: number
      total?: number
      updates?: number
      securityUpdates?: number
    }
  }
  if (!summary) return
  const critical = summary.criticalCount ?? 0
  const high = summary.highCount ?? 0
  const updates = summary.updates ?? 0
  const securityUpdates = summary.securityUpdates ?? 0
  console.log(`[notifications] onScanCompleted: machine=${machineId} critical=${critical} high=${high} updates=${updates} securityUpdates=${securityUpdates}`)

  const machineName = await getMachineName(machineId)

  if (critical > 0) {
    await maybeNotify('criticalCve', {
      title: `${critical} Critical CVE${critical > 1 ? 's' : ''} Found`,
      description: `A security scan on ${machineName} found ${critical} critical vulnerability match${critical > 1 ? 'es' : ''}.`,
      machineName, machineId, severity: 'critical',
      extra: { Critical: String(critical), High: String(high), Medium: String(summary.mediumCount ?? 0) },
    })
  } else if (high > 0) {
    await maybeNotify('highCve', {
      title: `${high} High CVE${high > 1 ? 's' : ''} Found`,
      description: `A security scan on ${machineName} found ${high} high severity vulnerability match${high > 1 ? 'es' : ''}.`,
      machineName, machineId, severity: 'high',
      extra: { High: String(high), Medium: String(summary.mediumCount ?? 0) },
    })
  }

  const totalPackages = summary.totalPackages ?? summary.total ?? 0
  await maybeNotify('scanCompleted', {
    title: `Security Scan Completed: ${machineName}`,
    description: `Scan finished. ${totalPackages} packages analysed.`,
    machineName, machineId,
    extra: { Packages: String(totalPackages), Critical: String(critical), High: String(high) },
  })

  // Notify if OS-level package updates or security patches are pending
  const pendingUpdates = updates + securityUpdates
  if (pendingUpdates > 0) {
    await maybeNotify('machineUpdatesAvailable', {
      title: `${pendingUpdates} Update${pendingUpdates > 1 ? 's' : ''} Available: ${machineName}`,
      description: `Package updates are available on ${machineName}.`,
      machineName, machineId,
      extra: {
        'Package Updates': String(updates),
        'Security Patches': String(securityUpdates),
      },
    })
  }
}

async function onUpdateAvailable(data: unknown): Promise<void> {
  const { aheadBy } = data as { latestSha: string; aheadBy: number }
  console.log(`[notifications] onUpdateAvailable: aheadBy=${aheadBy}`)
  await maybeNotify('serverUpdateAvailable', {
    title: 'Server Update Available',
    description: `A new version of ControlSphere is available (${aheadBy} commit${aheadBy !== 1 ? 's' : ''} ahead).`,
    extra: { 'Commits ahead': String(aheadBy) },
  })
}

async function onAuditLog(data: unknown): Promise<void> {
  const d = data as { machineId?: string; log?: { action?: string; severity?: string; details?: string | null } }
  if (!d?.log?.action) {
    console.error(`[notifications] onAuditLog: received invalid data — no log.action`, JSON.stringify(data).slice(0, 300))
    return
  }
  const log = d.log as { action: string; severity: string; details: string | null }
  console.log(`[notifications] onAuditLog: action=${log.action}`)

  let parsed: Record<string, string> = {}
  try { parsed = JSON.parse(log.details || '{}') } catch {}

  switch (log.action) {
    case 'USER_CREATED': {
      // Audit details use targetUsername (see admin/users/route.ts)
      const username = parsed.targetUsername || parsed.username || 'unknown'
      const role = parsed.targetRole || parsed.role || ''
      await maybeNotify('userCreated', {
        title: `New User Created: ${username}`,
        description: `A new user account was created in ControlSphere.`,
        extra: { Username: username, Role: role },
      })
      break
    }
    case 'USER_ROLE_CHANGED': {
      // Audit details use targetUsername, newRole (see admin/users/[id]/route.ts)
      const username = parsed.targetUsername || parsed.username || 'unknown'
      const newRole  = parsed.newRole || parsed.role || ''
      const oldRole  = parsed.previousRole || ''
      await maybeNotify('userRoleChanged', {
        title: `User Role Changed: ${username}`,
        description: `A user's role was updated in ControlSphere.`,
        extra: Object.fromEntries(
          [['Username', username], ['New Role', newRole], oldRole ? ['Previous Role', oldRole] : null]
            .filter(Boolean) as [string, string][]
        ),
      })
      break
    }
    case 'USER_DEACTIVATED': {
      const username = parsed.targetUsername || parsed.username || 'unknown'
      await maybeNotify('loginBlocked', {
        title: `User Deactivated: ${username}`,
        description: `A user account was deactivated.`,
        extra: { Username: username },
      })
      break
    }
    case 'USER_LOGIN_BLOCKED': {
      const username = parsed.username || parsed.targetUsername || 'unknown'
      await maybeNotify('loginBlocked', {
        title: `Login Attempt Blocked`,
        description: `A login attempt was blocked for user: ${username}.`,
        extra: { Username: username },
      })
      break
    }
    case 'MACHINE_DELETED': {
      const hostname = parsed.hostname || parsed.machineId || 'unknown'
      const machineId = parsed.machineId || ''
      await maybeNotify('machineDeleted', {
        title: `Machine Deleted: ${hostname}`,
        description: `A machine was permanently removed from ControlSphere.`,
        machineName: hostname,
        machineId,
        extra: hostname !== machineId ? { Hostname: hostname } : {},
      })
      break
    }
    case 'BULK_JOB_CREATED': {
      const command = parsed.command || ''
      const targetCount = parsed.targetCount || ''
      await maybeNotify('bulkJobCompleted', {
        title: `Bulk Job Created`,
        description: `A bulk management job was dispatched across ${targetCount || 'multiple'} machines.`,
        extra: command ? { Command: command, Targets: targetCount } : {},
      })
      break
    }
    default:
      // Not a monitored action
      break
  }
}

async function onAgentRegistered(data: unknown): Promise<void> {
  const { machineId, hostname } = data as { machineId: string; hostname: string }
  console.log(`[notifications] onAgentRegistered: hostname=${hostname} id=${machineId}`)
  await maybeNotify('agentRegistered', {
    title: `New Agent Registered: ${hostname}`,
    description: `A new machine has connected and registered with ControlSphere for the first time.`,
    machineName: hostname,
    machineId,
  })
}

async function onMachineOffline(data: unknown): Promise<void> {
  const { machineId, hostname } = data as { machineId: string; hostname: string }
  console.log(`[notifications] onMachineOffline: hostname=${hostname} id=${machineId}`)
  await maybeNotify('agentOffline', {
    title: `Agent Went Offline: ${hostname}`,
    description: `The machine ${hostname} lost connection to ControlSphere.`,
    machineName: hostname,
    machineId,
  })
}

async function onSecurityEventsResolved(data: unknown): Promise<void> {
  const { machineId, resolvedCount } = data as { machineId: string; resolvedCount: number }
  console.log(`[notifications] onSecurityEventsResolved: count=${resolvedCount} machine=${machineId}`)
  const machineName = await getMachineName(machineId)
  await maybeNotify('eventsResolved', {
    title: `${resolvedCount} Security Event${resolvedCount !== 1 ? 's' : ''} Resolved`,
    description: `Security events were marked as resolved on ${machineName}.`,
    machineName, machineId,
    extra: { Resolved: String(resolvedCount) },
  })
}

// ─── Digest scheduler ─────────────────────────────────────────────────────────

function msUntilNextDigest(hour: number, minute: number, days: number[]): number {
  const now = new Date()
  let candidate = new Date(now)
  candidate.setHours(hour, minute, 0, 0)

  for (let i = 0; i < 8; i++) {
    if (candidate > now && days.includes(candidate.getDay())) {
      return candidate.getTime() - now.getTime()
    }
    candidate = new Date(candidate.getTime() + 86_400_000)
    candidate.setHours(hour, minute, 0, 0)
  }
  return 86_400_000
}

async function sendDigest(): Promise<void> {
  const buffer = getDigestBuffer()
  console.log(`[notifications] sendDigest: ${buffer.length} items buffered`)
  if (buffer.length === 0) {
    scheduleNextDigest()
    return
  }

  try {
    const cfg = await getConfig()
    if (!cfg || !cfg.digestEnabled) {
      console.log('[notifications] sendDigest: skipped (disabled or no config)')
      scheduleNextDigest()
      return
    }

    const recipients = parseRecipients(cfg.recipientEmails)
    if (recipients.length === 0) { scheduleNextDigest(); return }

    const [serverUrl, lang] = await Promise.all([getServerUrl(), getAdminLanguage()])
    const items = buffer.splice(0, buffer.length)
    const { subject, html, text } = renderDigestEmail({ items, date: new Date(), serverUrl, lang })
    const smtp = buildSmtpConfig(cfg)

    console.log(`[notifications] sending digest: ${items.length} events to ${recipients.join(', ')}`)
    await sendEmail(smtp, { to: recipients, subject, html, text, eventKey: 'digest' })
    console.log(`[notifications] digest sent: "${subject}"`)
  } catch (err) {
    console.error('[notifications] Error sending digest:', err)
  } finally {
    scheduleNextDigest()
  }
}

function scheduleNextDigest(): void {
  const prev = getDigestTimer()
  if (prev) clearTimeout(prev)
  prisma.notificationConfig.findUnique({ where: { id: 'global' } }).then(cfg => {
    if (!cfg || !cfg.digestEnabled) {
      setDigestTimer(null)
      return
    }
    const days = cfg.digestDays.split(',').map(Number).filter(n => !isNaN(n))
    const ms = msUntilNextDigest(cfg.digestHour, cfg.digestMinute ?? 0, days)
    const nextAt = new Date(Date.now() + ms).toLocaleTimeString()
    console.log(`[notifications] next digest scheduled at ${nextAt} (in ${Math.round(ms / 60000)}min)`)
    setDigestTimer(setTimeout(() => { sendDigest() }, ms))
  }).catch(err => console.error('[notifications] scheduleNextDigest error:', err))
}

// ─── Hot-reload safe handler management ──────────────────────────────────────

function buildHandlers(): Record<string, (...args: unknown[]) => void> {
  return {
    security_event:          (d: unknown) => { onSecurityEvent(d).catch(e => console.error('[notifications] security_event handler error:', e)) },
    scan_completed:          (d: unknown) => { onScanCompleted(d).catch(e => console.error('[notifications] scan_completed handler error:', e)) },
    update_available:        (d: unknown) => { onUpdateAvailable(d).catch(e => console.error('[notifications] update_available handler error:', e)) },
    audit_log:               (d: unknown) => { onAuditLog(d).catch(e => console.error('[notifications] audit_log handler error:', e)) },
    security_events_resolved:(d: unknown) => { onSecurityEventsResolved(d).catch(e => console.error('[notifications] security_events_resolved handler error:', e)) },
    agent_registered:        (d: unknown) => { onAgentRegistered(d).catch(e => console.error('[notifications] agent_registered handler error:', e)) },
    machine_offline:         (d: unknown) => { onMachineOffline(d).catch(e => console.error('[notifications] machine_offline handler error:', e)) },
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const notificationService = {
  initialize(): void {
    // Remove old handlers from previous module load (hot-reload)
    if (g.__notifHandlers) {
      for (const [event, handler] of Object.entries(g.__notifHandlers)) {
        realtimeEvents.removeListener(event, handler)
      }
      console.log('[notifications] removed stale listeners from previous module load')
    }

    // Register fresh handlers that reference this module's code
    const handlers = buildHandlers()
    for (const [event, handler] of Object.entries(handlers)) {
      realtimeEvents.on(event, handler)
    }
    g.__notifHandlers = handlers

    scheduleNextDigest()
    console.log('[notifications] NotificationService initialized — listening for events')
  },

  shutdown(): void {
    const timer = getDigestTimer()
    if (timer) { clearTimeout(timer); setDigestTimer(null) }
    if (g.__notifHandlers) {
      for (const [event, handler] of Object.entries(g.__notifHandlers)) {
        realtimeEvents.removeListener(event, handler)
      }
      g.__notifHandlers = undefined
    }
    console.log('[notifications] NotificationService shutdown')
  },

  /** Re-schedule digest timer (call after notification config changes) */
  rescheduleDigest(): void {
    scheduleNextDigest()
  },

  /** Diagnostic info for debugging — exposed via /api/notification-config GET */
  getDiagnostics(): {
    digestBufferSize: number
    digestBufferEvents: string[]
    digestTimerActive: boolean
    handlersRegistered: boolean
    listenerCounts: Record<string, number>
  } {
    const buffer = getDigestBuffer()
    const counts: Record<string, number> = {}
    for (const event of ['security_event', 'scan_completed', 'update_available', 'audit_log', 'security_events_resolved', 'agent_registered', 'machine_offline']) {
      counts[event] = (realtimeEvents as any).listenerCount?.(event) ?? -1
    }
    return {
      digestBufferSize: buffer.length,
      digestBufferEvents: buffer.map(i => `${i.event}: ${i.title}`),
      digestTimerActive: getDigestTimer() !== null,
      handlersRegistered: !!g.__notifHandlers,
      listenerCounts: counts,
    }
  },
}
