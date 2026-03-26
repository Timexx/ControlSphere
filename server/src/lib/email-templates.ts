/**
 * Professional HTML email templates for ControlSphere notifications.
 * Theming is handled via CSS @media (prefers-color-scheme) for correct
 * light/dark rendering across all modern email clients.
 */

export type NotificationEventKey =
  | 'criticalCve'
  | 'highCve'
  | 'securityEvent'
  | 'integrityViolation'
  | 'eventsResolved'
  | 'agentRegistered'
  | 'agentOffline'
  | 'machineDeleted'
  | 'scanCompleted'
  | 'serverUpdateAvailable'
  | 'machineUpdatesAvailable'
  | 'userCreated'
  | 'userRoleChanged'
  | 'loginBlocked'
  | 'bulkJobCompleted'

export type NotificationMode = 'immediate' | 'digest' | 'off'

export interface NotificationEventConfig {
  label: string
  description: string
  category: 'security' | 'machines' | 'updates' | 'administration'
  defaultMode: NotificationMode
  allowedModes: NotificationMode[]
}

export const NOTIFICATION_EVENTS: Record<NotificationEventKey, NotificationEventConfig> = {
  criticalCve:           { label: 'Critical CVE Found',          description: 'A critical severity CVE was matched against installed packages',    category: 'security',       defaultMode: 'immediate', allowedModes: ['immediate', 'digest', 'off'] },
  highCve:               { label: 'High CVE Found',              description: 'A high severity CVE was matched against installed packages',        category: 'security',       defaultMode: 'digest',    allowedModes: ['immediate', 'digest', 'off'] },
  securityEvent:         { label: 'Security Event',              description: 'Failed authentication or suspicious activity detected',             category: 'security',       defaultMode: 'immediate', allowedModes: ['immediate', 'digest', 'off'] },
  integrityViolation:    { label: 'Integrity Violation',         description: 'File integrity or configuration drift detected on a machine',       category: 'security',       defaultMode: 'immediate', allowedModes: ['immediate', 'digest', 'off'] },
  eventsResolved:        { label: 'Security Events Resolved',    description: 'One or more security events were marked as resolved',               category: 'security',       defaultMode: 'digest',    allowedModes: ['digest', 'off'] },
  agentRegistered:       { label: 'New Agent Registered',        description: 'A new machine connected and registered for the first time',         category: 'machines',       defaultMode: 'immediate', allowedModes: ['immediate', 'digest', 'off'] },
  agentOffline:          { label: 'Agent Went Offline',          description: 'A monitored machine lost connection to the server',                 category: 'machines',       defaultMode: 'digest',    allowedModes: ['immediate', 'digest', 'off'] },
  machineDeleted:        { label: 'Machine Deleted',             description: 'A machine was permanently removed from ControlSphere',              category: 'machines',       defaultMode: 'immediate', allowedModes: ['immediate', 'digest', 'off'] },
  scanCompleted:         { label: 'Security Scan Completed',     description: 'A full security scan finished with a summary of findings',          category: 'machines',       defaultMode: 'digest',    allowedModes: ['digest', 'off'] },
  serverUpdateAvailable: { label: 'Server Update Available',     description: 'A new version of ControlSphere server is available on GitHub',     category: 'updates',        defaultMode: 'immediate', allowedModes: ['immediate', 'digest', 'off'] },
  machineUpdatesAvailable:{ label: 'Machine Updates Available',  description: 'One or more managed machines have pending OS/package updates',      category: 'updates',        defaultMode: 'digest',    allowedModes: ['digest', 'off'] },
  userCreated:           { label: 'New User Created',            description: 'A new user account was created in ControlSphere',                  category: 'administration', defaultMode: 'immediate', allowedModes: ['immediate', 'digest', 'off'] },
  userRoleChanged:       { label: 'User Role Changed',           description: 'A user\'s role or permissions were modified',                      category: 'administration', defaultMode: 'immediate', allowedModes: ['immediate', 'digest', 'off'] },
  loginBlocked:          { label: 'Login Attempt Blocked',       description: 'A login was blocked due to deactivated account or rate limiting',  category: 'administration', defaultMode: 'digest',    allowedModes: ['immediate', 'digest', 'off'] },
  bulkJobCompleted:      { label: 'Bulk Job Completed',          description: 'A bulk management job finished execution across target machines',   category: 'administration', defaultMode: 'digest',    allowedModes: ['digest', 'off'] },
}

// ─── i18n strings ────────────────────────────────────────────────────────────

interface EmailStrings {
  footerSentBy: string
  footerAdmin: string
  openDashboard: string
  rowEvent: string
  rowTime: string
  rowMachine: string
  rowSeverity: string
  viewDashboard: string
  viewDetails: string
  // Test email
  testSubject: string
  testPreview: string
  testIntro: string
  testCardTitle: string
  testStatusValue: string
  testSentAt: string
  testRecipient: string
  testRecipientValue: string
  testFooter: string
  // Digest
  digestSubjectPrefix: string
  digestPreview: (count: number) => string
  digestSummary: (count: number) => string
  digestPeriod: string
  digestCategories: Record<string, string>
}

const EMAIL_STRINGS: Record<string, EmailStrings> = {
  en: {
    footerSentBy: 'Sent by <strong>ControlSphere</strong> &mdash; Self-hosted Infrastructure Monitoring',
    footerAdmin: 'You are receiving this because you are an administrator.',
    openDashboard: 'Open Dashboard &rarr;',
    rowEvent: 'Event',
    rowTime: 'Time',
    rowMachine: 'Machine',
    rowSeverity: 'Severity',
    viewDashboard: 'View in Dashboard',
    viewDetails: 'View Details',
    testSubject: 'ControlSphere \u2013 Test Notification',
    testPreview: 'Your notification system is working correctly.',
    testIntro: 'This is a test notification from ControlSphere. Your email notification system is configured correctly and working as expected.',
    testCardTitle: 'SMTP Configuration Test',
    testStatusValue: 'Connected & Operational',
    testSentAt: 'Sent at',
    testRecipient: 'Recipient',
    testRecipientValue: 'You are receiving this test message',
    testFooter: 'If you received this email, all notification triggers will be delivered to this address. You can adjust your notification preferences in the ControlSphere settings.',
    digestSubjectPrefix: 'ControlSphere Daily Digest',
    digestPreview: (n) => `${n} event${n !== 1 ? 's' : ''} since your last digest`,
    digestSummary: (n) => `Here is a summary of <strong>${n} event${n !== 1 ? 's' : ''}</strong> that occurred in your ControlSphere environment.`,
    digestPeriod: 'Period: up to',
    digestCategories: {
      security:       'Security & Vulnerabilities',
      machines:       'Machines & Agents',
      updates:        'Updates',
      administration: 'Administration',
    },
  },
  de: {
    footerSentBy: 'Gesendet von <strong>ControlSphere</strong> &mdash; Self-hosted Infrastruktur-Monitoring',
    footerAdmin: 'Du erh&auml;ltst diese Nachricht, weil du Administrator bist.',
    openDashboard: 'Dashboard &ouml;ffnen &rarr;',
    rowEvent: 'Ereignis',
    rowTime: 'Zeitpunkt',
    rowMachine: 'Maschine',
    rowSeverity: 'Schweregrad',
    viewDashboard: 'Im Dashboard anzeigen',
    viewDetails: 'Details anzeigen',
    testSubject: 'ControlSphere \u2013 Test-Benachrichtigung',
    testPreview: 'Dein Benachrichtigungssystem funktioniert korrekt.',
    testIntro: 'Dies ist eine Test-Benachrichtigung von ControlSphere. Dein E-Mail-Benachrichtigungssystem ist korrekt konfiguriert und funktioniert wie erwartet.',
    testCardTitle: 'SMTP-Konfigurationstest',
    testStatusValue: 'Verbunden & betriebsbereit',
    testSentAt: 'Gesendet um',
    testRecipient: 'Empf\u00e4nger',
    testRecipientValue: 'Du erh\u00e4ltst diese Testnachricht',
    testFooter: 'Wenn du diese E-Mail erhalten hast, werden alle Benachrichtigungen an diese Adresse gesendet. Du kannst deine Benachrichtigungseinstellungen in den ControlSphere-Einstellungen anpassen.',
    digestSubjectPrefix: 'ControlSphere Tages-Digest',
    digestPreview: (n) => `${n} Ereignis${n !== 1 ? 'se' : ''} seit deinem letzten Digest`,
    digestSummary: (n) => `Hier ist eine Zusammenfassung von <strong>${n} Ereignis${n !== 1 ? 'sen' : ''}</strong> in deiner ControlSphere-Umgebung.`,
    digestPeriod: 'Zeitraum: bis',
    digestCategories: {
      security:       'Sicherheit & Schwachstellen',
      machines:       'Maschinen & Agenten',
      updates:        'Updates',
      administration: 'Administration',
    },
  },
}

function strings(lang?: string): EmailStrings {
  return EMAIL_STRINGS[lang ?? 'en'] ?? EMAIL_STRINGS.en
}

// ─── Severity helpers ────────────────────────────────────────────────────────

function severityColor(severity: string): string {
  switch (severity) {
    case 'critical': return '#ef4444'
    case 'high':     return '#f97316'
    case 'medium':   return '#eab308'
    default:         return '#64748b'
  }
}

function severityBg(severity: string): string {
  switch (severity) {
    case 'critical': return 'rgba(239,68,68,0.12)'
    case 'high':     return 'rgba(249,115,22,0.12)'
    case 'medium':   return 'rgba(234,179,8,0.12)'
    default:         return 'rgba(100,116,139,0.12)'
  }
}

// ─── Base layout ─────────────────────────────────────────────────────────────

/**
 * CSS classes used throughout:
 *   cs-bg          – page background (outer wrapper + body)
 *   cs-card        – email card background + border
 *   cs-title       – heading / title text
 *   cs-body-text   – body paragraph text
 *   cs-muted       – muted secondary text
 *   cs-subtle      – very muted text (footer copy)
 *   cs-divider     – horizontal rule / divider cells
 *   cs-event-card  – event card block background + border
 *   cs-row-label   – table row label cells
 *   cs-row-value   – table row value cells
 *   cs-section-lbl – section heading label
 *   cs-section-hr  – section heading right-side rule
 *   cs-link        – accent link color
 *
 * Light mode is declared via @media (prefers-color-scheme:light).
 * Dark mode is the default (declared outside the media query) so that
 * clients which strip <style> still render the dark design correctly.
 * The color-scheme meta tag prevents email clients from auto-inverting colors.
 */
function renderLayout(title: string, previewText: string, body: string, serverUrl?: string | null, lang?: string): string {
  const year = new Date().getFullYear()
  const dashboardUrl = serverUrl || '#'
  const s = strings(lang)

  return `<!DOCTYPE html>
<html lang="${lang === 'de' ? 'de' : 'en'}">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<meta name="x-apple-disable-message-reformatting"/>
<meta name="color-scheme" content="light dark"/>
<meta name="supported-color-schemes" content="light dark"/>
<title>${escapeHtml(title)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
:root { color-scheme: light dark; }

/* Layout resets */
body { margin:0; padding:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
table { border-collapse:collapse; }

/* ── Dark mode (default) ── */
.cs-bg         { background-color:#070b11; }
.cs-card       { background-color:#0d1520; border:1px solid #1e293b; }
.cs-title      { color:#f1f5f9; }
.cs-body-text  { color:#94a3b8; }
.cs-muted      { color:#64748b; }
.cs-subtle     { color:#334155; }
.cs-divider    { background-color:#1e293b; }
.cs-event-card { background-color:#0f1926; border:1px solid #1e293b; }
.cs-row-label  { color:#64748b; }
.cs-row-value  { color:#cbd5e1; }
.cs-section-lbl{ color:#64748b; }
.cs-section-hr { border-bottom:1px solid #1e293b; }
.cs-link       { color:#22d3ee; }
.cs-preview    { color:#070b11; }

/* ── Light mode overrides ── */
@media (prefers-color-scheme:light) {
  .cs-bg         { background-color:#f0f4f8 !important; }
  .cs-card       { background-color:#ffffff !important; border-color:#e2e8f0 !important; }
  .cs-title      { color:#0f172a !important; }
  .cs-body-text  { color:#475569 !important; }
  .cs-muted      { color:#64748b !important; }
  .cs-subtle     { color:#94a3b8 !important; }
  .cs-divider    { background-color:#e2e8f0 !important; }
  .cs-event-card { background-color:#f8fafc !important; border-color:#e2e8f0 !important; }
  .cs-row-label  { color:#94a3b8 !important; }
  .cs-row-value  { color:#1e293b !important; }
  .cs-section-lbl{ color:#94a3b8 !important; }
  .cs-section-hr { border-bottom-color:#e2e8f0 !important; }
  .cs-link       { color:#0891b2 !important; }
  .cs-preview    { color:#f0f4f8 !important; }
}
</style>
</head>
<body class="cs-bg" style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <!-- Preview text (hidden) -->
  <div class="cs-preview" style="display:none;font-size:1px;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">${escapeHtml(previewText)}</div>

  <!-- Outer wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" class="cs-bg" style="min-height:100vh;">
    <tr><td align="center" style="padding:32px 16px;">

      <!-- Email card -->
      <table width="600" cellpadding="0" cellspacing="0" border="0" class="cs-card" style="max-width:600px;width:100%;border-radius:16px;overflow:hidden;">

        <!-- Top accent line -->
        <tr><td style="height:3px;background:linear-gradient(90deg,#0891b2 0%,#22d3ee 50%,#0891b2 100%);font-size:0;line-height:0;">&nbsp;</td></tr>

        <!-- Header -->
        <tr><td style="padding:28px 32px 24px;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td>
                <span style="display:inline-block;font-family:monospace;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#22d3ee;opacity:0.8;">CONTROLSPHERE</span>
                <div class="cs-title" style="font-size:20px;font-weight:700;margin-top:4px;line-height:1.3;">${escapeHtml(title)}</div>
              </td>
              <td align="right" style="vertical-align:top;">
                <div style="width:42px;height:42px;border-radius:10px;border:1px solid rgba(34,211,238,0.25);background:rgba(34,211,238,0.08);text-align:center;line-height:42px;font-size:18px;font-weight:800;color:#22d3ee;font-family:monospace;">CS</div>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- Divider -->
        <tr><td class="cs-divider" style="height:1px;font-size:0;line-height:0;">&nbsp;</td></tr>

        <!-- Body content -->
        <tr><td style="padding:28px 32px;">
          ${body}
        </td></tr>

        <!-- Divider -->
        <tr><td class="cs-divider" style="height:1px;font-size:0;line-height:0;">&nbsp;</td></tr>

        <!-- Footer -->
        <tr><td style="padding:20px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td class="cs-muted" style="font-size:12px;">
                ${s.footerSentBy}
              </td>
              <td align="right">
                <a href="${dashboardUrl}" class="cs-link" style="font-size:12px;text-decoration:none;">${s.openDashboard}</a>
              </td>
            </tr>
            <tr><td colspan="2" class="cs-subtle" style="padding-top:8px;font-size:11px;">&copy; ${year} ControlSphere. ${s.footerAdmin}</td></tr>
          </table>
        </td></tr>

      </table>
      <!-- /Email card -->

    </td></tr>
  </table>
</body>
</html>`
}

// ─── Event card block ─────────────────────────────────────────────────────────

interface EventCardOpts {
  icon: string        // emoji or short text
  iconBg: string      // CSS color
  title: string
  subtitle?: string
  rows: Array<{ label: string; value: string }>
  severity?: string
  actionUrl?: string
  actionLabel?: string
}

function renderEventCard(opts: EventCardOpts): string {
  const { icon, iconBg, title, subtitle, rows, severity, actionUrl, actionLabel } = opts
  const sevColor = severity ? severityColor(severity) : null
  const sevBg    = severity ? severityBg(severity) : null

  const rowsHtml = rows.map(r => `
    <tr>
      <td class="cs-row-label" style="padding:5px 0;font-size:12px;white-space:nowrap;vertical-align:top;width:130px;">${escapeHtml(r.label)}</td>
      <td class="cs-row-value" style="padding:5px 0 5px 12px;font-size:13px;word-break:break-word;">${escapeHtml(r.value)}</td>
    </tr>`).join('')

  const severityBadge = sevColor && severity ? `
    <span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${sevColor};background-color:${sevBg};border:1px solid ${sevColor}33;margin-left:8px;">${escapeHtml(severity)}</span>` : ''

  const actionBtn = actionUrl ? `
    <tr><td colspan="2" style="padding-top:16px;">
      <a href="${actionUrl}" style="display:inline-block;padding:9px 20px;background-color:#0891b2;color:#ffffff;font-size:13px;font-weight:600;border-radius:8px;text-decoration:none;">${escapeHtml(actionLabel || 'View Details')}</a>
    </td></tr>` : ''

  return `
<table width="100%" cellpadding="0" cellspacing="0" border="0" class="cs-event-card" style="border-radius:10px;overflow:hidden;margin-bottom:16px;">
  <tr>
    <td style="padding:16px 18px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="vertical-align:top;width:38px;">
            <div style="width:34px;height:34px;border-radius:8px;background-color:${iconBg};text-align:center;line-height:34px;font-size:16px;">${icon}</div>
          </td>
          <td style="padding-left:12px;vertical-align:top;">
            <div class="cs-title" style="font-size:15px;font-weight:600;">${escapeHtml(title)}${severityBadge}</div>
            ${subtitle ? `<div class="cs-row-label" style="font-size:12px;margin-top:2px;">${escapeHtml(subtitle)}</div>` : ''}
          </td>
        </tr>
        <tr><td colspan="2" style="padding-top:14px;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            ${rowsHtml}
            ${actionBtn}
          </table>
        </td></tr>
      </table>
    </td>
  </tr>
</table>`
}

// ─── Section heading ──────────────────────────────────────────────────────────

function renderSectionHeading(label: string, count?: number): string {
  return `
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:10px;margin-top:20px;">
  <tr>
    <td class="cs-section-lbl" style="font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;padding-bottom:8px;white-space:nowrap;">
      ${escapeHtml(label)}${count !== undefined ? ` (${count})` : ''}
    </td>
    <td class="cs-section-hr" style="width:100%;padding-bottom:8px;">&nbsp;</td>
  </tr>
</table>`
}

// ─── Public template functions ────────────────────────────────────────────────

export interface DigestItem {
  event: NotificationEventKey
  title: string
  description: string
  machineName?: string
  machineId?: string
  severity?: string
  timestamp: Date
  extra?: Record<string, string>
}

/** Renders a test email */
export function renderTestEmail(serverUrl?: string | null, lang?: string): { subject: string; html: string; text: string } {
  const s = strings(lang)
  const locale = lang === 'de' ? 'de-DE' : 'en-GB'
  const subject = s.testSubject
  const now = new Date()
  const body = `
<p class="cs-body-text" style="font-size:14px;line-height:1.7;margin:0 0 20px;">
  ${s.testIntro}
</p>
${renderEventCard({
  icon: '✓',
  iconBg: 'rgba(34,197,94,0.15)',
  title: s.testCardTitle,
  rows: [
    { label: 'Status',        value: s.testStatusValue },
    { label: s.testSentAt,    value: now.toLocaleString(locale, { timeZoneName: 'short' }) },
    { label: s.testRecipient, value: s.testRecipientValue },
  ],
})}
<p class="cs-muted" style="font-size:12px;margin:20px 0 0;">
  ${s.testFooter}
</p>`

  const html = renderLayout(subject, s.testPreview, body, serverUrl, lang)
  const text = `${subject}\n\n${s.testIntro}\n${s.testSentAt}: ${now.toISOString()}`
  return { subject, html, text }
}

/** Renders an immediate single-event notification */
export function renderImmediateEmail(opts: {
  event: NotificationEventKey
  title: string
  description: string
  machineName?: string
  machineId?: string
  severity?: string
  timestamp: Date
  extra?: Record<string, string>
  serverUrl?: string | null
  lang?: string
}): { subject: string; html: string; text: string } {
  const { event, title, description, machineName, machineId, severity, timestamp, extra, serverUrl, lang } = opts
  const cfg = NOTIFICATION_EVENTS[event]
  const s = strings(lang)
  const locale = lang === 'de' ? 'de-DE' : 'en-GB'

  const severityPrefix = severity === 'critical' ? '🔴 ' : severity === 'high' ? '🟠 ' : ''
  const subject = `${severityPrefix}ControlSphere: ${title}`

  const rows: Array<{ label: string; value: string }> = [
    { label: s.rowEvent, value: cfg.label },
    { label: s.rowTime,  value: timestamp.toLocaleString(locale, { timeZoneName: 'short' }) },
  ]
  if (machineName) rows.push({ label: s.rowMachine, value: machineName })
  if (severity)    rows.push({ label: s.rowSeverity, value: severity.toUpperCase() })
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      rows.push({ label: k, value: v })
    }
  }

  const actionUrl = machineName && machineId && serverUrl
    ? `${serverUrl}/machine/${machineId}`
    : serverUrl || undefined

  const iconMap: Record<string, { icon: string; bg: string }> = {
    security:       { icon: '🛡', bg: 'rgba(239,68,68,0.12)' },
    machines:       { icon: '🖥', bg: 'rgba(34,211,238,0.1)' },
    updates:        { icon: '⬆', bg: 'rgba(99,102,241,0.12)' },
    administration: { icon: '👤', bg: 'rgba(251,191,36,0.1)' },
  }
  const { icon, bg } = iconMap[cfg.category] || { icon: '●', bg: 'rgba(100,116,139,0.12)' }

  const body = `
<p class="cs-body-text" style="font-size:14px;line-height:1.7;margin:0 0 20px;">${escapeHtml(description)}</p>
${renderEventCard({ icon, iconBg: bg, title, rows, severity, actionUrl, actionLabel: s.viewDashboard })}`

  const html = renderLayout(title, description, body, serverUrl, lang)
  const text = [
    `ControlSphere Notification: ${title}`,
    ``,
    description,
    ``,
    `${s.rowEvent}: ${cfg.label}`,
    `${s.rowTime}: ${timestamp.toISOString()}`,
    machineName ? `${s.rowMachine}: ${machineName}` : null,
    severity ? `${s.rowSeverity}: ${severity}` : null,
    ...(extra ? Object.entries(extra).map(([k, v]) => `${k}: ${v}`) : []),
    actionUrl ? `\nView: ${actionUrl}` : null,
  ].filter(Boolean).join('\n')

  return { subject, html, text }
}

/** Renders a daily digest email for multiple accumulated events */
export function renderDigestEmail(opts: {
  items: DigestItem[]
  date: Date
  serverUrl?: string | null
  lang?: string
}): { subject: string; html: string; text: string } {
  const { items, date, serverUrl, lang } = opts
  const s = strings(lang)
  const locale = lang === 'de' ? 'de-DE' : 'en-GB'

  const dateStr = date.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const subject = `${s.digestSubjectPrefix} \u2013 ${dateStr}`
  const preview = s.digestPreview(items.length)

  // Group by category
  const groups: Record<string, DigestItem[]> = {}
  for (const item of items) {
    const cat = NOTIFICATION_EVENTS[item.event]?.category || 'other'
    if (!groups[cat]) groups[cat] = []
    groups[cat].push(item)
  }

  const categoryOrder: Array<{ key: string }> = [
    { key: 'security' },
    { key: 'machines' },
    { key: 'updates' },
    { key: 'administration' },
  ]

  let body = `
<p class="cs-body-text" style="font-size:14px;line-height:1.7;margin:0 0 4px;">
  ${s.digestSummary(items.length)}
</p>
<p class="cs-muted" style="font-size:12px;margin:0 0 24px;">${s.digestPeriod} ${escapeHtml(dateStr)}</p>`

  for (const { key } of categoryOrder) {
    const catItems = groups[key]
    if (!catItems || catItems.length === 0) continue
    const catLabel = s.digestCategories[key] || key

    body += renderSectionHeading(catLabel, catItems.length)

    for (const item of catItems) {
      const cfg = NOTIFICATION_EVENTS[item.event]
      const iconMap: Record<string, { icon: string; bg: string }> = {
        security:       { icon: '🛡', bg: 'rgba(239,68,68,0.12)' },
        machines:       { icon: '🖥', bg: 'rgba(34,211,238,0.1)' },
        updates:        { icon: '⬆', bg: 'rgba(99,102,241,0.12)' },
        administration: { icon: '👤', bg: 'rgba(251,191,36,0.1)' },
      }
      const { icon, bg } = iconMap[key] || { icon: '●', bg: 'rgba(100,116,139,0.12)' }

      const rows: Array<{ label: string; value: string }> = [
        { label: s.rowTime, value: item.timestamp.toLocaleString(locale, { timeZoneName: 'short' }) },
      ]
      if (item.machineName) rows.push({ label: s.rowMachine, value: item.machineName })
      if (item.severity)    rows.push({ label: s.rowSeverity, value: item.severity.toUpperCase() })
      if (item.extra) {
        for (const [k, v] of Object.entries(item.extra)) rows.push({ label: k, value: v })
      }

      const actionUrl = item.machineName && item.machineId && serverUrl
        ? `${serverUrl}/machine/${item.machineId}`
        : serverUrl || undefined

      body += renderEventCard({
        icon, iconBg: bg,
        title: item.title,
        subtitle: cfg?.description,
        rows, severity: item.severity,
        actionUrl, actionLabel: s.viewDetails,
      })
    }
  }

  const html = renderLayout(`${s.digestSubjectPrefix} \u2013 ${dateStr}`, preview, body, serverUrl, lang)
  const text = [
    subject,
    `${items.length} ${lang === 'de' ? 'Ereignisse' : 'events'}`,
    ``,
    ...items.map(i => `[${NOTIFICATION_EVENTS[i.event]?.label || i.event}] ${i.title} (${i.timestamp.toISOString()})`),
    serverUrl ? `\nDashboard: ${serverUrl}` : null,
  ].filter(Boolean).join('\n')

  return { subject, html, text }
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
