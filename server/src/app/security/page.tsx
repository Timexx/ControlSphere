'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useTranslations, useLocale } from 'next-intl'
import { ShieldAlert, ShieldCheck, ShieldHalf, Server, Clock } from 'lucide-react'
import { type Locale } from 'date-fns'
import { de, enUS } from 'date-fns/locale'
import AppShell from '@/components/AppShell'
import StatusBadge from '@/components/StatusBadge'
import AddAgentModal from '@/components/AddAgentModal'
import { formatDistanceToNow } from 'date-fns'

type OverviewItem = {
  machineId: string
  hostname: string
  agentStatus: string
  securityStatus: 'good' | 'warn' | 'critical'
  openEvents: number
  highestSeverity: string
  lastScanAt: string | null
  summary: any
  securityUpdates?: number
}

export default function SecurityOverviewPage() {
  const t = useTranslations('security')
  const locale = useLocale()
  const dateLocale = locale === 'de' ? de : enUS
  const [items, setItems] = useState<OverviewItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [cveState, setCveState] = useState<{ status: string; lastSync: string | null; error?: string | null; mode?: string; ecosystems?: string[]; totalCves?: number | null }>({ status: 'idle', lastSync: null })
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const [cveDialogOpen, setCveDialogOpen] = useState(false)
  const [cveList, setCveList] = useState<any[]>([])
  const [cveListLoading, setCveListLoading] = useState(false)
  const [cveSearch, setCveSearch] = useState('')
  const [cveSeverityFilter, setCveSeverityFilter] = useState<'all' | 'critical' | 'high' | 'medium' | 'low'>('all')

  const loadData = async () => {
    try {
      const res = await fetch('/api/security/overview', { cache: 'no-store' })
      const data = await res.json()
      setItems(data.items || [])
    } catch (error) {
      console.error('Failed to fetch security overview', error)
    } finally {
      setLoading(false)
    }
  }

  const loadCveState = async () => {
    try {
      const res = await fetch('/api/security/cve', { cache: 'no-store' })
      const data = await res.json()
      setCveState({
        status: data.status ?? 'idle',
        lastSync: data.lastSync ?? null,
        error: data.error ?? null,
        mode: data.mode ?? 'full',
        ecosystems: data.ecosystems ?? [],
        totalCves: data.totalCves ?? null
      })
    } catch (error) {
      console.error('Failed to fetch CVE mirror state', error)
    }
  }

  const triggerCveSync = async () => {
    setSyncing(true)
    setSyncMessage(null)
    try {
      const res = await fetch('/api/security/cve', { method: 'POST' })
      const data = await res.json()
      setCveState({
        status: data.status ?? 'idle',
        lastSync: data.lastSync ?? null,
        error: data.error ?? null,
        mode: data.mode ?? 'full',
        ecosystems: data.ecosystems ?? [],
        totalCves: data.totalCves ?? null
      })
      setSyncMessage(data.accepted ? t('cveSync.status.started') : t('cveSync.status.alreadyRunning'))
    } catch (error) {
      console.error('Failed to trigger CVE sync', error)
      setSyncMessage(t('cveSync.status.failed'))
    } finally {
      setSyncing(false)
    }
  }

  const loadCveList = async () => {
    setCveListLoading(true)
    try {
      const res = await fetch('/api/security/cve/list', { cache: 'no-store' })
      const data = await res.json()
      setCveList(data.items || [])
    } catch (error) {
      console.error('Failed to fetch CVE list', error)
      setCveList([])
    } finally {
      setCveListLoading(false)
    }
  }

  const filteredCves = useMemo(() => {
    const term = cveSearch.trim().toLowerCase()
    return cveList.filter((item) => {
      const matchesTerm = term
        ? item.id?.toLowerCase().includes(term) ||
          item.description?.toLowerCase().includes(term)
        : true
      const severity = (item.severity || '').toLowerCase()
      const matchesSeverity = cveSeverityFilter === 'all' || severity === cveSeverityFilter
      return matchesTerm && matchesSeverity
    })
  }, [cveList, cveSearch, cveSeverityFilter])

  useEffect(() => {
    loadData()
    loadCveState()
    
    // Auto-refresh every 30 seconds to keep timestamps current
    const interval = setInterval(loadData, 30000)
    const cveInterval = setInterval(loadCveState, 60000)
    return () => {
      clearInterval(interval)
      clearInterval(cveInterval)
    }
  }, [])

  return (
    <AppShell
      onAddAgent={() => setShowAddModal(true)}
    >
      <div className="space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-cyan-200/70 font-mono">
              {t('header.eyebrow')}
            </p>
            <h2 className="text-2xl font-semibold text-white">{t('header.title')}</h2>
            <p className="text-sm text-slate-300">
              {t('header.subtitle')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge
              icon={<Server className="h-4 w-4" />}
              label={t('badges.systems', { count: items.length })}
              tone="info"
            />
            <StatusBadge
              icon={<ShieldCheck className="h-4 w-4" />}
              label={t('badges.stable', { count: items.filter((m) => m.securityStatus === 'good').length })}
              tone="good"
            />
            <StatusBadge
              icon={<ShieldAlert className="h-4 w-4" />}
              label={t('badges.open', { count: items.filter((m) => m.securityStatus !== 'good').length })}
              tone="warn"
            />
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#0B1118]/70 p-4 shadow-[0_0_30px_rgba(0,243,255,0.06)]">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="space-y-1">
              <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400 font-mono">
                {t('cveSync.eyebrow')}
              </div>
              <div className="text-white font-semibold text-lg">{t('cveSync.title')}</div>
              <p className="text-sm text-slate-300">
                {t('cveSync.subtitle')}
              </p>
              <p className="text-xs text-slate-400">
                {t('cveSync.automatic')}
              </p>
              <p className="text-xs text-slate-400">
                {t('cveSync.manual')}
              </p>
              <p className="text-xs text-slate-400">
                {t('cveSync.mode', { mode: cveState.mode === 'scoped' ? 'scoped' : 'full' })}
              </p>
              <p className="text-xs text-slate-400">
                {t('cveSync.coverage', {
                  count: cveState.ecosystems?.length ?? 0,
                  total: cveState.totalCves ?? '—'
                })}
              </p>
            </div>
            <div className="flex flex-col items-start md:items-end gap-2 min-w-[240px]">
              <div className="text-xs text-slate-300">
                {t('cveSync.state', {
                  status: cveState.status,
                  lastSync: cveState.lastSync ? formatDistanceToNow(new Date(cveState.lastSync), { addSuffix: true, locale: dateLocale }) : t('cveSync.stateUnknown')
                })}
              </div>
              {cveState.error && (
                <div className="text-xs text-rose-300">{cveState.error}</div>
              )}
              {syncMessage && (
                <div className="text-xs text-cyan-300">{syncMessage}</div>
              )}
              <button
                onClick={triggerCveSync}
                disabled={syncing}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 h-10 rounded-lg border border-cyan-500/50 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20 transition-colors disabled:opacity-60"
              >
                <ShieldAlert className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
                <span>{syncing ? t('cveSync.buttonLoading') : t('cveSync.button')}</span>
              </button>
              <button
                onClick={() => { setCveDialogOpen(true); loadCveList() }}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 h-10 rounded-lg border border-slate-700 bg-[#0d141d] text-slate-200 hover:border-cyan-500/60 transition-colors"
              >
                <ShieldAlert className="h-4 w-4" />
                <span>{t('cveSync.viewMirror')}</span>
              </button>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="text-slate-400 text-sm">{t('states.loading')}</div>
        ) : items.length === 0 ? (
          <div className="text-slate-400 text-sm">{t('states.empty')}</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {items.map((item) => (
              <SecurityCard key={item.machineId} item={item} t={t} dateLocale={dateLocale} />
            ))}
          </div>
        )}
      </div>

      {showAddModal && (
        <AddAgentModal onClose={() => setShowAddModal(false)} />
      )}

      {cveDialogOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0A0F16] border border-slate-700 rounded-xl max-w-5xl w-full max-h-[80vh] overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between p-4 border-b border-slate-700">
              <div className="flex items-center gap-2 text-cyan-200">
                <ShieldAlert className="h-5 w-5" />
                <div>
                  <h2 className="text-lg font-semibold">{t('cveDialog.title')}</h2>
                  <p className="text-xs text-slate-400">{t('cveDialog.subtitle')}</p>
                </div>
              </div>
              <button
                onClick={() => setCveDialogOpen(false)}
                className="h-8 w-8 rounded-lg border border-slate-600 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors flex items-center justify-center"
              >
                ✕
              </button>
            </div>
            <div className="p-4 overflow-auto max-h-[calc(80vh-4rem)]">
              {cveListLoading ? (
                <div className="text-sm text-slate-300">{t('cveDialog.loading')}</div>
              ) : cveList.length === 0 ? (
                <div className="text-sm text-slate-300">{t('cveDialog.empty')}</div>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div className="flex items-center gap-2 w-full md:w-auto">
                      <input
                        value={cveSearch}
                        onChange={(e) => setCveSearch(e.target.value)}
                        placeholder={t('cveDialog.searchPlaceholder')}
                        className="w-full md:w-72 rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-slate-400">{t('cveDialog.filterSeverity')}</label>
                      <select
                        value={cveSeverityFilter}
                        onChange={(e) => setCveSeverityFilter(e.target.value as any)}
                        className="rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 focus:border-cyan-500 focus:outline-none"
                      >
                        <option value="all">{t('cveDialog.filterAll')}</option>
                        <option value="critical">{t('severity.critical')}</option>
                        <option value="high">{t('severity.high')}</option>
                        <option value="medium">{t('severity.medium')}</option>
                        <option value="low">{t('severity.low')}</option>
                      </select>
                    </div>
                  </div>
                  {filteredCves.length === 0 ? (
                    <div className="text-sm text-slate-400">{t('cveDialog.noResults')}</div>
                  ) : (
                    filteredCves.map((item) => (
                    <div key={item.id} className="rounded-lg border border-slate-800 bg-[#0C121A]/70 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <a
                          href={getCveLink(item.id)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-semibold text-cyan-200 hover:text-cyan-50"
                        >
                          {item.id}
                        </a>
                        <span className={`text-[11px] uppercase tracking-[0.2em] px-2 py-1 rounded-full border ${
                          item.severity?.toLowerCase() === 'critical' ? 'border-rose-500/60 text-rose-200 bg-rose-500/10' :
                          item.severity?.toLowerCase() === 'high' ? 'border-amber-500/60 text-amber-200 bg-amber-500/10' :
                          item.severity?.toLowerCase() === 'medium' ? 'border-yellow-500/60 text-yellow-200 bg-yellow-500/10' :
                          'border-slate-700 text-slate-200 bg-slate-800/60'
                        }`}>
                          {item.severity || 'unknown'}
                        </span>
                      </div>
                      <div className="text-xs text-slate-300 flex flex-wrap items-center gap-2 mt-1">
                        {item.score != null && (
                          <span className="px-2 py-0.5 rounded border border-slate-700 text-[11px] text-slate-100">
                            CVSS {Number(item.score).toFixed(1)}
                          </span>
                        )}
                        {item.publishedAt && (
                          <span className="text-slate-400">
                            {new Date(item.publishedAt).toLocaleString()}
                          </span>
                        )}
                      </div>
                      {item.description && (
                        <p className="text-xs text-slate-400 mt-2 leading-relaxed line-clamp-3">
                          {item.description}
                        </p>
                      )}
                    </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </AppShell>
  )
}

function getCveLink(id: string) {
  if (!id) return '#'
  return id.toUpperCase().startsWith('CVE-')
    ? `https://nvd.nist.gov/vuln/detail/${id}`
    : `https://osv.dev/vulnerability/${id}`
}

function SecurityCard({ item, t, dateLocale }: { item: OverviewItem; t: ReturnType<typeof useTranslations>; dateLocale: Locale }) {
  const tDetail = useTranslations('securityDetail')
  const statusTone =
    item.securityStatus === 'good' ? 'good' : item.securityStatus === 'warn' ? 'warn' : 'critical'
  const StatusIcon =
    item.securityStatus === 'good' ? ShieldCheck : item.securityStatus === 'warn' ? ShieldHalf : ShieldAlert
  
  // Force re-render every 10 seconds to update relative timestamps
  const [, setTick] = useState(0)
  useEffect(() => {
    const interval = setInterval(() => setTick(prev => prev + 1), 10000)
    return () => clearInterval(interval)
  }, [])

  const formattedDistance = useMemo(() => {
    if (!item.lastScanAt) return null
    return formatDistanceToNow(new Date(item.lastScanAt), { locale: dateLocale })
  }, [item.lastScanAt, dateLocale])

  return (
    <Link
      href={`/security/${item.machineId}`}
      className={`block rounded-xl border border-slate-800 bg-[#0B1118]/70 hover:border-cyan-500/50 transition-all shadow-[0_0_35px_rgba(0,243,255,0.05)] p-4 space-y-4 ${
        item.securityUpdates && item.securityUpdates > 0 ? 'border-rose-500/70 ring-1 ring-rose-500/30' : ''
      }`}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400 font-mono">
            {item.machineId.slice(0, 8)}
          </p>
          <h3 className="text-lg font-semibold text-white">{item.hostname}</h3>
        </div>
        <div className="flex items-center gap-2">
          {item.securityUpdates && item.securityUpdates > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full border border-rose-500/60 bg-rose-500/10 text-rose-100 text-[11px] font-semibold uppercase tracking-[0.14em]">
              <ShieldAlert className="h-3.5 w-3.5" />
              {tDetail('packageStatus.securityUpdate')}
            </span>
          )}
          <div className="h-11 w-11 rounded-lg border border-slate-700 bg-slate-900/60 flex items-center justify-center">
            <StatusIcon className="h-5 w-5 text-cyan-300" />
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3 text-sm">
        <span
          className={`px-2.5 py-1 rounded-full border text-xs uppercase tracking-[0.16em] ${
            statusTone === 'good'
              ? 'border-emerald-500/50 text-emerald-200 bg-emerald-500/10'
              : statusTone === 'warn'
                ? 'border-amber-400/50 text-amber-200 bg-amber-500/10'
                : 'border-rose-500/50 text-rose-200 bg-rose-500/10'
          }`}
        >
          {t(`cards.status.${item.securityStatus}`)}
        </span>
        <span className="text-slate-400">
          {t('cards.agent')} <span className="text-slate-200">{item.agentStatus}</span>
        </span>
      </div>
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <Clock className="h-4 w-4 text-cyan-300" />
        {formattedDistance ? (
          <span>{t('cards.lastScan', { distance: formattedDistance })}</span>
        ) : (
          <span>{t('cards.noScan')}</span>
        )}
      </div>
    </Link>
  )
}
