'use client'

import { useEffect, useState, useCallback, type ReactNode } from 'react'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { de, enUS } from 'date-fns/locale'
import { Activity, Cpu, HardDrive, MemoryStick, Clock, ShieldAlert, PackageCheck } from 'lucide-react'
import { cn, formatUptime } from '@/lib/utils'
import AddAgentModal from '@/components/AddAgentModal'
import AppShell, { BackgroundLayers } from '@/components/AppShell'
import StatusBadge from '@/components/StatusBadge'
import { useLocale, useTranslations } from 'next-intl'

interface Machine {
  id: string
  hostname: string
  ip: string
  osInfo: string | null
  status: string
  lastSeen: string
  openSecurityEvents?: number
  highestSeverity?: string | null
  securityUpdates?: number
  vulnerabilities?: { critical: number; high: number; medium: number; low: number; total: number }
  metrics: Array<{
    cpuUsage: number
    ramUsage: number
    ramTotal: number
    ramUsed: number
    diskUsage: number
    diskTotal: number
    diskUsed: number
    uptime: number
  }>
}

export default function DashboardPage() {
  const t = useTranslations('dashboard')
  const locale = useLocale()
  const dateLocale = locale === 'de' ? de : enUS
  const [machines, setMachines] = useState<Machine[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)

  const fetchMachines = useCallback(async () => {
    try {
      const [res, secRes] = await Promise.all([
        fetch('/api/machines'),
        fetch('/api/security/overview').catch(() => null)
      ])

      if (res.status === 401) {
        window.location.href = '/login'
        return
      }

      const data = await res.json()
      let securityMap = new Map<string, { securityUpdates: number; vulnerabilities: { critical: number; high: number; medium: number; low: number; total: number } }>()
      if (secRes && secRes.ok) {
        try {
          const secData = await secRes.json()
          for (const item of secData.items || []) {
            securityMap.set(item.machineId, {
              securityUpdates: item.securityUpdates || 0,
              vulnerabilities: item.vulnerabilities || { critical: 0, high: 0, medium: 0, low: 0, total: 0 }
            })
          }
        } catch {}
      }

      const enriched = (data.machines || []).map((m: Machine) => {
        const sec = securityMap.get(m.id)
        return {
          ...m,
          securityUpdates: sec?.securityUpdates ?? m.securityUpdates ?? 0,
          vulnerabilities: sec?.vulnerabilities ?? m.vulnerabilities ?? { critical: 0, high: 0, medium: 0, low: 0, total: 0 }
        }
      })
      setMachines(enriched)
    } catch (error) {
      console.error('Failed to fetch machines:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const fallbackTimer = window.setTimeout(() => {
      setLoading(false)
    }, 500)

    fetchMachines().finally(() => {
      clearTimeout(fallbackTimer)
    })

    let ws: WebSocket | null = null
    let mounted = true

    const connectWebSocket = async () => {
      try {
        const tokenRes = await fetch('/api/auth/get-ws-token')
        if (!tokenRes.ok) {
          console.error('Failed to get WebSocket token:', tokenRes.status)
          return
        }
        const { token } = await tokenRes.json()

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        const wsUrl = `${protocol}//${window.location.host}/ws/web?token=${encodeURIComponent(token)}`
        ws = new WebSocket(wsUrl)

        ws.onmessage = (event) => {
          if (!mounted) return
          try {
            const data = JSON.parse(event.data)
            if (data.type === 'new_machine') {
              setMachines((prev) => {
                if (prev.some((m) => m.id === data.machine.id)) {
                  return prev
                }
                return [...prev, { ...data.machine, metrics: [] }]
              })
            } else if (data.type === 'machine_status_changed') {
              setMachines((prev) =>
                prev.map((m) =>
                  m.id === data.machineId ? { ...m, status: data.status } : m
                )
              )
            } else if (data.type === 'machine_heartbeat') {
              setMachines((prev) =>
                prev.map((m) =>
                  m.id === data.machineId
                    ? {
                        ...m,
                        status: 'online',
                        lastSeen: data.timestamp || new Date().toISOString(),
                      }
                    : m
                )
              )
            } else if (data.type === 'machine_metrics') {
              setMachines((prev) =>
                prev.map((m) =>
                  m.id === data.machineId
                    ? {
                        ...m,
                        metrics: [data.metrics, ...(m.metrics || [])],
                        lastSeen: data.lastSeen || m.lastSeen,
                      }
                    : m
                )
              )
            } else if (data.type === 'security_events_resolved') {
              setMachines((prev) =>
                prev.map((m) =>
                  m.id === data.machineId
                    ? {
                        ...m,
                        openSecurityEvents: 0,
                        highestSeverity: null,
                      }
                    : m
                )
              )
            } else if (data.type === 'security_event' && data.event?.status === 'open') {
              setMachines((prev) =>
                prev.map((m) => {
                  if (m.id !== data.machineId) return m
                  const severityOrder = ['info', 'low', 'medium', 'high', 'critical']
                  const newSeverity = data.event.severity || 'info'
                  const currentSeverity = m.highestSeverity || 'info'
                  const highestSeverity = severityOrder.indexOf(newSeverity) > severityOrder.indexOf(currentSeverity)
                    ? newSeverity
                    : currentSeverity
                  return {
                    ...m,
                    openSecurityEvents: (m.openSecurityEvents || 0) + 1,
                    highestSeverity,
                  }
                })
              )
            }
          } catch (error) {
            console.error('WebSocket message error:', error)
          }
        }

        ws.onerror = (error) => {
          console.error('WebSocket error:', error)
        }
      } catch (error) {
        console.error('Failed to connect WebSocket:', error)
      }
    }

    connectWebSocket()

    return () => {
      mounted = false
      ws?.close()
    }
  }, [fetchMachines])

  return (
    <AppShell
      onAddAgent={() => setShowAddModal(true)}
    >
      <div className="space-y-8">
        {loading && (
          <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/5 px-4 py-3 text-xs uppercase tracking-[0.24em] text-cyan-200/70 font-mono">
            {t('loading')}
          </div>
        )}
        <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-cyan-200/70 font-mono">
              {t('hero.eyebrow')}
            </p>
            <h2 className="text-2xl font-semibold text-white">{t('hero.title')}</h2>
            <p className="text-sm text-slate-300">
              {t('hero.subtitle')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge
              icon={<Activity className="h-4 w-4" />}
              label={t('stats.online', { count: machines.filter((m) => m.status === 'online').length })}
              tone="good"
            />
            <StatusBadge
              icon={<Activity className="h-4 w-4" />}
              label={t('stats.total', { count: machines.length })}
              tone="info"
            />
            {(() => {
              const totalCritical = machines.reduce((s, m) => s + (m.vulnerabilities?.critical || 0), 0)
              const totalHigh = machines.reduce((s, m) => s + (m.vulnerabilities?.high || 0), 0)
              const totalUpdates = machines.reduce((s, m) => s + (m.securityUpdates || 0), 0)
              const machinesWithCriticalEvents = machines.filter(m => m.highestSeverity === 'critical').length
              const machinesWithHighEvents = machines.filter(m => m.highestSeverity === 'high').length
              const hasCritical = totalCritical > 0 || machinesWithCriticalEvents > 0
              const hasHigh = totalHigh > 0 || machinesWithHighEvents > 0
              return (
                <>
                  {hasCritical && (
                    <Link href="/security">
                      <StatusBadge
                        icon={<ShieldAlert className="h-4 w-4" />}
                        label={t('stats.critical', { count: totalCritical > 0 ? totalCritical : machinesWithCriticalEvents })}
                        tone="critical"
                      />
                    </Link>
                  )}
                  {hasHigh && (
                    <Link href="/security">
                      <StatusBadge
                        icon={<ShieldAlert className="h-4 w-4" />}
                        label={t('stats.high', { count: totalHigh > 0 ? totalHigh : machinesWithHighEvents })}
                        tone="warn"
                      />
                    </Link>
                  )}
                  {totalUpdates > 0 && (
                    <Link href="/security">
                      <StatusBadge
                        icon={<PackageCheck className="h-4 w-4" />}
                        label={t('stats.securityUpdates', { count: totalUpdates })}
                        tone="warn"
                      />
                    </Link>
                  )}
                </>
              )
            })()}
          </div>
        </div>

        {loading && machines.length === 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="h-[220px] rounded-xl border border-slate-800 bg-[#0d141b] animate-pulse"
              />
            ))}
          </div>
        ) : machines.length === 0 ? (
          <div className="text-center py-14 rounded-2xl border border-dashed border-cyan-500/30 bg-[#0A0F14]/70 backdrop-blur-lg shadow-[0_0_45px_rgba(0,243,255,0.12)]">
            <div className="mx-auto h-14 w-14 rounded-xl border border-cyan-400/40 bg-cyan-500/10 flex items-center justify-center mb-4">
              <Activity className="h-7 w-7 text-cyan-300" />
            </div>
            <h3 className="text-lg font-semibold text-white">{t('empty.title')}</h3>
            <p className="text-sm text-slate-400 mt-2">
              {t('empty.subtitle')}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {machines.map((machine) => (
              <MachineCard
                key={machine.id}
                machine={machine}
              />
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

function MachineCard({
  machine
}: { machine: Machine }) {
  const t = useTranslations('dashboard')
  const tMachine = useTranslations('machine')
  const locale = useLocale()
  const dateLocale = locale === 'de' ? de : enUS
  const isOnline = machine.status === 'online'
  const latestMetric = machine.metrics?.[0]
  const hasSecurityEvents = (machine.openSecurityEvents || 0) > 0
  const vulns = machine.vulnerabilities || { critical: 0, high: 0, medium: 0, low: 0, total: 0 }
  const secUpdates = machine.securityUpdates || 0
  const hasSecurityIssues = hasSecurityEvents || vulns.total > 0 || secUpdates > 0
  const lastSeenDate = new Date(machine.lastSeen)
  const lastSeenText = Date.now() - lastSeenDate.getTime() <= 60_000
    ? tMachine('status.live')
    : formatDistanceToNow(lastSeenDate, {
      addSuffix: true,
      locale: dateLocale,
    })

  let osInfo: any = {}
  try {
    osInfo = machine.osInfo ? JSON.parse(machine.osInfo) : {}
  } catch (e) {}

  // Severity color mapping
  const getSeverityColor = (severity: string | null | undefined) => {
    switch (severity) {
      case 'critical':
        return 'border-rose-500 bg-rose-500/20 text-rose-200'
      case 'high':
        return 'border-orange-500 bg-orange-500/20 text-orange-200'
      case 'medium':
        return 'border-amber-500 bg-amber-500/20 text-amber-200'
      default:
        return 'border-yellow-500 bg-yellow-500/20 text-yellow-200'
    }
  }

  const cardBody = (
    <div className={cn(
      "relative rounded-xl border border-slate-800 bg-[#0d141b] overflow-hidden transition-all duration-150 hover:border-cyan-500/40 cursor-pointer h-full flex flex-col",
      hasSecurityIssues && "ring-1 ring-rose-500/30"
    )}>

      <div className={cn(
        "relative px-6 py-4 border-b border-slate-800 flex items-start justify-between min-h-[88px]"
      )}>
        <div className="flex-1 pr-16">
          <h3 className="text-xl font-semibold text-white truncate">{machine.hostname}</h3>
          <p className="text-sm text-slate-400">{machine.ip}</p>
          <p className="mt-2 text-xs text-slate-500 truncate">
            {osInfo.distro ? `${osInfo.distro} ${osInfo.release}` : '\u00A0'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className={cn(
            "px-3 py-1 rounded-full text-xs font-mono uppercase tracking-[0.18em] border",
            isOnline
              ? "border-emerald-400/50 text-emerald-100 bg-emerald-500/10"
              : "border-slate-500/50 text-slate-300 bg-slate-700/20"
          )}>
            {isOnline ? t('status.online') : t('status.offline')}
          </div>
        </div>
      </div>

      {/* Security Badges Row – always rendered for consistent height */}
      {hasSecurityIssues ? (
        <Link
          href={`/security/${machine.id}`}
          className="relative flex flex-wrap items-center gap-2 px-6 py-3 border-b border-slate-800 bg-[#0c1219] hover:bg-[#111820] transition-colors min-h-[44px]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Severity badge from events (critical/high/medium) */}
          {hasSecurityEvents && machine.highestSeverity === 'critical' && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-rose-500 bg-rose-500/20 text-rose-200 text-[11px] font-semibold">
              <ShieldAlert className="h-3 w-3" />
              {t('badges.severityCritical')}
            </span>
          )}
          {hasSecurityEvents && machine.highestSeverity === 'high' && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-orange-500 bg-orange-500/20 text-orange-200 text-[11px] font-semibold">
              <ShieldAlert className="h-3 w-3" />
              {t('badges.severityHigh')}
            </span>
          )}
          {vulns.critical > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-rose-500 bg-rose-500/20 text-rose-200 text-[11px] font-semibold">
              <ShieldAlert className="h-3 w-3" />
              {t('badges.critical', { count: vulns.critical })}
            </span>
          )}
          {vulns.high > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-orange-500 bg-orange-500/20 text-orange-200 text-[11px] font-semibold">
              <ShieldAlert className="h-3 w-3" />
              {t('badges.high', { count: vulns.high })}
            </span>
          )}
          {vulns.medium > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-amber-500 bg-amber-500/20 text-amber-200 text-[11px] font-semibold">
              {t('badges.medium', { count: vulns.medium })}
            </span>
          )}
          {hasSecurityEvents && (
            <span className={cn(
              "inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold",
              getSeverityColor(machine.highestSeverity)
            )}>
              <ShieldAlert className="h-3 w-3" />
              {t('badges.events', { count: machine.openSecurityEvents || 0 })}
            </span>
          )}
          {secUpdates > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-cyan-500/60 bg-cyan-500/10 text-cyan-200 text-[11px] font-semibold">
              <PackageCheck className="h-3 w-3" />
              {t('badges.updates', { count: secUpdates })}
            </span>
          )}
        </Link>
      ) : (
        <div className="relative px-6 py-3 border-b border-slate-800 bg-[#0c1219] min-h-[44px] flex items-center">
          <span className="text-[11px] text-slate-500 font-mono">{t('badges.noIssues')}</span>
        </div>
      )}

      {latestMetric ? (
        <div className="relative px-6 py-4 space-y-3 flex-1">
          <MetricRow
            icon={<Cpu className="h-4 w-4 text-cyan-300" />}
            label={t('metrics.cpu')}
            value={latestMetric.cpuUsage}
            barClass="from-cyan-400 to-cyan-500"
          />
          <MetricRow
            icon={<MemoryStick className="h-4 w-4 text-purple-300" />}
            label={t('metrics.ram')}
            value={latestMetric.ramUsage}
            barClass="from-purple-400 to-purple-600"
          />
          <MetricRow
            icon={<HardDrive className="h-4 w-4 text-amber-300" />}
            label={t('metrics.disk')}
            value={latestMetric.diskUsage}
            barClass="from-amber-400 to-orange-500"
          />
          <div className="flex items-center justify-between text-xs pt-2 border-t border-white/10">
            <div className="flex items-center text-slate-400">
              <Clock className="h-4 w-4 mr-2 text-slate-500" />
              {t('metrics.uptime')}
            </div>
            <span className="font-semibold text-white">
              {formatUptime(latestMetric.uptime)}
            </span>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center px-6 py-8 text-slate-500 text-sm">
          {t('status.offline') === machine.status ? t('status.offline') : '—'}
        </div>
      )}

      <div className="relative px-6 py-3 bg-[#0c1219] border-t border-white/5 text-xs text-slate-400 mt-auto">
        {t('lastSeen')}{' '}
        {lastSeenText}
      </div>
    </div>
  )

  return (
    <Link href={`/machine/${machine.id}`} className="h-full">
      {cardBody}
    </Link>
  )
}

function MetricRow({
  icon,
  label,
  value,
  barClass,
}: {
  icon: ReactNode
  label: string
  value: number
  barClass: string
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-sm text-slate-200">
        {icon}
        <span>{label}</span>
      </div>
      <div className="flex items-center gap-3">
        <div className="w-28 h-2 bg-slate-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full bg-gradient-to-r ${barClass}`}
            style={{ width: `${Math.min(value, 100)}%` }}
          />
        </div>
        <span className="text-sm font-semibold text-white w-12 text-right">
          {value.toFixed(0)}%
        </span>
      </div>
    </div>
  )
}
