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
}

export default function SecurityOverviewPage() {
  const t = useTranslations('security')
  const locale = useLocale()
  const dateLocale = locale === 'de' ? de : enUS
  const [items, setItems] = useState<OverviewItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)

  const loadData = async () => {
    try {
      const res = await fetch('/api/security/overview')
      const data = await res.json()
      setItems(data.items || [])
    } catch (error) {
      console.error('Failed to fetch security overview', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
    
    // Auto-refresh every 30 seconds to keep timestamps current
    const interval = setInterval(loadData, 30000)
    return () => clearInterval(interval)
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
    </AppShell>
  )
}

function SecurityCard({ item, t, dateLocale }: { item: OverviewItem; t: ReturnType<typeof useTranslations>; dateLocale: Locale }) {
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
      className="block rounded-xl border border-slate-800 bg-[#0B1118]/70 hover:border-cyan-500/50 transition-all shadow-[0_0_35px_rgba(0,243,255,0.05)] p-4 space-y-4"
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400 font-mono">
            {item.machineId.slice(0, 8)}
          </p>
          <h3 className="text-lg font-semibold text-white">{item.hostname}</h3>
        </div>
        <div className="h-11 w-11 rounded-lg border border-slate-700 bg-slate-900/60 flex items-center justify-center">
          <StatusIcon className="h-5 w-5 text-cyan-300" />
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
        <span className="text-slate-500">•</span>
        <span className="text-slate-400">
          {t('cards.events', { count: item.openEvents })}
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
