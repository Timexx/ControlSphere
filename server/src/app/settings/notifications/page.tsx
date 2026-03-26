'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import {
  Bell, Mail, Clock, CheckSquare, AlertCircle, CheckCircle2,
  Send, RefreshCw, ChevronDown, ChevronUp, Shield, Monitor,
  ArrowUpCircle, Users, History, Loader2,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import {
  NOTIFICATION_EVENTS,
  type NotificationEventKey,
  type NotificationMode,
} from '@/lib/email-templates'

// ─── Types ────────────────────────────────────────────────────────────────────

interface NotificationConfig {
  id: string
  smtpHost: string | null
  smtpPort: number
  smtpUsername: string | null
  smtpPassword: string | null  // always '***' from API
  smtpFromEmail: string | null
  smtpFromName: string
  smtpTls: boolean
  smtpVerifyCert: boolean
  recipientEmails: string
  eventSettings: string  // JSON string
  digestEnabled: boolean
  digestHour: number
  digestMinute: number
  digestDays: string  // '1,2,3,4,5'
  enabled: boolean
}

interface NotificationLog {
  id: string
  event: string
  subject: string
  recipients: string
  status: 'sent' | 'failed'
  error: string | null
  machineId: string | null
  createdAt: string
}

type EventSettings = Record<NotificationEventKey, NotificationMode>

const WEEKDAYS = [
  { key: 'mon', value: 1 },
  { key: 'tue', value: 2 },
  { key: 'wed', value: 3 },
  { key: 'thu', value: 4 },
  { key: 'fri', value: 5 },
  { key: 'sat', value: 6 },
  { key: 'sun', value: 0 },
] as const

const CATEGORIES: Array<{ key: 'security' | 'machines' | 'updates' | 'administration'; icon: typeof Shield }> = [
  { key: 'security',       icon: Shield },
  { key: 'machines',       icon: Monitor },
  { key: 'updates',        icon: ArrowUpCircle },
  { key: 'administration', icon: Users },
]

function parseEventSettings(raw: string): EventSettings {
  try { return JSON.parse(raw) } catch { return {} as EventSettings }
}

// ─── Subcomponents ────────────────────────────────────────────────────────────

function SectionCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn(
      'rounded-xl border border-slate-800 bg-[#0B1118]/70 shadow-[0_0_30px_rgba(0,243,255,0.04)] overflow-hidden',
      className
    )}>
      {children}
    </div>
  )
}

function CardHeader({ icon: Icon, eyebrow, title, iconColor = 'cyan' }: {
  icon: React.ElementType
  eyebrow: string
  title: string
  iconColor?: 'cyan' | 'violet' | 'emerald' | 'amber'
}) {
  const colors = {
    cyan:    'border-cyan-500/30 bg-cyan-500/10 text-cyan-300',
    violet:  'border-violet-500/30 bg-violet-500/10 text-violet-300',
    emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    amber:   'border-amber-500/30 bg-amber-500/10 text-amber-300',
  }
  return (
    <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-800">
      <div className={cn('h-8 w-8 rounded-lg border flex items-center justify-center', colors[iconColor])}>
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400 font-mono">{eyebrow}</p>
        <h3 className="text-white font-semibold text-base leading-tight">{title}</h3>
      </div>
    </div>
  )
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer group">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative w-10 h-5 rounded-full border transition-colors duration-200',
          checked
            ? 'bg-cyan-600 border-cyan-500'
            : 'bg-slate-800 border-slate-700'
        )}
      >
        <span className={cn(
          'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200',
          checked ? 'translate-x-5' : 'translate-x-0'
        )} />
      </button>
      <span className="text-sm text-slate-300 group-hover:text-white transition-colors">{label}</span>
    </label>
  )
}

function ModeSelector({
  value,
  allowed,
  onChange,
  t,
}: {
  value: NotificationMode
  allowed: NotificationMode[]
  onChange: (m: NotificationMode) => void
  t: (k: string) => string
}) {
  return (
    <div className="flex gap-1">
      {(['immediate', 'digest', 'off'] as NotificationMode[]).map(mode => {
        if (!allowed.includes(mode)) return null
        const active = value === mode
        return (
          <button
            key={mode}
            type="button"
            onClick={() => onChange(mode)}
            className={cn(
              'px-2.5 py-1 rounded-md text-xs font-medium border transition-colors',
              active
                ? mode === 'off'
                  ? 'bg-slate-700 border-slate-600 text-slate-300'
                  : mode === 'immediate'
                    ? 'bg-cyan-600/20 border-cyan-500/50 text-cyan-300'
                    : 'bg-violet-600/20 border-violet-500/50 text-violet-300'
                : 'bg-transparent border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-600'
            )}
          >
            {t(`events.modes.${mode}`)}
          </button>
        )
      })}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function NotificationsPage() {
  const t = useTranslations('notifications')

  const [config, setConfig]       = useState<NotificationConfig | null>(null)
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const [testing, setTesting]     = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)

  const [logs, setLogs]           = useState<NotificationLog[]>([])
  const [logsOpen, setLogsOpen]   = useState(false)
  const [logsLoading, setLogsLoading] = useState(false)

  // Local form state
  const [smtpHost,      setSmtpHost]      = useState('')
  const [smtpPort,      setSmtpPort]      = useState('587')
  const [smtpUsername,  setSmtpUsername]  = useState('')
  const [smtpPassword,  setSmtpPassword]  = useState('')
  const [smtpFromEmail, setSmtpFromEmail] = useState('')
  const [smtpFromName,  setSmtpFromName]  = useState('ControlSphere')
  const [smtpTls,       setSmtpTls]       = useState(true)
  const [smtpVerifyCert,setSmtpVerifyCert]= useState(true)
  const [recipients,    setRecipients]    = useState('')
  const [enabled,       setEnabled]       = useState(false)

  const [digestEnabled, setDigestEnabled] = useState(false)
  const [digestHour,    setDigestHour]    = useState(8)
  const [digestMinute,  setDigestMinute]  = useState(0)
  const [digestDays,    setDigestDays]    = useState<number[]>([1, 2, 3, 4, 5])

  // Auto-save state for schedule card
  const [scheduleSaving,  setScheduleSaving]  = useState(false)
  const [scheduleSaved,   setScheduleSaved]   = useState(false)
  const scheduleAutoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isFirstLoad = useRef(true)

  const [eventSettings, setEventSettings] = useState<EventSettings>({} as EventSettings)

  // ── Load config ──────────────────────────────────────────────────────────

  const loadConfig = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/notification-config', { cache: 'no-store' })
      if (!res.ok) throw new Error('load failed')
      const data = await res.json()
      const cfg: NotificationConfig | null = data.config

      setConfig(cfg)
      if (cfg) {
        setSmtpHost(cfg.smtpHost ?? '')
        setSmtpPort(String(cfg.smtpPort ?? 587))
        setSmtpUsername(cfg.smtpUsername ?? '')
        setSmtpPassword(cfg.smtpPassword ?? '')  // '***' or null
        setSmtpFromEmail(cfg.smtpFromEmail ?? '')
        setSmtpFromName(cfg.smtpFromName ?? 'ControlSphere')
        setSmtpTls(cfg.smtpTls)
        setSmtpVerifyCert(cfg.smtpVerifyCert)
        setRecipients(cfg.recipientEmails)
        setEnabled(cfg.enabled)
        setDigestEnabled(cfg.digestEnabled)
        setDigestHour(cfg.digestHour)
        setDigestMinute(cfg.digestMinute ?? 0)
        setDigestDays(cfg.digestDays.split(',').map(Number).filter(n => !isNaN(n)))
        setEventSettings(parseEventSettings(cfg.eventSettings))
      }
    } catch {
      setSaveError(t('errors.loadFailed'))
    } finally {
      setLoading(false)
      // Mark initial load done so auto-save doesn't fire immediately
      setTimeout(() => { isFirstLoad.current = false }, 100)
    }
  }, [t])

  useEffect(() => { loadConfig() }, [loadConfig])

  // ── Save ─────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    setSaving(true)
    setSaveSuccess(false)
    setSaveError(null)
    try {
      const res = await fetch('/api/notification-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          smtpHost:       smtpHost   || null,
          smtpPort:       Number(smtpPort),
          smtpUsername:   smtpUsername || null,
          smtpPassword:   smtpPassword || null,
          smtpFromEmail:  smtpFromEmail || null,
          smtpFromName:   smtpFromName || 'ControlSphere',
          smtpTls,
          smtpVerifyCert,
          recipientEmails: recipients,
          eventSettings,
          digestEnabled,
          digestHour,
          digestMinute,
          digestDays: digestDays.join(','),
          enabled,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setSaveError(data.error || t('errors.saveFailed')); return }
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 4000)
    } catch {
      setSaveError(t('errors.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  // ── Schedule auto-save ────────────────────────────────────────────────────

  const saveSchedule = useCallback(async () => {
    setScheduleSaving(true)
    setScheduleSaved(false)
    try {
      await fetch('/api/notification-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          smtpHost:       smtpHost   || null,
          smtpPort:       Number(smtpPort),
          smtpUsername:   smtpUsername || null,
          smtpPassword:   smtpPassword || null,
          smtpFromEmail:  smtpFromEmail || null,
          smtpFromName:   smtpFromName || 'ControlSphere',
          smtpTls,
          smtpVerifyCert,
          recipientEmails: recipients,
          eventSettings,
          digestEnabled,
          digestHour,
          digestMinute,
          digestDays: digestDays.join(','),
          enabled,
        }),
      })
      setScheduleSaved(true)
      setTimeout(() => setScheduleSaved(false), 3000)
    } catch {
      // Silent fail for auto-save
    } finally {
      setScheduleSaving(false)
    }
  }, [smtpHost, smtpPort, smtpUsername, smtpPassword, smtpFromEmail, smtpFromName,
      smtpTls, smtpVerifyCert, recipients, eventSettings,
      digestEnabled, digestHour, digestMinute, digestDays, enabled])

  useEffect(() => {
    if (isFirstLoad.current) return
    if (scheduleAutoSaveTimer.current) clearTimeout(scheduleAutoSaveTimer.current)
    scheduleAutoSaveTimer.current = setTimeout(() => { saveSchedule() }, 800)
    return () => {
      if (scheduleAutoSaveTimer.current) clearTimeout(scheduleAutoSaveTimer.current)
    }
  }, [digestEnabled, digestHour, digestMinute, digestDays]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Test email ────────────────────────────────────────────────────────────

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/notification-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          smtpHost:       smtpHost || null,
          smtpPort:       Number(smtpPort),
          smtpUsername:   smtpUsername || null,
          smtpPassword:   smtpPassword !== '***' ? smtpPassword || null : undefined,
          smtpFromEmail:  smtpFromEmail || null,
          smtpFromName:   smtpFromName || 'ControlSphere',
          smtpTls,
          smtpVerifyCert,
          recipientEmails: recipients,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        setTestResult({ ok: true, msg: t('provider.testSuccess') })
      } else {
        setTestResult({ ok: false, msg: data.error || t('provider.testFailed') })
      }
    } catch {
      setTestResult({ ok: false, msg: t('provider.testFailed') })
    } finally {
      setTesting(false)
      setTimeout(() => setTestResult(null), 6000)
    }
  }

  // ── Notification logs ─────────────────────────────────────────────────────

  const loadLogs = async () => {
    setLogsLoading(true)
    try {
      const res = await fetch('/api/notification-logs', { cache: 'no-store' })
      const data = await res.json()
      setLogs(data.logs ?? [])
    } catch {
      setLogs([])
    } finally {
      setLogsLoading(false)
    }
  }

  const toggleLogs = () => {
    if (!logsOpen) loadLogs()
    setLogsOpen(v => !v)
  }

  // ── Event setting helper ──────────────────────────────────────────────────

  const setEventMode = (key: NotificationEventKey, mode: NotificationMode) => {
    setEventSettings(prev => ({ ...prev, [key]: mode }))
  }

  const getMode = (key: NotificationEventKey): NotificationMode => {
    return eventSettings[key] ?? NOTIFICATION_EVENTS[key]?.defaultMode ?? 'off'
  }

  // ── Input field helper ────────────────────────────────────────────────────

  const inputClass = cn(
    'w-full rounded-lg border border-slate-700 bg-[#070b11] px-3 py-2 text-sm text-slate-200',
    'placeholder-slate-600 focus:border-cyan-500/60 focus:outline-none focus:ring-1 focus:ring-cyan-500/30 transition-colors'
  )

  if (loading) {
    return (
      <div className="flex items-center gap-3 text-slate-400 py-12">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">Loading notification settings…</span>
      </div>
    )
  }

  return (
    <div className="max-w-3xl space-y-6">

      {/* ── Card 1: SMTP Provider ─────────────────────────────────────── */}
      <SectionCard>
        <CardHeader icon={Mail} eyebrow={t('provider.eyebrow')} title={t('provider.title')} />
        <div className="px-5 py-5 space-y-5">
          <p className="text-sm text-slate-400 leading-relaxed">{t('provider.description')}</p>

          {/* Global enable/disable */}
          <Toggle checked={enabled} onChange={setEnabled} label={t('provider.enabled')} />

          {/* SMTP fields */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium">{t('provider.host')}</label>
              <input
                type="text"
                value={smtpHost}
                onChange={e => setSmtpHost(e.target.value)}
                placeholder={t('provider.hostPlaceholder')}
                className={inputClass}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium">{t('provider.port')}</label>
              <input
                type="number"
                value={smtpPort}
                onChange={e => setSmtpPort(e.target.value)}
                min={1}
                max={65535}
                className={inputClass}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium">{t('provider.username')}</label>
              <input
                type="email"
                value={smtpUsername}
                onChange={e => setSmtpUsername(e.target.value)}
                placeholder={t('provider.usernamePlaceholder')}
                className={inputClass}
                autoComplete="username"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium">{t('provider.password')}</label>
              <input
                type="password"
                value={smtpPassword}
                onChange={e => setSmtpPassword(e.target.value)}
                placeholder={smtpPassword === '***' ? '••••••••••••••••' : t('provider.passwordPlaceholder')}
                className={inputClass}
                autoComplete="current-password"
              />
              <p className="text-xs text-slate-500">{t('provider.passwordHint')}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium">{t('provider.fromEmail')}</label>
              <input
                type="email"
                value={smtpFromEmail}
                onChange={e => setSmtpFromEmail(e.target.value)}
                placeholder={t('provider.fromEmailPlaceholder')}
                className={inputClass}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium">{t('provider.fromName')}</label>
              <input
                type="text"
                value={smtpFromName}
                onChange={e => setSmtpFromName(e.target.value)}
                placeholder={t('provider.fromNamePlaceholder')}
                className={inputClass}
              />
            </div>
          </div>

          {/* Recipients */}
          <div className="space-y-1.5">
            <label className="text-xs text-slate-400 font-medium">{t('provider.recipients')}</label>
            <textarea
              value={recipients}
              onChange={e => setRecipients(e.target.value)}
              placeholder={t('provider.recipientsPlaceholder')}
              rows={2}
              className={cn(inputClass, 'resize-none')}
            />
            <p className="text-xs text-slate-500">{t('provider.recipientsHint')}</p>

            {/* Recipient chips */}
            {recipients && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {recipients.split(',').map(r => r.trim()).filter(Boolean).map((r, i) => (
                  <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-xs text-slate-300">
                    <Mail className="h-2.5 w-2.5 text-slate-500" />
                    {r}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* TLS toggles */}
          <div className="flex gap-6">
            <Toggle checked={smtpTls}        onChange={setSmtpTls}        label={t('provider.tls')} />
            <Toggle checked={smtpVerifyCert} onChange={setSmtpVerifyCert} label={t('provider.verifyCert')} />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-600 text-white text-sm font-medium hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Bell className="h-3.5 w-3.5" />}
              {saving ? t('provider.saving') : t('provider.save')}
            </button>

            <button
              onClick={handleTest}
              disabled={testing || !smtpHost || !smtpFromEmail || !recipients}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-700 bg-slate-800/60 text-slate-300 text-sm font-medium hover:text-white hover:border-slate-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              {testing ? t('provider.testSending') : t('provider.testButton')}
            </button>
          </div>

          {/* Save/test feedback */}
          {saveSuccess && (
            <div className="flex items-center gap-2 text-emerald-400 text-xs">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {t('provider.saveSuccess')}
            </div>
          )}
          {saveError && (
            <div className="flex items-center gap-2 text-rose-400 text-xs">
              <AlertCircle className="h-3.5 w-3.5" />
              {saveError}
            </div>
          )}
          {testResult && (
            <div className={cn(
              'flex items-center gap-2 text-xs',
              testResult.ok ? 'text-emerald-400' : 'text-rose-400'
            )}>
              {testResult.ok
                ? <CheckCircle2 className="h-3.5 w-3.5" />
                : <AlertCircle className="h-3.5 w-3.5" />}
              {testResult.msg}
            </div>
          )}
        </div>
      </SectionCard>

      {/* ── Card 2: Schedule ─────────────────────────────────────────── */}
      <SectionCard>
        <div className="flex items-center justify-between pr-5">
          <CardHeader icon={Clock} eyebrow={t('schedule.eyebrow')} title={t('schedule.title')} iconColor="violet" />
          {/* Auto-save status */}
          <div className="h-5 flex items-center">
            {scheduleSaving && (
              <span className="flex items-center gap-1.5 text-xs text-slate-400">
                <RefreshCw className="h-3 w-3 animate-spin" />
                {t('saving')}
              </span>
            )}
            {scheduleSaved && !scheduleSaving && (
              <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                <CheckCircle2 className="h-3 w-3" />
                {t('saved')}
              </span>
            )}
          </div>
        </div>
        <div className="px-5 py-5 space-y-5">
          <p className="text-sm text-slate-400 leading-relaxed">{t('schedule.description')}</p>

          <Toggle
            checked={digestEnabled}
            onChange={setDigestEnabled}
            label={t('schedule.digestEnabled')}
          />

          {digestEnabled && (
            <div className="space-y-4 pl-2 border-l-2 border-violet-500/30">
              {/* Time picker: HH:MM */}
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400 font-medium">{t('schedule.digestTime')}</label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    value={digestHour}
                    onChange={e => setDigestHour(Math.min(23, Math.max(0, Number(e.target.value))))}
                    min={0}
                    max={23}
                    className={cn(inputClass, 'w-16 text-center')}
                  />
                  <span className="text-slate-400 font-mono text-sm select-none">:</span>
                  <input
                    type="number"
                    value={String(digestMinute).padStart(2, '0')}
                    onChange={e => setDigestMinute(Math.min(59, Math.max(0, Number(e.target.value))))}
                    min={0}
                    max={59}
                    step={5}
                    className={cn(inputClass, 'w-16 text-center')}
                  />
                  <span className="text-xs text-slate-500 ml-1">
                    {String(digestHour).padStart(2, '0')}:{String(digestMinute).padStart(2, '0')} {t('schedule.serverTime')}
                  </span>
                </div>
              </div>

              {/* Weekday picker */}
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400 font-medium">{t('schedule.digestDays')}</label>
                <div className="flex gap-1.5 flex-wrap">
                  {WEEKDAYS.map(({ key, value }) => {
                    const active = digestDays.includes(value)
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setDigestDays(prev =>
                          active ? prev.filter(d => d !== value) : [...prev, value]
                        )}
                        className={cn(
                          'w-10 h-8 rounded-lg text-xs font-medium border transition-colors',
                          active
                            ? 'bg-violet-600/25 border-violet-500/50 text-violet-200'
                            : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600'
                        )}
                      >
                        {t(`schedule.days.${key}`)}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </SectionCard>

      {/* ── Card 3: Event Subscriptions ──────────────────────────────── */}
      <SectionCard>
        <CardHeader icon={CheckSquare} eyebrow={t('events.eyebrow')} title={t('events.title')} iconColor="emerald" />
        <div className="px-5 py-5 space-y-1">
          <p className="text-sm text-slate-400 leading-relaxed mb-5">{t('events.description')}</p>

          {CATEGORIES.map(({ key: catKey, icon: CatIcon }) => {
            const catEvents = Object.entries(NOTIFICATION_EVENTS).filter(
              ([, cfg]) => cfg.category === catKey
            ) as Array<[NotificationEventKey, typeof NOTIFICATION_EVENTS[NotificationEventKey]]>

            return (
              <div key={catKey} className="mb-4">
                {/* Category heading */}
                <div className="flex items-center gap-2 mb-2">
                  <CatIcon className="h-3.5 w-3.5 text-slate-400" />
                  <span className="text-[11px] uppercase tracking-[0.18em] text-slate-400 font-mono font-semibold">
                    {t(`events.categories.${catKey}`)}
                  </span>
                </div>

                {/* Event rows */}
                <div className="rounded-lg border border-slate-800 overflow-hidden divide-y divide-slate-800/60">
                  {catEvents.map(([evtKey, evtCfg]) => (
                    <div key={evtKey} className="flex items-center justify-between px-4 py-3 hover:bg-slate-800/30 transition-colors">
                      <div className="min-w-0 flex-1 mr-4">
                        <p className="text-sm text-slate-200 font-medium">{t(`events.items.${evtKey}`)}</p>
                        <p className="text-xs text-slate-500 mt-0.5 truncate">{t(`events.descriptions.${evtKey}`)}</p>
                      </div>
                      <ModeSelector
                        value={getMode(evtKey)}
                        allowed={evtCfg.allowedModes}
                        onChange={mode => setEventMode(evtKey, mode)}
                        t={t as (k: string) => string}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )
          })}

          {/* Save button */}
          <div className="pt-4 flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-600 text-white text-sm font-medium hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Bell className="h-3.5 w-3.5" />}
              {saving ? t('saving') : t('save')}
            </button>
            {saveSuccess && (
              <span className="flex items-center gap-1.5 text-emerald-400 text-xs">
                <CheckCircle2 className="h-3.5 w-3.5" />{t('saved')}
              </span>
            )}
          </div>
        </div>
      </SectionCard>

      {/* ── Card 4: Notification History ─────────────────────────────── */}
      <SectionCard>
        <button
          type="button"
          className="w-full"
          onClick={toggleLogs}
        >
          <div className="flex items-center justify-between px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-lg border border-amber-500/30 bg-amber-500/10 flex items-center justify-center">
                <History className="h-4 w-4 text-amber-300" />
              </div>
              <div className="text-left">
                <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400 font-mono">{t('history.eyebrow')}</p>
                <h3 className="text-white font-semibold text-base leading-tight">{t('history.title')}</h3>
              </div>
            </div>
            {logsOpen
              ? <ChevronUp className="h-4 w-4 text-slate-400" />
              : <ChevronDown className="h-4 w-4 text-slate-400" />}
          </div>
        </button>

        {logsOpen && (
          <div className="border-t border-slate-800 px-5 py-4">
            {logsLoading ? (
              <div className="flex items-center gap-2 text-slate-400 text-sm py-4">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading…
              </div>
            ) : logs.length === 0 ? (
              <p className="text-sm text-slate-500 py-4">{t('history.empty')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-800">
                      <th className="text-left py-2 px-2 text-slate-500 font-medium">{t('history.columns.event')}</th>
                      <th className="text-left py-2 px-2 text-slate-500 font-medium hidden sm:table-cell">{t('history.columns.subject')}</th>
                      <th className="text-left py-2 px-2 text-slate-500 font-medium">{t('history.columns.status')}</th>
                      <th className="text-left py-2 px-2 text-slate-500 font-medium hidden md:table-cell">{t('history.columns.time')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {logs.map(log => (
                      <tr key={log.id} className="hover:bg-slate-800/20 transition-colors">
                        <td className="py-2.5 px-2 font-mono text-slate-400">{log.event}</td>
                        <td className="py-2.5 px-2 text-slate-300 hidden sm:table-cell max-w-xs truncate">{log.subject}</td>
                        <td className="py-2.5 px-2">
                          <span className={cn(
                            'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium',
                            log.status === 'sent'
                              ? 'bg-emerald-500/15 text-emerald-400'
                              : 'bg-rose-500/15 text-rose-400'
                          )}>
                            {log.status === 'sent'
                              ? <CheckCircle2 className="h-2.5 w-2.5" />
                              : <AlertCircle className="h-2.5 w-2.5" />}
                            {t(`history.status.${log.status}`)}
                          </span>
                          {log.error && <p className="text-rose-400/70 text-xs mt-0.5 truncate max-w-xs">{log.error}</p>}
                        </td>
                        <td className="py-2.5 px-2 text-slate-500 hidden md:table-cell whitespace-nowrap">
                          {new Date(log.createdAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </SectionCard>

    </div>
  )
}
