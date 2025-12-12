'use client'

import { useEffect, useState, useCallback, type ReactNode } from 'react'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { de, enUS } from 'date-fns/locale'
import { Activity, Cpu, HardDrive, MemoryStick, Clock, ShieldAlert } from 'lucide-react'
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
      const res = await fetch('/api/machines')

      if (res.status === 401) {
        window.location.href = '/login'
        return
      }

      const data = await res.json()
      setMachines(data.machines)
    } catch (error) {
      console.error('Failed to fetch machines:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchMachines()

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

  if (loading) {
    return (
      <div className="min-h-screen relative flex items-center justify-center bg-[#050505] text-[#E0E0E0] overflow-hidden">
        <BackgroundLayers />
        <div className="relative z-10 flex flex-col items-center space-y-4">
          <div className="h-14 w-14 rounded-xl border border-cyan-500/50 bg-cyan-500/10 flex items-center justify-center shadow-[0_0_30px_rgba(0,243,255,0.35)]">
            <div className="h-10 w-10 rounded-full border border-cyan-400/60 animate-spin border-t-transparent" />
          </div>
          <p className="text-sm font-mono tracking-[0.24em] uppercase text-cyan-200/80">
            {t('loading')}
          </p>
        </div>
      </div>
    )
  }

  return (
    <AppShell
      onAddAgent={() => setShowAddModal(true)}
    >
      <div className="space-y-8">
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
          </div>
        </div>

        {machines.length === 0 ? (
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
      "relative rounded-xl border border-slate-800 bg-[#0d141b] overflow-hidden transition-all duration-150 hover:border-cyan-500/40 cursor-pointer",
      hasSecurityEvents && "ring-1 ring-rose-500/30"
    )}>

      <div className={cn(
        "relative px-6 py-4 border-b border-slate-800 flex items-start justify-between"
      )}>
        <div className="flex-1 pr-16">
          <h3 className="text-xl font-semibold text-white">{machine.hostname}</h3>
          <p className="text-sm text-slate-400">{machine.ip}</p>
          {osInfo.distro && (
            <p className="mt-2 text-xs text-slate-500">
              {osInfo.distro} {osInfo.release}
            </p>
          )}
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
          {hasSecurityEvents && (
            <div className={cn(
              "flex items-center gap-1.5 px-2 py-1 rounded-full border text-xs font-semibold",
              getSeverityColor(machine.highestSeverity)
            )}>
              <ShieldAlert className="h-3.5 w-3.5" />
              <span>{machine.openSecurityEvents}</span>
            </div>
          )}
        </div>
      </div>

      {latestMetric && (
        <div className="relative px-6 py-4 space-y-3">
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
      )}

      <div className="relative px-6 py-3 bg-[#0c1219] border-t border-white/5 text-xs text-slate-400">
        {t('lastSeen')}{' '}
        {lastSeenText}
      </div>
    </div>
  )

  return (
    <Link href={`/machine/${machine.id}`}>
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
