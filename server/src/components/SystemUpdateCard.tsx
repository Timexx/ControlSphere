'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  Download, RefreshCw, CheckCircle2, AlertTriangle, GitCommit,
  ChevronDown, ChevronUp, X, Lock, Eye, EyeOff, FileText, Loader2, ExternalLink
} from 'lucide-react'

const GITHUB_REPO_URL = 'https://github.com/Timexx/ControlSphere'
import { useTranslations, useLocale } from 'next-intl'
import { cn } from '@/lib/utils'

// ── Types ──────────────────────────────────────────────────────────────

interface CommitInfo {
  sha: string
  message: string
  date: string
  author: string
}

interface UpdateCheckResult {
  available: boolean
  currentVersion: string
  currentSha: string
  latestSha: string
  aheadBy: number
  commits: CommitInfo[]
  checkedAt: string
  lastLogPath: string | null
  dismissed: boolean
  autoCheckEnabled: boolean
}

// ── Sub-components ─────────────────────────────────────────────────────

function PasswordPrompt({
  onConfirm,
  onCancel,
}: {
  onConfirm: (password: string) => void
  onCancel: () => void
}) {
  const t = useTranslations('settings.update.auth')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)

  const handleConfirm = async () => {
    if (!password.trim()) {
      setError(t('errorEmpty'))
      return
    }
    setVerifying(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/verify-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (res.ok) {
        onConfirm(password)
      } else {
        const d = await res.json()
        setError(d.error || t('errorWrong'))
      }
    } catch {
      setError(t('errorConnection'))
    } finally {
      setVerifying(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-amber-500/40 bg-[#0d141b] p-6 shadow-2xl space-y-5">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg border border-amber-500/40 bg-amber-500/10 flex items-center justify-center">
            <Lock className="h-5 w-5 text-amber-400" />
          </div>
          <div>
            <h3 className="text-white font-semibold">{t('title')}</h3>
            <p className="text-xs text-slate-400 mt-0.5">{t('description')}</p>
          </div>
        </div>

        {/* Password input */}
        <div className="space-y-1.5">
          <label className="text-xs text-slate-400 font-medium">{t('passwordLabel')}</label>
          <div className="relative">
            <input
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(null) }}
              onKeyDown={(e) => e.key === 'Enter' && !verifying && handleConfirm()}
              placeholder={t('passwordPlaceholder')}
              autoFocus
              className="w-full rounded-lg border border-slate-700 bg-[#070b11] px-3 py-2.5 pr-10 text-sm text-slate-200 placeholder-slate-600 focus:border-amber-500/60 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
            />
            <button
              type="button"
              onClick={() => setShowPw(!showPw)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {error && (
            <p className="text-xs text-rose-400 flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3" /> {error}
            </p>
          )}
        </div>

        {/* Buttons */}
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg border border-slate-700 text-sm text-slate-300 hover:bg-slate-800 transition-colors"
          >
            {t('cancel')}
          </button>
          <button
            onClick={handleConfirm}
            disabled={verifying}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-500 disabled:opacity-50 transition-colors"
          >
            {verifying && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {verifying ? t('confirming') : t('confirm')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ── Main Component ─────────────────────────────────────────────────────

export default function SystemUpdateCard() {
  const t = useTranslations('settings.update')
  const locale = useLocale()

  const [data, setData] = useState<UpdateCheckResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)
  const [showChangelog, setShowChangelog] = useState(false)
  const [showAuth, setShowAuth] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [updatePhase, setUpdatePhase] = useState<string | null>(null)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [logPath, setLogPath] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startShaRef = useRef<string | null>(null)

  const fetchCheck = useCallback(async (force = false) => {
    try {
      const res = await fetch(`/api/admin/server-update/check${force ? '?force=true' : ''}`, { cache: 'no-store' })
      if (res.ok) {
        const d: UpdateCheckResult = await res.json()
        setData(d)
        return d
      }
    } catch {
      // non-fatal
    }
    return null
  }, [])

  useEffect(() => {
    fetchCheck().finally(() => setLoading(false))
  }, [fetchCheck])

  const handleCheckNow = async () => {
    setChecking(true)
    await fetchCheck(true)
    setChecking(false)
  }

  const handleDismiss = async () => {
    if (!data) return
    await fetch('/api/admin/server-update/dismiss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sha: data.latestSha }),
    })
    setData(prev => prev ? { ...prev, dismissed: true } : prev)
  }

  const pendingPasswordRef = useRef<string | null>(null)

  const handleExecuteUpdate = async () => {
    setShowAuth(false)
    setUpdating(true)
    setUpdatePhase('pulling')
    setUpdateError(null)
    startShaRef.current = data?.currentSha ?? null

    try {
      const res = await fetch('/api/admin/server-update/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pendingPasswordRef.current }),
      })
      pendingPasswordRef.current = null

      if (!res.ok) {
        const d = await res.json()
        setUpdateError(d.error || t('errors.updateFailed'))
        setUpdating(false)
        return
      }

      const result = await res.json()
      setLogPath(result.logPath)

      // The server will die soon. Poll until it comes back with a new SHA.
      setUpdatePhase('building')
      let elapsed = 0
      const POLL_INTERVAL = 3000
      const TIMEOUT = 120_000

      pollRef.current = setInterval(async () => {
        elapsed += POLL_INTERVAL
        if (elapsed > TIMEOUT) {
          clearInterval(pollRef.current!)
          setUpdatePhase(null)
          setUpdateError(t('progress.timeout'))
          return
        }

        try {
          const r = await fetch('/api/admin/server-update/check', { cache: 'no-store' })
          if (r.ok) {
            const d: UpdateCheckResult = await r.json()
            if (startShaRef.current && d.currentSha !== startShaRef.current) {
              // SHA changed → update succeeded
              clearInterval(pollRef.current!)
              setData(d)
              setUpdatePhase('completed')
              setTimeout(() => { setUpdating(false); setUpdatePhase(null) }, 5000)
            }
          }
        } catch {
          // Server still down — expected during update
          setUpdatePhase('restarting')
        }
      }, POLL_INTERVAL)
    } catch {
      setUpdateError(t('errors.updateFailed'))
      setUpdating(false)
    }
  }

  // Cleanup poll on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  const relativeTime = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return locale === 'de' ? 'gerade eben' : 'just now'
    if (mins < 60) return locale === 'de' ? `vor ${mins} Min.` : `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return locale === 'de' ? `vor ${hrs} Std.` : `${hrs}h ago`
    const days = Math.floor(hrs / 24)
    return locale === 'de' ? `vor ${days} Tag${days > 1 ? 'en' : ''}` : `${days}d ago`
  }

  const showUpdate = data?.available && !data.dismissed

  // ── Update progress overlay ────────────────────────────────────────
  const progressOverlay = updating ? createPortal(
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-[#0d141b] p-8 shadow-2xl text-center space-y-6">
        {updatePhase === 'completed' ? (
          <>
            <div className="h-16 w-16 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center mx-auto">
              <CheckCircle2 className="h-8 w-8 text-emerald-400" />
            </div>
            <div>
              <h3 className="text-xl font-semibold text-white">{t('progress.completed')}</h3>
              <p className="text-sm text-slate-400 mt-2">{t('progress.completedDesc')}</p>
            </div>
          </>
        ) : updateError ? (
          <>
            <div className="h-16 w-16 rounded-full bg-rose-500/20 border border-rose-500/40 flex items-center justify-center mx-auto">
              <AlertTriangle className="h-8 w-8 text-rose-400" />
            </div>
            <div>
              <h3 className="text-xl font-semibold text-white">{t('progress.failed')}</h3>
              <p className="text-sm text-slate-400 mt-2">{updateError}</p>
              {logPath && (
                <p className="text-xs text-slate-500 font-mono mt-3">{t('logLabel')}: {logPath}</p>
              )}
            </div>
            <button
              onClick={() => { setUpdating(false); setUpdateError(null); setUpdatePhase(null) }}
              className="px-4 py-2 rounded-lg border border-slate-700 text-sm text-slate-300 hover:bg-slate-800 transition-colors"
            >
              {t('progress.close')}
            </button>
          </>
        ) : (
          <>
            <div className="h-16 w-16 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center mx-auto">
              <Loader2 className="h-8 w-8 text-amber-400 animate-spin" />
            </div>
            <div>
              <h3 className="text-xl font-semibold text-white">{t('progress.title')}</h3>
              <p className="text-sm text-slate-400 mt-2">
                {updatePhase === 'pulling' && t('progress.pulling')}
                {updatePhase === 'building' && t('progress.building')}
                {updatePhase === 'restarting' && t('progress.waitingRestart')}
              </p>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
              <div
                className="h-full bg-amber-500 rounded-full transition-all duration-500"
                style={{
                  width: updatePhase === 'pulling' ? '20%'
                    : updatePhase === 'building' ? '50%'
                    : updatePhase === 'restarting' ? '80%' : '10%'
                }}
              />
            </div>
            {logPath && (
              <p className="text-xs text-slate-500 font-mono">{t('logLabel')}: {logPath}</p>
            )}
          </>
        )}
      </div>
    </div>,
    document.body
  ) : null

  // ── Card ───────────────────────────────────────────────────────────

  return (
    <>
      <div className={cn(
        "rounded-xl border bg-[#0B1118]/70 shadow-[0_0_30px_rgba(0,243,255,0.06)] overflow-hidden",
        showUpdate ? "border-amber-500/40 shadow-[0_0_30px_rgba(245,158,11,0.12)]" : "border-slate-800"
      )}>
        {/* Card header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-800">
          <div className={cn(
            "h-8 w-8 rounded-lg border flex items-center justify-center",
            showUpdate
              ? "border-amber-500/30 bg-amber-500/10"
              : "border-cyan-500/30 bg-cyan-500/10"
          )}>
            <Download className={cn("h-4 w-4", showUpdate ? "text-amber-300" : "text-cyan-300")} />
          </div>
          <div className="flex-1">
            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400 font-mono">
              {t('eyebrow')}
            </p>
            <h3 className="text-white font-semibold text-base leading-tight">
              {t('title')}
            </h3>
          </div>
          {!loading && !showUpdate && data && (
            <button
              onClick={handleCheckNow}
              disabled={checking}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={cn("h-3 w-3", checking && "animate-spin")} />
              {checking ? t('checking') : t('checkNow')}
            </button>
          )}
        </div>

        {/* Card body */}
        <div className="px-5 py-5 space-y-4">
          {loading ? (
            <div className="flex items-center gap-3 py-4">
              <Loader2 className="h-4 w-4 text-slate-400 animate-spin" />
              <span className="text-sm text-slate-400">{t('checking')}</span>
            </div>
          ) : data && !showUpdate ? (
            /* Up to date */
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                <span className="text-sm text-emerald-300 font-medium">{t('upToDate')}</span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500">{t('version')}</p>
                  <p className="text-sm text-slate-200 font-mono">{data.currentVersion}</p>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500">{t('buildSha')}</p>
                  <p className="text-sm text-slate-200 font-mono">{data.currentSha}</p>
                </div>
                <a
                  href={data.currentSha !== 'dev'
                    ? `${GITHUB_REPO_URL}/commit/${data.currentSha}`
                    : GITHUB_REPO_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 group hover:border-cyan-500/40 hover:bg-cyan-500/5 transition-colors"
                >
                  <p className="text-[10px] uppercase tracking-wider text-slate-500">{t('githubCommit')}</p>
                  <p className="text-sm text-cyan-400 font-mono group-hover:text-cyan-300 flex items-center gap-1 transition-colors">
                    {data.currentSha}
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </p>
                </a>
              </div>
              {data.checkedAt && (
                <p className="text-xs text-slate-500">
                  {t('lastChecked')}: {relativeTime(data.checkedAt)}
                </p>
              )}
            </div>
          ) : data && showUpdate ? (
            /* Update available */
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-400" />
                <span className="text-sm text-amber-300 font-medium">{t('updateAvailable')}</span>
              </div>

              {/* Version comparison */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500">{t('currentLabel')}</p>
                  <p className="text-sm text-slate-200 font-mono">{data.currentVersion} ({data.currentSha})</p>
                </div>
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-amber-400/70">{t('latestLabel')}</p>
                  <p className="text-sm text-amber-200 font-mono">{data.latestSha}</p>
                </div>
              </div>

              {/* Commit count */}
              <p className="text-sm text-slate-300">
                {data.aheadBy > 0
                  ? t('commitsAhead', { count: data.aheadBy })
                  : t('newVersion')
                }
              </p>

              {/* Changelog toggle */}
              {data.commits.length > 0 && (
                <div>
                  <button
                    onClick={() => setShowChangelog(!showChangelog)}
                    className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors"
                  >
                    {showChangelog ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    {t('changelog')} ({data.commits.length}{data.aheadBy > 20 ? '+' : ''})
                  </button>
                  {showChangelog && (
                    <div className="mt-2 space-y-1 max-h-64 overflow-y-auto">
                      {data.commits.map((c) => (
                        <div key={c.sha} className="flex items-start gap-2 py-1.5 border-b border-slate-800/50 last:border-0">
                          <GitCommit className="h-3.5 w-3.5 text-slate-500 mt-0.5 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-slate-200 truncate">{c.message}</p>
                            <p className="text-[10px] text-slate-500">
                              {c.author} &middot; {c.sha} &middot; {relativeTime(c.date)}
                            </p>
                          </div>
                        </div>
                      ))}
                      {data.aheadBy > 20 && (
                        <p className="text-xs text-slate-500 py-1">
                          {t('andMore', { count: data.aheadBy - 20 })}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* DB migration note */}
              <div className="rounded-lg border border-slate-700/40 bg-slate-800/30 px-3 py-2">
                <p className="text-xs text-slate-400">{t('migrationNote')}</p>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShowAuth(true)}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-500 transition-colors"
                >
                  <Download className="h-4 w-4" />
                  {t('startUpdate')}
                </button>
                <button
                  onClick={handleDismiss}
                  className="px-4 py-2.5 rounded-lg border border-slate-700 text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
                >
                  {t('dismiss')}
                </button>
                <button
                  onClick={handleCheckNow}
                  disabled={checking}
                  className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-700 text-xs text-slate-400 hover:bg-slate-800 disabled:opacity-50 transition-colors"
                >
                  <RefreshCw className={cn("h-3 w-3", checking && "animate-spin")} />
                  {t('checkNow')}
                </button>
              </div>
            </div>
          ) : (
            /* Error / no data */
            <div className="flex items-center gap-3 py-4">
              <AlertTriangle className="h-4 w-4 text-rose-400" />
              <span className="text-sm text-slate-400">{t('errors.checkFailed')}</span>
              <button
                onClick={handleCheckNow}
                disabled={checking}
                className="ml-auto text-xs text-cyan-400 hover:text-cyan-300"
              >
                {t('retry')}
              </button>
            </div>
          )}
        </div>

        {/* Log path footer */}
        {(data?.lastLogPath || logPath) && (
          <div className="px-5 py-3 border-t border-slate-800 flex items-center gap-2">
            <FileText className="h-3 w-3 text-slate-600 shrink-0" />
            <p className="text-[10px] text-slate-600 font-mono truncate">
              {t('logLabel')}: {logPath || data?.lastLogPath}
            </p>
          </div>
        )}
      </div>

      {/* Password dialog */}
      {showAuth && (
        <PasswordPrompt
          onConfirm={(pw) => { pendingPasswordRef.current = pw; handleExecuteUpdate() }}
          onCancel={() => setShowAuth(false)}
        />
      )}

      {/* Progress overlay */}
      {progressOverlay}
    </>
  )
}
