'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import {
  ArrowLeft,
  ShieldAlert,
  ShieldCheck,
  ListChecks,
  ActivitySquare,
  PackageSearch,
  TerminalSquare,
  Info,
  Download,
  ChevronDown,
  ChevronUp,
  BookOpen,
  X,
  RefreshCw,
  CheckCircle2,
  Filter,
  AlertTriangle
} from 'lucide-react'
import AppShell from '@/components/AppShell'
import StatusBadge from '@/components/StatusBadge'
import AddAgentModal from '@/components/AddAgentModal'
import { formatDistanceToNow } from 'date-fns'
import { de, enUS } from 'date-fns/locale'
import type { Locale } from 'date-fns'
import { cn } from '@/lib/utils'

type SecurityEvent = {
  id: string
  type: string
  severity: string
  message: string
  status: string
  createdAt: string
}

type AuditLog = {
  id: string
  action: string
  severity: string
  details: string | null
  createdAt: string
}

type PackageRow = {
  id: string
  name: string
  version: string
  status: string
  manager: string | null
}

type PortEntry = {
  id: string
  port: number
  proto: string
  service: string
  state: string
  lastSeen: string
}

type VulnerabilityRow = {
  id: string
  cveId: string
  severity: string
  description?: string | null
  packageName: string
  packageVersion: string
  score?: number | null
  createdAt: string
}

function parseScanSummary(summary: any) {
  if (!summary) return null
  if (typeof summary === 'string') {
    try {
      return JSON.parse(summary)
    } catch {
      return summary
    }
  }
  return summary
}

// Handbook data - static content
const HANDBOOK_DATA = {
  fileIntegrity: [
    '/etc/passwd',
    '/etc/shadow',
    '/etc/sudoers',
    '/etc/ssh/sshd_config',
    '/etc/hosts',
    '/etc/crontab',
    '/root/.ssh/authorized_keys',
    '/etc/pam.d/sshd',
    '/etc/security/access.conf'
  ],
  sshConfig: [
    { key: 'PermitRootLogin', value: 'expected: no' },
    { key: 'PasswordAuthentication', value: 'expected: no' },
    { key: 'PermitEmptyPasswords', value: 'expected: no' }
  ],
  failedAttempts: [
    { range: '3-9 attempts', severity: 'medium' },
    { range: '10-49 attempts', severity: 'high' },
    { range: '50+ attempts', severity: 'critical' }
  ],
  logFiles: [
    '/var/log/auth.log (Debian/Ubuntu)',
    '/var/log/secure (RHEL/CentOS)'
  ],
  cveCoverageBullets: ['serverMirror', 'agentPaths', 'serverMatching', 'operatorChecks']
}

export default function VMSecurityDetailPage() {
  const params = useParams()
  const machineId = params?.id as string
  const t = useTranslations('securityDetail')
  const locale = useLocale()
  const dateLocale = locale === 'de' ? de : enUS
  const [loading, setLoading] = useState(true)
  const [packageLoading, setPackageLoading] = useState(true)
  const [events, setEvents] = useState<SecurityEvent[]>([])
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  const [packages, setPackages] = useState<PackageRow[]>([])
  const [packageQuery, setPackageQuery] = useState('')
  const [ports, setPorts] = useState<PortEntry[]>([])
  const [portsExpanded, setPortsExpanded] = useState(false)
  const [vulnerabilities, setVulnerabilities] = useState<VulnerabilityRow[]>([])
  const [vulnerabilitiesExpanded, setVulnerabilitiesExpanded] = useState(true)
  const [scanProgress, setScanProgress] = useState<{ progress: number; phase: string; etaSeconds: number | null; startedAt: string | null } | null>(null)
  const [scanReportExpanded, setScanReportExpanded] = useState(false)
  const [meta, setMeta] = useState<{ openEvents: number; lastScan?: string | null; hostname?: string; lastScanSummary?: any }>({ openEvents: 0 })
  const [securityEventsExpanded, setSecurityEventsExpanded] = useState(false)
  const [auditLogsExpanded, setAuditLogsExpanded] = useState(false)
  const [packagesExpanded, setPackagesExpanded] = useState(false)
  const [showHandbook, setShowHandbook] = useState(false)
  const [scanTriggering, setScanTriggering] = useState(false)
  const [scanFallbackStart, setScanFallbackStart] = useState<string | null>(null)
  const [resolving, setResolving] = useState(false)
  const [severityFilter, setSeverityFilter] = useState<'all' | 'important' | 'high-only'>('important')
  const [showAddModal, setShowAddModal] = useState(false)
  const [, forceUpdate] = useState(0) // For timestamp refresh
  const [toasts, setToasts] = useState<Array<{ id: number; message: string; tone: 'success' | 'error' | 'info' }>>([])
  const [etaCountdown, setEtaCountdown] = useState<number | null>(null)

  // Auto-refresh timestamp display every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      forceUpdate(n => n + 1)
    }, 30000)
    return () => clearInterval(interval)
  }, [])

  // Countdown for ETA while scan is running
  useEffect(() => {
    if (scanProgress?.etaSeconds != null) {
      setEtaCountdown(scanProgress.etaSeconds)
      setScanFallbackStart(null)
    } else {
      setEtaCountdown(null)
    }
  }, [scanProgress?.etaSeconds, scanProgress?.startedAt])

  useEffect(() => {
    if (etaCountdown === null) return
    const tick = setInterval(() => {
      setEtaCountdown((prev) => {
        if (prev === null) return null
        return prev > 0 ? prev - 1 : 0
      })
    }, 1000)
    return () => clearInterval(tick)
  }, [etaCountdown])

  const pushToast = useCallback((message: string, tone: 'success' | 'error' | 'info' = 'info') => {
    const id = Date.now() + Math.random()
    setToasts((prev) => [...prev, { id, message, tone }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 4200)
  }, [])

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const refreshAllData = useCallback(async (options?: { showLoading?: boolean }) => {
    if (!machineId) return

    if (options?.showLoading) {
      setLoading(true)
      setPackageLoading(true)
    }

    try {
      const [securityRes, packagesRes] = await Promise.all([
        fetch(`/api/vms/${machineId}/security`, { cache: 'no-store' }),
        fetch(`/api/vms/${machineId}/packages`, { cache: 'no-store' })
      ])

      let securityData: any = null
      let packagesData: any = null

      try {
        securityData = await securityRes.json()
      } catch (err) {
        console.error('Failed to parse security data', err)
      }

      try {
        packagesData = await packagesRes.json()
      } catch (err) {
        console.error('Failed to parse package data', err)
      }

      if (securityRes.ok && securityData) {
        setEvents(securityData.events || [])
        setAuditLogs(securityData.auditLogs || [])
        setPorts(securityData.ports || [])
        setVulnerabilities(
          (securityData.vulnerabilities || []).map((vuln: any) => ({
            id: vuln.id,
            cveId: vuln.cve?.id || vuln.cveId || 'unknown',
            severity: (vuln.cve?.severity || vuln.severity || 'unknown').toLowerCase(),
            description: vuln.cve?.description || vuln.description || null,
            packageName: vuln.package?.name || vuln.packageName || 'unknown package',
            packageVersion: vuln.package?.version || vuln.packageVersion || '',
            score: vuln.cve?.score ?? vuln.score ?? null,
            createdAt: vuln.createdAt
          }))
        )
        setMeta({
          openEvents: securityData.openEvents || 0,
          lastScan: securityData.lastScan?.createdAt || null,
          lastScanSummary: parseScanSummary(securityData.lastScan?.summary),
          hostname: securityData.machine?.hostname
        })
        if (securityData.scanProgress) {
          setScanProgress({
            progress: securityData.scanProgress.progress ?? 0,
            phase: securityData.scanProgress.phase ?? 'running',
            etaSeconds: securityData.scanProgress.etaSeconds ?? null,
            startedAt: securityData.scanProgress.startedAt ?? null
          })
          setScanFallbackStart(null)
        } else {
          setScanProgress(null)
          setScanFallbackStart(null)
        }
      } else {
        console.error('Failed to fetch security detail', securityData?.error)
        setVulnerabilities([])
      }

      if (packagesRes.ok && packagesData) {
        setPackages(packagesData.packages || [])
      } else {
        console.error('Failed to fetch packages', packagesData?.error)
      }
    } catch (error) {
      console.error('Failed to refresh security data', error)
    } finally {
      setLoading(false)
      setPackageLoading(false)
    }
  }, [machineId])

  // WebSocket connection for real-time events
  useEffect(() => {
    if (!machineId) return

    let ws: WebSocket | null = null
    
    const connectWebSocket = async () => {
      try {
        // Get JWT token for WebSocket authentication
        const tokenResponse = await fetch('/api/auth/get-ws-token')
        if (!tokenResponse.ok) {
          console.error('Failed to get WebSocket token:', tokenResponse.status)
          return
        }
        const { token } = await tokenResponse.json()

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        const wsUrl = `${protocol}//${window.location.host}/ws/web?token=${encodeURIComponent(token)}`
        ws = new WebSocket(wsUrl)

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data)
            
            // Handle new security events - check for duplicates by ID
            if (data.type === 'security_event' && data.machineId === machineId) {
              setEvents(prev => {
                const existingIndex = prev.findIndex(e => e.id === data.event.id)
                if (existingIndex >= 0) {
                  // Update existing event instead of adding duplicate
                  const updated = [...prev]
                  updated[existingIndex] = data.event
                  return updated
                }
                // New event - add to front and increment counter
                setMeta(m => ({
                  ...m,
                  openEvents: m.openEvents + 1
                }))
                return [data.event, ...prev].slice(0, 50)
              })
            }
            
            // Handle new audit logs - check for duplicates by ID
            if (data.type === 'audit_log' && data.machineId === machineId) {
              setAuditLogs(prev => {
                const existingIndex = prev.findIndex(l => l.id === data.log.id)
                if (existingIndex >= 0) {
                  // Update existing log instead of adding duplicate
                  const updated = [...prev]
                  updated[existingIndex] = data.log
                  return updated
                }
                return [data.log, ...prev].slice(0, 50)
              })
            }

            // Handle scan completed - update lastScan timestamp and reload events
            if (data.type === 'scan_completed' && data.machineId === machineId) {
              setMeta(prev => ({
                ...prev,
                lastScan: data.timestamp || new Date().toISOString()
              }))
              setScanProgress(null)
              setScanFallbackStart(null)
              pushToast(t('toasts.scanCompleted'), 'success')
              refreshAllData()
              setScanTriggering(false) // Stop animation when scan is complete
            }

            if (data.type === 'scan_progress' && data.machineId === machineId && data.progress) {
              setScanProgress({
                progress: data.progress.progress ?? 0,
                phase: data.progress.phase ?? 'running',
                etaSeconds: data.progress.etaSeconds ?? null,
                startedAt: data.progress.startedAt ?? null
              })
              setScanFallbackStart(null)
            }

            if (data.type === 'security_events_resolved' && data.machineId === machineId) {
              pushToast(t('toasts.eventsResolved'), 'info')
              refreshAllData()
            }
          } catch (e) {
            // Ignore parse errors for non-JSON messages
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
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close()
      }
    }
  }, [machineId, refreshAllData, pushToast, t])

  useEffect(() => {
    if (!machineId) return
    refreshAllData({ showLoading: true })
  }, [machineId, refreshAllData])

  const highestSeverity = useMemo(() => {
    const order = ['info', 'low', 'medium', 'high', 'critical']
    let current = 'info'
    const consider = (severity: string) => {
      const normalized = severity?.toLowerCase?.() || 'info'
      if (order.indexOf(normalized) > order.indexOf(current)) {
        current = normalized
      }
    }
    // Only count events that are still active (open or acknowledged).
    // Resolved events and low-severity events must not influence the severity badge.
    for (const evt of events.filter((e) => (e.status === 'open' || e.status === 'ack') && e.severity !== 'low')) {
      consider(evt.severity)
    }
    for (const vuln of vulnerabilities) consider(vuln.severity)
    return current
  }, [events, vulnerabilities])

  const vulnerabilityCounts = useMemo(() => {
    const critical = vulnerabilities.filter((v) => v.severity === 'critical').length
    const high = vulnerabilities.filter((v) => v.severity === 'high').length
    const medium = vulnerabilities.filter((v) => v.severity === 'medium').length
    return { critical, high, medium, total: vulnerabilities.length }
  }, [vulnerabilities])

  // Filter security events by severity level
  const filteredEvents = useMemo(() => {
    if (severityFilter === 'all') return events
    if (severityFilter === 'high-only') {
      return events.filter((e) => e.severity === 'high' || e.severity === 'critical')
    }
    // 'important' = high + medium + critical (hide low)
    return events.filter((e) => e.severity !== 'low')
  }, [events, severityFilter])

  // Count of hidden low-severity events
  const hiddenLowCount = useMemo(() => {
    return events.filter((e) => e.severity === 'low').length
  }, [events])

  const downloadPackagesCSV = () => {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19)
    const user = 'VMMaintainer' // Could be made dynamic if user auth is available
    
    const headers = ['Package Name', 'Version', 'Status', 'Manager', 'Timestamp', 'User']
    const csvContent = [
      headers.join(','),
      ...packages.map(pkg => [
        `"${pkg.name}"`,
        `"${pkg.version}"`,
        `"${pkg.status}"`,
        `"${pkg.manager || ''}"`,
        `"${timestamp}"`,
        `"${user}"`
      ].join(','))
    ].join('\n')
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.setAttribute('href', url)
    link.setAttribute('download', `packages-${machineId}-${new Date().toISOString().split('T')[0]}.csv`)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const triggerSecurityScan = async () => {
    if (!machineId || scanTriggering || scanProgress) return
    
    setScanTriggering(true)
    setScanFallbackStart(new Date().toISOString())
    
    try {
      // Step 1: Call API endpoint to validate and create audit log
      // ISO 27001 A.12.4.1: Event logging
      const apiResponse = await fetch(`/api/machines/${machineId}/scan`, {
        method: 'POST'
      })

      if (!apiResponse.ok) {
        const errorData = await apiResponse.json()
        pushToast(errorData.error || t('buttons.close'), 'error')
        setScanTriggering(false)
        return
      }

      // Step 2: Get JWT token for WebSocket authentication
      const tokenResponse = await fetch('/api/auth/get-ws-token')
      if (!tokenResponse.ok) {
        pushToast(t('buttons.close'), 'error')
        setScanTriggering(false)
        return
      }
      const { token } = await tokenResponse.json()

      // Step 3: Trigger scan via authenticated WebSocket
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const wsUrl = `${protocol}//${window.location.host}/ws/web?token=${encodeURIComponent(token)}`
      const ws = new WebSocket(wsUrl)
      
      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: 'trigger_scan',
          machineId
        }))
      }
      
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type === 'scan_triggered') {
            pushToast(t('handbook.sections.scanInterval.description'), 'success')
            // Keep animation running - will stop when scan_completed arrives
          } else if (data.type === 'error') {
            pushToast(data.message || t('buttons.close'), 'error')
            setScanTriggering(false)
          }
        } catch (e) {
          console.error('Error parsing WebSocket message:', e)
        }
        ws.close()
      }
      
      ws.onerror = () => {
        pushToast('Verbindungsfehler. Bitte erneut versuchen.', 'error')
        setScanTriggering(false)
        ws.close()
      }
      
      // Timeout after 30 seconds - stop animation if no response
      setTimeout(() => {
        if (scanTriggering) {
          pushToast('Scan dauert länger als erwartet. Prüfen Sie die Logs.', 'info')
          setScanTriggering(false)
        }
      }, 30000)
      
    } catch (error) {
      pushToast('Fehler beim Starten des Scans.', 'error')
      console.error('Scan trigger error:', error)
      setScanTriggering(false)
    }
  }

  const resolveAllEvents = async () => {
    if (!machineId || resolving) return
    
    setResolving(true)
    try {
      const res = await fetch(`/api/vms/${machineId}/security/resolve`, {
        method: 'POST'
      })
      const data = await res.json()
      
      if (res.ok) {
        // Update local state - mark all events as resolved
        setEvents(prev => prev.map(evt => ({
          ...evt,
          status: evt.status === 'open' || evt.status === 'ack' ? 'resolved' : evt.status
        })))
        setMeta(prev => ({ ...prev, openEvents: 0 }))
      } else {
        console.error('Failed to resolve events:', data.error)
      }
    } catch (error) {
      console.error('Error resolving events:', error)
    } finally {
      setResolving(false)
    }
  }

  const filteredPackages = useMemo(() => {
    let filtered = packages
    if (packageQuery.trim()) {
      const q = packageQuery.toLowerCase()
      filtered = packages.filter(
        (pkg) =>
          pkg.name.toLowerCase().includes(q) ||
          pkg.version.toLowerCase().includes(q) ||
          (pkg.manager || '').toLowerCase().includes(q) ||
          pkg.status.toLowerCase().includes(q)
      )
    }
    
    // Sortiere: Pakete mit Problemen oben, aktuelle Pakete unten
    return filtered.sort((a, b) => {
      const priorityOrder = ['security_update', 'update_available', 'current']
      const aPriority = priorityOrder.indexOf(a.status)
      const bPriority = priorityOrder.indexOf(b.status)
      
      // Wenn Status nicht in der Liste ist, behandle als 'current' (niedrigste Priorität)
      const aIndex = aPriority === -1 ? 2 : aPriority
      const bIndex = bPriority === -1 ? 2 : bPriority
      
      return aIndex - bIndex
    })
  }, [packages, packageQuery])

  const nextScanTime = useMemo(() => {
    if (!meta.lastScan) return null
    const lastScan = new Date(meta.lastScan)
    const nextScan = new Date(lastScan.getTime() + 30 * 60 * 1000) // 30 Minuten in Millisekunden
    return nextScan
  }, [meta.lastScan])

  const scanHelperText = useMemo(() => {
    if (!nextScanTime) {
      return t('handbook.sections.scanInterval.description')
    }
    
    const now = new Date()
    const timeUntilNext = nextScanTime.getTime() - now.getTime()
    const minutesUntilNext = Math.ceil(timeUntilNext / (1000 * 60))
    
    if (minutesUntilNext <= 0) {
      return locale === 'de'
        ? 'Security-Scans werden alle 30 Minuten automatisch vom Agent durchgeführt. Der nächste Scan läuft gerade oder startet in Kürze.'
        : 'Security scans are run automatically by the agent every 30 minutes. The next scan is running now or will start shortly.'
    }
    
    return locale === 'de'
      ? `Security-Scans werden alle 30 Minuten automatisch vom Agent durchgeführt. Nächster Scan in ${minutesUntilNext} Minute${minutesUntilNext !== 1 ? 'n' : ''}.`
      : `Security scans are run automatically by the agent every 30 minutes. Next scan in ${minutesUntilNext} minute${minutesUntilNext !== 1 ? 's' : ''}.`
  }, [nextScanTime, locale, t])

  const bannerProgress = useMemo(() => {
    if (scanProgress) return scanProgress
    if (scanTriggering && scanFallbackStart) {
      return {
        progress: 1,
        phase: 'starting',
        etaSeconds: null,
        startedAt: scanFallbackStart
      }
    }
    return null
  }, [scanProgress, scanTriggering, scanFallbackStart])

  return (
    <AppShell
      onAddAgent={() => setShowAddModal(true)}
    >
      {toasts.length > 0 && (
        <div className="fixed top-20 right-6 z-50 space-y-2 pointer-events-none">
          {toasts.map((toast) => {
            const toneClasses = toast.tone === 'success'
              ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-50'
              : toast.tone === 'error'
                ? 'border-rose-500/60 bg-rose-500/10 text-rose-50'
                : 'border-slate-700 bg-slate-900/80 text-slate-100'

            const icon =
              toast.tone === 'success' ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-300" />
              ) : toast.tone === 'error' ? (
                <ShieldAlert className="h-4 w-4 text-rose-300" />
              ) : (
                <Info className="h-4 w-4 text-cyan-200" />
              )

            return (
              <div
                key={toast.id}
                className={cn(
                  "rounded-lg border px-4 py-3 shadow-lg backdrop-blur flex items-start gap-3 min-w-[280px] max-w-sm pointer-events-auto",
                  toneClasses
                )}
              >
                <div className="mt-0.5">{icon}</div>
                <div className="flex-1 text-sm leading-relaxed">
                  {toast.message}
                </div>
                <button
                  onClick={() => dismissToast(toast.id)}
                  className="text-xs text-slate-300 hover:text-white"
                  aria-label={t('buttons.close')}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )
          })}
        </div>
      )}

      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => window.history.back()}
              className="h-10 w-10 rounded-lg border border-slate-700 text-slate-200 hover:bg-slate-800 transition-all flex items-center justify-center"
              title={t('buttons.close')}
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400 font-mono">
                {t('header.eyebrow')}
              </p>
              <h2 className="text-xl font-semibold text-white">
                {t('header.title')} {meta.hostname || 'VM'}
              </h2>
            </div>
          </div>
          <div className="flex gap-2">
            <StatusBadge
              icon={<ShieldAlert className="h-4 w-4" />}
              label={locale === 'de' ? `${meta.openEvents} offene Events` : `${meta.openEvents} open events`}
              tone={meta.openEvents > 0 ? 'warn' : 'good'}
            />
            <StatusBadge
              icon={highestSeverity === 'info' ? <ShieldCheck className="h-4 w-4" /> : <ListChecks className="h-4 w-4" />}
              label={
                highestSeverity === 'info'
                  ? (locale === 'de' ? 'Keine Bedrohungen' : 'No threats')
                  : (locale === 'de' ? `Schweregrad: ${highestSeverity.toUpperCase()}` : `Severity: ${highestSeverity.toUpperCase()}`)
              }
              tone={highestSeverity === 'critical' || highestSeverity === 'high' ? 'warn' : highestSeverity === 'info' ? 'good' : 'info'}
            />
          </div>
        </div>

        {bannerProgress && (
          <div className="rounded-xl border border-cyan-500/40 bg-cyan-500/5 p-4 shadow-[0_0_25px_rgba(34,211,238,0.15)]">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-cyan-100">
                <ShieldAlert className="h-4 w-4" />
                <span className="text-sm font-semibold">{t('handbook.sections.scanInterval.title')}</span>
                <span className="text-xs uppercase tracking-[0.16em] px-2 py-1 rounded-full border border-cyan-400/40 bg-cyan-400/10">
                  {bannerProgress.phase}
                </span>
              </div>
              <div className="text-xs text-slate-200">
                {etaCountdown !== null
                  ? t('liveScan.eta', { seconds: etaCountdown })
                  : t('liveScan.running')}
              </div>
            </div>
            <div className="mt-3 h-2 rounded-full bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-cyan-400 transition-all"
                style={{ width: `${Math.min(100, Math.max(0, bannerProgress.progress || 0))}%` }}
              />
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-slate-400 text-sm">{t('emptyStates.events.hint')}</div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
            <div className="xl:col-span-2 space-y-4">
              <ExpandableSectionCard
                title={t('sections.scanReport')}
                icon={<ActivitySquare className="h-4 w-4" />}
                helper={meta.lastScan ? t('labels.timestamp') : t('emptyStates.events.detail')}
                expanded={scanReportExpanded}
                onToggle={() => setScanReportExpanded(!scanReportExpanded)}
              >
                {meta.lastScan ? (
                  <div className="space-y-3 text-sm text-slate-200">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-300">{t('sections.scanReport')}</span>
                      <span className="text-xs text-slate-400">
                        {formatDistanceToNow(new Date(meta.lastScan), { locale: dateLocale })} ago
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <SummaryTile label={t('labels.package')} value={meta.lastScanSummary?.total ?? '—'} />
                      <SummaryTile label={t('packageStatus.updateAvailable')} value={meta.lastScanSummary?.updates ?? '—'} />
                      <SummaryTile label={t('packageStatus.securityUpdate')} value={meta.lastScanSummary?.securityUpdates ?? '—'} />
                    </div>
                    <div className="rounded-lg border border-slate-800 bg-[#0C121A]/60 p-3 space-y-2">
                      <div className="text-xs uppercase tracking-[0.16em] text-slate-400">
                        {t('labels.pathsScanned')}
                      </div>
                      {Array.isArray(meta.lastScanSummary?.paths) && meta.lastScanSummary.paths.length > 0 ? (
                        <ul className="text-xs text-slate-200 space-y-1">
                          {meta.lastScanSummary.paths.map((p: string) => (
                            <li key={p} className="truncate">• {p}</li>
                          ))}
                        </ul>
                      ) : (
                        <div className="text-xs text-slate-400">{t('labels.pathsScannedEmpty')}</div>
                      )}
                    </div>
                  </div>
                ) : (
                  <EmptyHint text={t('emptyStates.packages.hint')} detail={t('emptyStates.packages.detail')} />
                )}
              </ExpandableSectionCard>

              <ExpandableSectionCard
                title={`${locale === 'de' ? 'Schwachstellen' : 'Vulnerabilities'} (${vulnerabilities.length})`}
                icon={<ShieldAlert className="h-4 w-4" />}
                helper={locale === 'de' ? 'Abgeglichene CVEs gegen installierte Pakete.' : 'Matched CVEs against installed packages.'}
                expanded={vulnerabilitiesExpanded}
                onToggle={() => setVulnerabilitiesExpanded(!vulnerabilitiesExpanded)}
                badge={vulnerabilities.length > 0 ? (
                  <span className="ml-1 inline-flex items-center justify-center rounded-full bg-rose-600 text-white text-[10px] font-bold leading-none px-2 py-0.5">
                    {vulnerabilities.length}
                  </span>
                ) : null}
                actionButton={
                  vulnerabilities.length > 0 ? (
                    <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-slate-200 pointer-events-none">
                      <span className="px-2 py-1 rounded border border-rose-500/60 bg-rose-500/10">
                        {locale === 'de' ? 'Kritisch' : 'Critical'}: {vulnerabilityCounts.critical}
                      </span>
                      <span className="px-2 py-1 rounded border border-amber-500/60 bg-amber-500/10">
                        High: {vulnerabilityCounts.high}
                      </span>
                    </div>
                  ) : null
                }
              >
                {vulnerabilities.length === 0 ? (
                  <EmptyHint
                    text={locale === 'de' ? 'Keine CVEs gefunden.' : 'No CVEs detected.'}
                    detail={locale === 'de' ? 'Sobald Pakete mit bekannten CVEs erkannt werden, erscheinen sie hier.' : 'Once packages match known CVEs they will show up here.'}
                  />
                ) : (
                  <div className="space-y-3">
                    <div className="space-y-2 max-h-[360px] overflow-auto pr-1">
                      {vulnerabilities.map((vuln) => (
                        <div
                          key={vuln.id}
                          className="rounded-lg border border-slate-800 bg-[#0C121A]/80 p-3"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <a
                              href={getVulnerabilityLink(vuln.cveId)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm font-semibold text-cyan-200 hover:text-cyan-50"
                            >
                              {vuln.cveId}
                            </a>
                            <SeverityPill severity={vuln.severity} />
                          </div>
                          <div className="text-xs text-slate-300 flex items-center gap-2 mt-1">
                            <span className="font-mono text-slate-200">{vuln.packageName}</span>
                            <span className="text-slate-500">•</span>
                            <span className="text-slate-200">{vuln.packageVersion}</span>
                            {typeof vuln.score === 'number' && (
                              <span className="ml-auto px-2 py-0.5 rounded border border-slate-700 text-[11px] text-slate-100">
                                CVSS {vuln.score.toFixed(1)}
                              </span>
                            )}
                          </div>
                          {vuln.description && (
                            <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                              {vuln.description}
                            </p>
                          )}
                          <div className="text-[11px] text-slate-500 mt-2">
                            {formatDistanceToNow(new Date(vuln.createdAt), { locale: dateLocale })} ago
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </ExpandableSectionCard>

              <ExpandableSectionCard
                title={t('sections.securityEvents')}
                icon={<ShieldCheck className="h-4 w-4" />}
                helper={t('tooltips.fileIntegrity')}
                expanded={securityEventsExpanded}
                onToggle={() => setSecurityEventsExpanded(!securityEventsExpanded)}
                badge={meta.openEvents > 0 ? (
                  <span className="ml-1 inline-flex items-center justify-center rounded-full bg-rose-600 text-white text-[10px] font-bold leading-none px-2 py-0.5">
                    {meta.openEvents}
                  </span>
                ) : null}
                actionButton={
                  <div className="flex items-center gap-2">
                    {meta.openEvents > 0 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); resolveAllEvents(); }}
                        disabled={resolving}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/10 transition-colors disabled:opacity-50 pointer-events-auto"
                        title={locale === 'de' ? 'Alle Events als gelesen markieren' : 'Mark all events as read'}
                      >
                        <CheckCircle2 className={`h-3 w-3 ${resolving ? 'animate-spin' : ''}`} />
                        {resolving ? (locale === 'de' ? 'Wird markiert...' : 'Marking...') : (locale === 'de' ? 'Alle gelesen' : 'Mark all read')}
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowHandbook(true); }}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-cyan-500/50 text-cyan-300 hover:bg-cyan-500/10 transition-colors pointer-events-auto"
                      title={t('buttons.handbook')}
                    >
                      <BookOpen className="h-3 w-3" />
                      {t('buttons.handbook')}
                    </button>
                  </div>
                }
              >
                {events.length === 0 ? (
                  <EmptyHint
                    text={t('emptyStates.events.hint')}
                    detail={t('emptyStates.events.detail')}
                  />
                ) : (
                  <div className="space-y-3">
                    {/* Severity Filter Bar */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <Filter className="h-3.5 w-3.5 text-slate-400" />
                      {(['important', 'all', 'high-only'] as const).map((level) => {
                        const labels = {
                          all: t('filters.all'),
                          important: t('filters.important'),
                          'high-only': t('filters.highOnly')
                        }
                        return (
                          <button
                            key={level}
                            onClick={() => setSeverityFilter(level)}
                            className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                              severityFilter === level
                                ? 'border-cyan-500 text-cyan-200 bg-cyan-500/15'
                                : 'border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500'
                            }`}
                          >
                            {labels[level]}
                          </button>
                        )
                      })}
                      {hiddenLowCount > 0 && severityFilter !== 'all' && (
                        <span className="text-xs text-slate-500 ml-1">
                          ({hiddenLowCount} {t('filters.hiddenLow')})
                        </span>
                      )}
                    </div>

                    {filteredEvents.length === 0 ? (
                      <p className="text-sm text-slate-500 text-center py-4">
                        {t('filters.noMatch')}
                      </p>
                    ) : (
                      filteredEvents.map((evt) => (
                        <div
                          key={evt.id}
                          className={`rounded-lg border p-3 flex items-start gap-3 overflow-hidden ${
                            evt.status === 'resolved' 
                              ? 'border-slate-800/50 bg-[#0C121A]/40 opacity-60' 
                              : 'border-slate-800 bg-[#0C121A]/80'
                          }`}
                        >
                          <SeverityPill severity={evt.severity} />
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium break-all ${evt.status === 'resolved' ? 'text-slate-400' : 'text-white'}`}>
                              {evt.message}
                            </p>
                            <p className="text-xs text-slate-400">
                              {evt.type} • {formatDistanceToNow(new Date(evt.createdAt), { locale: dateLocale })} ago • 
                              <span className={evt.status === 'resolved' ? 'text-emerald-400' : 'text-amber-400'}>
                                {' '}{evt.status === 'resolved' ? '✓ Read' : evt.status}
                              </span>
                            </p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </ExpandableSectionCard>

              <ExpandableSectionCard
                title={t('sections.auditLogs')}
                icon={<TerminalSquare className="h-4 w-4" />}
                helper={t('tooltips.authMonitoring')}
                expanded={auditLogsExpanded}
                onToggle={() => setAuditLogsExpanded(!auditLogsExpanded)}
                badge={auditLogs.length > 0 ? (
                  <span className="ml-1 inline-flex items-center justify-center rounded-full bg-slate-600 text-white text-[10px] font-bold leading-none px-2 py-0.5">
                    {auditLogs.length}
                  </span>
                ) : null}
              >
                {auditLogs.length === 0 ? (
                  <EmptyHint
                    text={t('emptyStates.logs.hint')}
                    detail={t('emptyStates.logs.detail')}
                  />
                ) : (
                  <div className="space-y-2">
                    {auditLogs.map((log) => (
                      <div
                        key={log.id}
                        className="rounded-lg border border-slate-800 bg-[#0C121A]/70 p-3"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-white font-medium">{log.action}</span>
                          <span className="text-xs text-slate-400">
                            {formatDistanceToNow(new Date(log.createdAt), { locale: dateLocale })} ago
                          </span>
                        </div>
                        {log.details && (
                          <p className="text-xs text-slate-300 mt-1 break-words">
                            {log.details}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </ExpandableSectionCard>
            </div>

            <div className="space-y-4">
              <SectionCard 
                title={locale === 'de' ? 'Letzter Scan' : 'Last Scan'}
                icon={<ActivitySquare className="h-4 w-4" />}
                helper={scanHelperText}
              >
                {meta.lastScan ? (
                  <div className="text-sm text-slate-200">
                    {locale === 'de' ? 'Vor ' : ''}{formatDistanceToNow(new Date(meta.lastScan), { locale: dateLocale })}{locale === 'de' ? ' durchgeführt.' : ' ago'}
                  </div>
                ) : (
                  <div className="text-sm text-slate-400">{locale === 'de' ? 'Noch kein Scan registriert.' : 'No scan recorded yet.'}</div>
                )}
                <div className="mt-3 space-y-2">
                  <button
                  onClick={triggerSecurityScan}
                  disabled={scanTriggering || !!scanProgress}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-cyan-500/50 bg-cyan-500/10 text-sm text-cyan-300 hover:bg-cyan-500/20 hover:border-cyan-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RefreshCw className={`h-4 w-4 ${scanTriggering ? 'animate-spin' : ''}`} />
                  {scanTriggering
                    ? (locale === 'de' ? 'Scan wird gestartet...' : 'Starting scan...')
                    : bannerProgress
                      ? t('liveScan.running')
                      : (locale === 'de' ? 'Scan jetzt starten' : 'Start scan now')}
                </button>
                {bannerProgress && (
                  <p className="text-xs text-slate-400">
                    {t('scanButton.disabled')}
                  </p>
                )}
              </div>
            </SectionCard>
            </div>
          </div>
        )}

        <ExpandableSectionCard
          title={`${t('sections.packages')}${packages.length > 0 ? ` (${packages.length})` : ''}`}
          icon={<PackageSearch className="h-4 w-4" />}
          expanded={packagesExpanded}
          onToggle={() => setPackagesExpanded(!packagesExpanded)}
          badge={
            packages.length > 0 && packages.some((p) => p.status === 'update_available' || p.status === 'security_update')
              ? (
                <span className="ml-1 inline-flex items-center justify-center rounded-full bg-rose-600 text-white text-[10px] font-bold leading-none px-2 py-0.5">
                  {packages.filter((p) => p.status === 'update_available' || p.status === 'security_update').length}
                </span>
              )
              : null
          }
        >
          {packageLoading ? (
            <div className="text-sm text-slate-400">{t('emptyStates.packages.hint')}</div>
          ) : packages.length === 0 ? (
            <EmptyHint
              text={t('emptyStates.packages.hint')}
              detail={t('emptyStates.packages.detail')}
            />
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 flex-1">
                  <input
                    type="search"
                    value={packageQuery}
                    onChange={(e) => setPackageQuery(e.target.value)}
                    placeholder={locale === 'de' ? 'Pakete durchsuchen (Name, Version, Status, Manager)' : 'Search packages (name, version, status, manager)'}
                    className="w-full rounded-lg border border-slate-700 bg-[#0d141d] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
                  />
                  <div className="text-xs text-slate-400 min-w-[120px] text-right">
                    {filteredPackages.length}/{packages.length} {locale === 'de' ? 'Pakete' : 'packages'}
                  </div>
                </div>
                <button
                  onClick={downloadPackagesCSV}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-700 bg-[#0d141d] text-sm text-slate-300 hover:border-cyan-500 hover:text-cyan-100 transition-colors"
                  title={locale === 'de' ? 'Packages als CSV herunterladen' : 'Download packages as CSV'}
                >
                  <Download className="h-4 w-4" />
                  CSV
                </button>
              </div>
              <div className="max-h-[80vh] overflow-auto space-y-2 pr-1">
                {filteredPackages.map((pkg) => (
                  <div
                    key={pkg.id}
                    className="rounded-lg border border-slate-800 bg-[#0C121A]/80 p-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <p className="text-sm text-white font-medium truncate">{pkg.name}</p>
                        <p className="text-xs text-slate-400 truncate">
                          {pkg.version} {pkg.manager ? `• ${pkg.manager}` : ''}
                        </p>
                      </div>
                      <PackagePill status={pkg.status} t={t} locale={locale} />
                    </div>
                    {pkg.status === 'security_update' && <PackageActionHint pkg={pkg} t={t} locale={locale} />}
                  </div>
                ))}
              </div>
            </div>
          )}
        </ExpandableSectionCard>

        {/* Open Ports Section */}
        <ExpandableSectionCard
          title={`${t('sections.ports')}${ports.length > 0 ? ` (${ports.length})` : ''}`}
          icon={
            <svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="currentColor" className="h-4 w-4">
              <path d="M440-440q17 0 28.5-11.5T480-480q0-17-11.5-28.5T440-520q-17 0-28.5 11.5T400-480q0 17 11.5 28.5T440-440ZM280-120v-80l240-40v-445q0-15-9-27t-23-14l-208-34v-80l220 36q44 8 72 41t28 77v512l-320 54Zm-160 0v-80h80v-560q0-34 23.5-57t56.5-23h400q34 0 57 23t23 57v560h80v80H120Zm160-80h400v-560H280v560Z"/>
            </svg>
          }
          helper={t('tooltips.fileIntegrity')}
          expanded={portsExpanded}
          onToggle={() => setPortsExpanded(!portsExpanded)}
        >
          {ports.length === 0 ? (
            <EmptyHint
              text={t('emptyStates.ports.hint')}
              detail={t('emptyStates.ports.detail')}
            />
          ) : (
            <div className="overflow-auto max-h-[480px]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[#0d141b] z-10">
                  <tr className="border-b border-slate-800 text-slate-300">
                    <th className="text-left py-2 px-3 font-semibold w-24">{t('labels.port')}</th>
                    <th className="text-left py-2 px-3 font-semibold w-32">{t('labels.protocol')}</th>
                    <th className="text-left py-2 px-3 font-semibold">{t('labels.service')}</th>
                    <th className="text-left py-2 px-3 font-semibold w-32">{t('labels.state')}</th>
                    <th className="text-left py-2 px-3 font-semibold w-40">{t('labels.timestamp')}</th>
                  </tr>
                </thead>
                <tbody>
                  {ports.map((port) => (
                    <tr key={port.id} className="border-b border-slate-800 hover:bg-slate-900/60 text-slate-200">
                      <td className="py-2 px-3 font-mono">{port.port}</td>
                      <td className="py-2 px-3">
                        <span className={cn(
                          "px-2 py-1 rounded text-xs font-medium border",
                          port.proto === 'tcp'
                            ? "bg-cyan-500/10 text-cyan-100 border-cyan-400/30"
                            : "bg-purple-500/10 text-purple-100 border-purple-400/30"
                        )}>
                          {port.proto.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-slate-200">{port.service}</td>
                      <td className="py-2 px-3">
                        <span className="px-2 py-1 bg-emerald-500/10 text-emerald-100 border border-emerald-400/30 rounded text-xs font-medium">
                          {port.state}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-slate-400 text-xs">
                        {formatDistanceToNow(new Date(port.lastSeen), { addSuffix: true, locale: dateLocale })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ExpandableSectionCard>
      </div>

      {/* Security Handbuch Modal */}
      {showHandbook && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0A0F16] border border-slate-700 rounded-xl max-w-3xl w-full max-h-[85vh] overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between p-4 border-b border-slate-700">
              <div className="flex items-center gap-2 text-cyan-200">
                <BookOpen className="h-5 w-5" />
                <h2 className="text-lg font-semibold">{t('handbook.title')}</h2>
              </div>
              <button
                onClick={() => setShowHandbook(false)}
                className="h-8 w-8 rounded-lg border border-slate-600 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors flex items-center justify-center"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto max-h-[calc(85vh-4rem)] space-y-6">
              
              {/* File Integrity Monitoring */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-cyan-300 uppercase tracking-wider flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4" />
                  {t('handbook.sections.fileIntegrity.title')}
                </h3>
                <p className="text-sm text-slate-300">
                  {t('handbook.sections.fileIntegrity.description')}
                </p>
                <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700">
                  <p className="text-xs text-slate-400 mb-2 font-medium">{t('handbook.sections.fileIntegrity.files')}:</p>
                  <div className="grid grid-cols-2 gap-1 text-xs font-mono text-slate-300">
                    {HANDBOOK_DATA.fileIntegrity.map((file: string) => (
                      <span key={file}>{file}</span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Config Drift Detection */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-amber-300 uppercase tracking-wider flex items-center gap-2">
                  <ListChecks className="h-4 w-4" />
                  {t('handbook.sections.configDrift.title')}
                </h3>
                <p className="text-sm text-slate-300">
                  {t('handbook.sections.configDrift.description')}
                </p>
                <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700">
                  <p className="text-xs text-slate-400 mb-2 font-medium">{t('handbook.sections.configDrift.sshConfig')}:</p>
                  <div className="space-y-1 text-xs">
                    {HANDBOOK_DATA.sshConfig.map((exp: any) => (
                      <div key={exp.key} className="flex justify-between">
                        <span className="font-mono text-slate-300">{exp.key}</span>
                        <span className="text-emerald-400">{exp.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Auth Log Monitoring */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-rose-300 uppercase tracking-wider flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4" />
                  {t('handbook.sections.authLogMonitoring.title')}
                </h3>
                <p className="text-sm text-slate-300">
                  {t('handbook.sections.authLogMonitoring.description')}
                </p>
                <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700 space-y-2">
                  <div>
                    <p className="text-xs text-slate-400 font-medium">{t('handbook.sections.authLogMonitoring.failedLogins')}:</p>
                    <div className="text-xs text-slate-300 mt-1 space-y-0.5">
                      {HANDBOOK_DATA.failedAttempts.map((attempt: any) => (
                        <div key={attempt.range}>• {attempt.range} → <span className={
                          attempt.severity === 'critical' ? 'text-rose-400' :
                          attempt.severity === 'high' ? 'text-orange-400' :
                          'text-amber-400'
                        }>{attempt.severity}</span></div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400 font-medium">{t('handbook.sections.authLogMonitoring.rootLogins')}:</p>
                    <p className="text-xs text-slate-300">{t('handbook.sections.authLogMonitoring.rootLoginsDetail')}</p>
                  </div>
                </div>
                <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700">
                  <p className="text-xs text-slate-400 mb-2 font-medium">{t('handbook.sections.authLogMonitoring.monitoredFiles')}:</p>
                  <div className="text-xs font-mono text-slate-300 space-y-0.5">
                    {HANDBOOK_DATA.logFiles.map((logfile: string) => (
                      <div key={logfile}>{logfile}</div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Scan Interval */}
              <div className="space-y-3 pt-2 border-t border-slate-700">
                <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                  <ActivitySquare className="h-4 w-4" />
                  {t('handbook.sections.scanInterval.title')}
                </h3>
                <p className="text-sm text-slate-300">
                  {locale === 'de' 
                    ? `${t('handbook.sections.scanInterval.description')} ${t('handbook.sections.scanInterval.interval')} automatisch vom Agent durchgeführt.`
                    : t('handbook.sections.scanInterval.description')}
                </p>
              </div>

              <div className="space-y-3 pt-2 border-t border-slate-700">
                <h3 className="text-sm font-semibold text-cyan-200 uppercase tracking-wider flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4" />
                  {t('handbook.sections.cveSync.title')}
                </h3>
                <p className="text-sm text-slate-300">
                  {t('handbook.sections.cveSync.description')}
                </p>
                <div className="space-y-2 text-xs text-slate-300">
                  <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-3">
                    <div className="font-semibold text-slate-100 mb-1">
                      {t('handbook.sections.cveSync.automatic')}
                    </div>
                    <div className="text-slate-400">{t('handbook.sections.cveSync.manual')}</div>
                  </div>
                  <div className="rounded-lg border border-slate-700 bg-slate-900/70 p-3">
                    <div className="font-semibold text-slate-100 mb-1">API</div>
                    <code className="block text-cyan-200">POST /api/security/cve</code>
                    <code className="block text-cyan-200 mt-1">GET /api/security/cve</code>
                    <p className="mt-2 text-slate-400">{t('handbook.sections.cveSync.apiHint')}</p>
                  </div>
                </div>
              </div>

              <div className="space-y-3 pt-2 border-t border-slate-700">
                <h3 className="text-sm font-semibold text-cyan-300 uppercase tracking-wider flex items-center gap-2">
                  <BookOpen className="h-4 w-4" />
                  {t('handbook.sections.cveCoverage.title')}
                </h3>
                <p className="text-sm text-slate-300">
                  {t('handbook.sections.cveCoverage.description')}
                </p>
                <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700">
                  <ul className="text-xs text-slate-200 space-y-1">
                    {HANDBOOK_DATA.cveCoverageBullets.map((key) => (
                      <li key={key}>• {t(`handbook.sections.cveCoverage.bullets.${key}`)}</li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Severity Classification */}
              <div className="space-y-3 pt-2 border-t border-slate-700">
                <h3 className="text-sm font-semibold text-amber-300 uppercase tracking-wider flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  {t('handbook.sections.severityClassification.title')}
                </h3>
                <p className="text-sm text-slate-300">
                  {t('handbook.sections.severityClassification.description')}
                </p>
                <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700 space-y-3">
                  <div>
                    <p className="text-xs font-semibold text-orange-300">{t('handbook.sections.severityClassification.high')}</p>
                    <p className="text-xs font-mono text-slate-400 mt-0.5">{t('handbook.sections.severityClassification.highPaths')}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-amber-300">{t('handbook.sections.severityClassification.medium')}</p>
                    <p className="text-xs font-mono text-slate-400 mt-0.5">{t('handbook.sections.severityClassification.mediumPaths')}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-400">{t('handbook.sections.severityClassification.low')}</p>
                    <p className="text-xs font-mono text-slate-500 mt-0.5">{t('handbook.sections.severityClassification.lowPaths')}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-500">{t('handbook.sections.severityClassification.ignored')}</p>
                    <p className="text-xs font-mono text-slate-600 mt-0.5">{t('handbook.sections.severityClassification.ignoredPaths')}</p>
                  </div>
                </div>
                <p className="text-xs text-slate-400 italic">
                  {t('handbook.sections.severityClassification.filterNote')}
                </p>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* Add Agent Modal */}
      {showAddModal && (
        <AddAgentModal onClose={() => setShowAddModal(false)} />
      )}
    </AppShell>
  )
}

function getVulnerabilityLink(cveId: string) {
  if (!cveId) return '#'
  return cveId.toUpperCase().startsWith('CVE-')
    ? `https://nvd.nist.gov/vuln/detail/${cveId}`
    : `https://osv.dev/vulnerability/${cveId}`
}

function SectionCard({
  title,
  icon,
  children,
  helper,
  badge
}: {
  title: string
  icon: ReactNode
  children: ReactNode
  helper?: string
  badge?: ReactNode
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-[#0A0F16]/80 p-4 space-y-3 shadow-[0_0_30px_rgba(0,243,255,0.06)]">
      <div className="flex items-center gap-2 text-sm text-slate-200">
        {icon}
        <span className="font-semibold">{title}</span>
        {badge}
        {helper && (
          <div className="relative group">
            <Info className="h-3.5 w-3.5 text-cyan-300 cursor-help" />
            <div className="absolute left-0 top-full mt-1 w-64 p-2 bg-slate-800 text-xs text-slate-300 rounded-md border border-slate-700 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-10">
              {helper}
            </div>
          </div>
        )}
      </div>
      {children}
    </div>
  )
}

function ExpandableSectionCard({
  title,
  icon,
  children,
  helper,
  expanded,
  onToggle,
  actionButton,
  badge
}: {
  title: string
  icon: ReactNode
  children: ReactNode
  helper?: string
  expanded: boolean
  onToggle: () => void
  actionButton?: ReactNode
  badge?: ReactNode
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-[#0A0F16]/80 shadow-[0_0_30px_rgba(0,243,255,0.06)]">
      <div
        onClick={onToggle}
        className="w-full p-4 flex items-center justify-between text-left hover:bg-slate-800/50 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2 text-sm text-slate-200">
          {icon}
          <span className="font-semibold">{title}</span>
          {badge}
          {helper && (
            <div className="relative group">
              <Info className="h-3.5 w-3.5 text-cyan-300 cursor-help" />
              <div className="absolute left-0 top-full mt-1 w-64 p-2 bg-slate-800 text-xs text-slate-300 rounded-md border border-slate-700 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-10">
                {helper}
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {actionButton}
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-slate-400 pointer-events-none" />
          ) : (
            <ChevronDown className="h-4 w-4 text-slate-400 pointer-events-none" />
          )}
        </div>
      </div>
      {expanded && (
        <div className="px-4 pb-4">
          {children}
        </div>
      )}
    </div>
  )
}

function EmptyHint({ text, detail }: { text: string; detail: string }) {
  return (
    <div className="text-sm text-slate-300 space-y-1">
      <div className="font-medium text-white/90">{text}</div>
      <p className="text-xs text-slate-400 leading-relaxed">{detail}</p>
    </div>
  )
}

function SeverityPill({ severity }: { severity: string }) {
  const tone =
    severity === 'critical'
      ? 'border-rose-500/60 text-rose-200 bg-rose-500/10'
      : severity === 'high'
        ? 'border-orange-500/60 text-orange-200 bg-orange-500/10'
        : severity === 'medium'
          ? 'border-amber-400/60 text-amber-200 bg-amber-500/10'
          : severity === 'low'
            ? 'border-slate-600 text-slate-400 bg-slate-800/60'
            : 'border-slate-700 text-slate-200 bg-slate-800/60'
  return (
    <span className={`text-[11px] uppercase tracking-[0.2em] px-2 py-1 rounded-full border ${tone}`}>
      {severity}
    </span>
  )
}

function PackagePill({ status, t, locale }: { status: string; t?: any; locale?: string }) {
  const tone =
    status === 'security_update'
      ? 'border-rose-500/60 text-rose-200 bg-rose-500/10'
      : status === 'update_available'
        ? 'border-amber-400/60 text-amber-200 bg-amber-500/10'
        : 'border-emerald-500/60 text-emerald-200 bg-emerald-500/10'
  
  const label =
    status === 'security_update'
      ? t?.('packageStatus.securityUpdate') || 'Security Update'
      : status === 'update_available'
        ? t?.('packageStatus.updateAvailable') || 'Update verfügbar'
        : t?.('packageStatus.current') || 'Aktuell'
  
  const helper =
    status === 'security_update'
      ? locale === 'de' ? 'Vom Paket-Manager als sicherheitsrelevant markiert. Bitte aktualisieren.' : 'Marked as security-relevant by the package manager. Please update.'
      : status === 'update_available'
        ? locale === 'de' ? 'Es gibt eine nicht-sicherheitskritische neue Version.' : 'A non-critical update is available.'
        : locale === 'de' ? 'Dieses Paket ist auf dem erwarteten Stand.' : 'This package is at the expected level.'
  
  return (
    <span
      className={`text-[11px] uppercase tracking-[0.2em] px-2 py-1 rounded-full border ${tone}`}
      title={helper}
    >
      {label}
    </span>
  )
}

function PackageActionHint({ pkg, t, locale }: { pkg: PackageRow; t?: any; locale?: string }) {
  const manager = pkg.manager?.toLowerCase()

  let commandLabel = locale === 'de' ? 'Empfohlene Aktion' : 'Recommended action'
  let command = ''

  if (manager === 'apt') {
    commandLabel = t?.('packageActions.updateManagers.apt') || (locale === 'de' ? 'Mit apt aktualisieren' : 'Update with apt')
    command = `sudo apt-get update && sudo apt-get install --only-upgrade ${pkg.name}`
  } else if (manager === 'yum') {
    commandLabel = t?.('packageActions.updateManagers.yum') || (locale === 'de' ? 'Mit yum aktualisieren' : 'Update with yum')
    command = `sudo yum update ${pkg.name}`
  } else if (manager === 'dnf') {
    commandLabel = t?.('packageActions.updateManagers.dnf') || (locale === 'de' ? 'Mit dnf aktualisieren' : 'Update with dnf')
    command = `sudo dnf upgrade ${pkg.name}`
  } else if (manager === 'pacman') {
    commandLabel = t?.('packageActions.updateManagers.pacman') || (locale === 'de' ? 'Mit pacman aktualisieren' : 'Update with pacman')
    command = `sudo pacman -Syu ${pkg.name}`
  }

  return (
    <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
      <div className="text-[11px] uppercase tracking-[0.14em] text-amber-200 font-semibold">
        {t?.('packageActions.whySecurityUpdate') || (locale === 'de' ? 'Warum "Security Update"?' : 'Why "Security Update"?')}
      </div>
      <p className="mt-2 text-xs text-slate-200 leading-relaxed">
        {t?.('packageActions.securityUpdateExplanation') || (locale === 'de' ? 'Dieses Paket hat laut Paketquelle eine als sicherheitsrelevant markierte Aktualisierung. Der Agent zeigt es, bis die neueste abgesicherte Version installiert ist.' : 'This package has a security-relevant update according to the package source. The agent displays it until the latest secured version is installed.')}
      </p>
      {command && (
        <div className="mt-3 space-y-1">
          <div className="text-[11px] uppercase tracking-[0.12em] text-slate-300">{commandLabel}</div>
          <code className="block w-full overflow-x-auto text-xs text-cyan-100 bg-slate-900 border border-slate-700 px-2 py-1 rounded">
            {command}
          </code>
          <p className="text-[11px] text-slate-400">
            {t?.('packageActions.afterUpdate') || (locale === 'de' ? 'Nach dem Update sendet der Agent beim nächsten Sync den neuen Paketstatus.' : 'After the update, the agent will send the new package status on the next sync.')}
          </p>
        </div>
      )}
    </div>
  )
}

function SummaryTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-[#0C121A]/70 p-3">
      <div className="text-xs uppercase tracking-[0.16em] text-slate-400">{label}</div>
      <div className="text-lg font-semibold text-white mt-1">{value}</div>
    </div>
  )
}
