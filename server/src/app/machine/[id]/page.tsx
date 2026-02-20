'use client'

import { useEffect, useState, useRef, FormEvent, type ReactNode } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { 
  ArrowLeft, 
  Cpu,
  MemoryStick,
  HardDrive,
  Clock,
  Terminal as TerminalIcon,
  RefreshCw,
  Download,
  Power,
  Activity,
  CheckCircle2,
  AlertCircle,
  Trash2,
  PackageCheck,
  Save,
  Link2,
  ExternalLink,
  BookOpen,
  ChevronDown,
  TrendingUp,
  LineChart as LineChartIcon,
  Sigma,
  ShieldAlert
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { de, enUS } from 'date-fns/locale'
import { useTranslations, useLocale } from 'next-intl'
import { cn, formatBytes, formatUptime } from '@/lib/utils'
import {
  calculateWeightedRegression,
  calculateExpRegression,
  calculateSMA,
  calculateBollinger,
  calculateWindowedRoC,
  calculatePercentile,
  forecastThreshold,
  computeSMAWindow,
  calculateHealthScore,
  confidenceLabel,
  describeTrend,
  meanUsage,
  dataSpanHours,
  type UsageKey,
  type RegressionResult,
  type ForecastResult,
  type ConfidenceLabel,
  type TrendDirection,
} from '@/lib/analytics'
import CommandLogDialog from '@/components/CommandLogDialog'
import AppShell from '@/components/AppShell'
import AddAgentModal from '@/components/AddAgentModal'
import CriticalCommandDialog, { isCriticalCommand } from '@/components/CriticalCommandDialog'
import TerminalAuthDialog from '@/components/TerminalAuthDialog'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
  Brush,
  ReferenceLine
} from 'recharts'

// Dynamically import Terminal to avoid SSR issues with xterm
const Terminal = dynamic(() => import('@/components/Terminal'), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center h-full">Loading terminal...</div>
})

interface Machine {
  id: string
  hostname: string
  ip: string
  osInfo: string | null
  status: string
  lastSeen: string
  createdAt: string
  notes: string | null
  metrics: Array<{
    id: string
    cpuUsage: number
    ramUsage: number
    ramTotal: number
    ramUsed: number
    diskUsage: number
    diskTotal: number
    diskUsed: number
    uptime: number
    timestamp: string
  }>
  commands: Array<{
    id: string
    command: string
    output: string | null
    exitCode: number | null
    status: string
    createdAt: string
    completedAt: string | null
  }>
  ports: Array<{
    id: string
    port: number
    proto: string
    service: string
    state: string
    lastSeen: string
  }>
  links: Array<{
    id: string
    title: string
    url: string
    description: string | null
    createdAt: string
    updatedAt: string
  }>
}

type RangeKey = '24h' | '7d' | '30d' | '90d'

const RANGE_TO_HOURS: Record<RangeKey, number> = {
  '24h': 24,
  '7d': 24 * 7,
  '30d': 24 * 30,
  '90d': 24 * 90,
}

interface HistoricalMetric {
  id?: string
  machineId?: string
  cpuUsage: number
  ramUsage: number
  ramTotal: number
  ramUsed: number
  diskUsage: number
  diskTotal: number
  diskUsed: number
  uptime: number
  timestamp: string
}

interface AnalyticsMeta {
  bucketSize: number
  rawCount: number
  rangeKey: RangeKey
  rangeHours: number
}

export default function MachinePage() {
  const params = useParams()
  const router = useRouter()
  const t = useTranslations('machine')
  const tShared = useTranslations('shared')
  const locale = useLocale()
  const localeCode = locale === 'de' ? 'de-DE' : 'en-US'
  const dateLocale = locale === 'de' ? de : enUS
  const [machine, setMachine] = useState<Machine | null>(null)
  const [loading, setLoading] = useState(true)
  const [socket, setSocket] = useState<WebSocket | null>(null)
  const [showTerminal, setShowTerminal] = useState(false)
  const [pendingTerminalAuth, setPendingTerminalAuth] = useState(false)
  const [executing, setExecuting] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [commandLogDialog, setCommandLogDialog] = useState<{
    command: string
    commandId: string
  } | null>(null)
  const [rebooting, setRebooting] = useState(false)
  const [lastSeenBeforeReboot, setLastSeenBeforeReboot] = useState<string | null>(null)
  const rebootingRef = useRef(false)
  const executingRef = useRef<string | null>(null)
  const [pendingCriticalCommand, setPendingCriticalCommand] = useState<string | null>(null)
  const [securitySummary, setSecuritySummary] = useState<{
    openEvents: number
    highestSeverity: string | null
    securityUpdates: number
    vulnerabilities: { critical: number; high: number; medium: number; low: number; total: number }
  }>({ openEvents: 0, highestSeverity: null, securityUpdates: 0, vulnerabilities: { critical: 0, high: 0, medium: 0, low: 0, total: 0 } })
  const [notesDraft, setNotesDraft] = useState('')
  const [notesDirty, setNotesDirty] = useState(false)
  const [notesSaving, setNotesSaving] = useState(false)
  const [notesSavedAt, setNotesSavedAt] = useState<string | null>(null)
  const [linkForm, setLinkForm] = useState({
    title: '',
    url: '',
    description: ''
  })
  const [linkSaving, setLinkSaving] = useState(false)
  const [linkRemoving, setLinkRemoving] = useState<string | null>(null)
  const [docsExpanded, setDocsExpanded] = useState(false)
  const [analyticsRange, setAnalyticsRange] = useState<RangeKey>('7d')
  const [analyticsData, setAnalyticsData] = useState<HistoricalMetric[]>([])
  const [analyticsMeta, setAnalyticsMeta] = useState<AnalyticsMeta>({
    bucketSize: 1,
    rawCount: 0,
    rangeKey: '7d',
    rangeHours: 24 * 7
  })
  const [analyticsLoading, setAnalyticsLoading] = useState(false)
  const [analyticsError, setAnalyticsError] = useState<string | null>(null)
  const [selectedSeries, setSelectedSeries] = useState({
    cpu: true,
    ram: true,
    disk: true
  })
  const [showSmoothing, setShowSmoothing] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  
  // Sync ref with state
  useEffect(() => {
    rebootingRef.current = rebooting
  }, [rebooting])
  
  useEffect(() => {
    executingRef.current = executing
  }, [executing])

  useEffect(() => {
    if (!machine || notesDirty) return
    setNotesDraft(machine.notes || '')
  }, [machine, notesDirty])

  useEffect(() => {
    fetchMachine()

    // Connect to WebSocket with slight delay to avoid React strict mode double mount issues
    let newSocket: WebSocket | null = null
    let reconnectTimer: NodeJS.Timeout | null = null
    let isMounted = true
    
    const connectWebSocket = async () => {
      try {
        // Get JWT token for WebSocket authentication
        const tokenResponse = await fetch('/api/auth/get-ws-token')
        if (!tokenResponse.ok) {
          console.error('❌ Failed to get WebSocket token:', tokenResponse.status)
          return
        }
        const { token } = await tokenResponse.json()
        console.log('🔐 Got WebSocket token from /api/auth/get-ws-token')

        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        const wsHost = window.location.host
        // Pass token in query string for WebSocket authentication
        newSocket = new WebSocket(`${wsProtocol}//${wsHost}/ws/web?token=${encodeURIComponent(token)}`)
      } catch (error) {
        console.error('❌ Error connecting WebSocket:', error)
        return
      }

      const handleOpen = () => {
        if (!isMounted) return
        console.log('✅ Connected to WebSocket')
        
        // If we were waiting for a reboot, check machine status immediately
        if (isMounted && rebootingRef.current) {
          console.log('🔍 Checking machine status after WebSocket reconnect during reboot')
          fetch(`/api/machines/${params.id}`)
            .then(res => res.json())
            .then(data => {
              if (data.machine?.status === 'online') {
                console.log('✅ Machine is online - ending reboot state')
                setRebooting(false)
                setLastSeenBeforeReboot(null)
                setMachine(data.machine)
              }
            })
            .catch(err => console.error('Failed to check machine status:', err))
        }
      }
      newSocket.onopen = handleOpen

      const handleMessage = (event: MessageEvent) => {
        if (!isMounted) return
        try {
          const data = JSON.parse(event.data)
          
          if (data.type === 'machine_status_changed' && data.machineId === params.id) {
            console.log('📡 Status changed:', data.status, 'Rebooting:', rebootingRef.current)
            setMachine((prev) => prev ? { ...prev, status: data.status } : null)
            
            // If machine comes back online after reboot, end rebooting state
            if (data.status === 'online' && rebootingRef.current) {
              console.log('✅ Machine back online after reboot')
              setRebooting(false)
              setLastSeenBeforeReboot(null)
            }
            
            // If machine comes online after agent update, end executing state
            if (data.status === 'online' && executingRef.current && (executingRef.current.includes('install-agent.sh') || executingRef.current === 'Agent Update')) {
              console.log('✅ Agent reconnected after update - ending executing state')
              setExecuting(null)
            }
          }

          if (data.type === 'machine_heartbeat' && data.machineId === params.id) {
            setMachine((prev) => {
              if (!prev) return null
              const lastSeen = data.timestamp || new Date().toISOString()
              return {
                ...prev,
                status: 'online',
                lastSeen
              }
            })

            if (rebootingRef.current) {
              setRebooting(false)
              setLastSeenBeforeReboot(null)
            }
          }
          
          if (data.type === 'machine_metrics' && data.machineId === params.id) {
            // Check if this is first metrics after reboot - end rebooting state
            if (rebootingRef.current) {
              console.log('✅ Received metrics after reboot - machine is back')
              setRebooting(false)
              setLastSeenBeforeReboot(null)
            }
            
            setMachine((prev) => {
              if (!prev) return null
              return {
                ...prev,
                metrics: [
                  {
                    id: Date.now().toString(),
                    ...data.metrics,
                    timestamp: new Date().toISOString(),
                  },
                  ...prev.metrics,
                ].slice(0, 50),
              }
            })
          }
          
          if (data.type === 'command_completed') {
            setExecuting(null)
            fetchMachine()
          }
        } catch (error) {
          console.error('WebSocket message error:', error)
        }
      }
      newSocket.onmessage = handleMessage

      const handleError = (error: Event) => {
        if (!isMounted) return
        console.error('❌ WebSocket error:', error)
      }
      newSocket.onerror = handleError

      const handleClose = () => {
        if (!isMounted) return
        console.log('🔌 WebSocket closed')
      }
      newSocket.onclose = handleClose

      setSocket(newSocket)
    }

    // Connect after a small delay to handle React strict mode
    reconnectTimer = setTimeout(() => connectWebSocket(), 100)

    return () => {
      isMounted = false
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (newSocket) {
        newSocket.onopen = null
        newSocket.onmessage = null
        newSocket.onerror = null
        newSocket.onclose = null
        newSocket.close()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id])

  useEffect(() => {
    if (!machine?.id) return
    fetchAnalytics(analyticsRange)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machine?.id, analyticsRange])

  const fetchMachine = async () => {
    try {
      const [res, secRes] = await Promise.all([
        fetch(`/api/machines/${params.id}`),
        fetch(`/api/vms/${params.id}/security`).catch(() => null)
      ])
      
      // Check if unauthorized (expired cookie)
      if (res.status === 401) {
        window.location.href = '/login'
        return
      }
      
      if (!res.ok) {
        router.push('/')
        return
      }
      const data = await res.json()
      setMachine(data.machine)
      
      // Process security summary from parallel fetch
      if (secRes && secRes.ok) {
        try {
          const secData = await secRes.json()
          const openEvents = secData.openEvents || 0
          const events = secData.events || []
          const vulnerabilities = secData.vulnerabilities || []
          const severityOrder = ['info', 'low', 'medium', 'high', 'critical']
          let highestSeverity = 'info'
          for (const evt of events) {
            if (evt.status === 'open' || evt.status === 'ack') {
              if (severityOrder.indexOf(evt.severity) > severityOrder.indexOf(highestSeverity)) {
                highestSeverity = evt.severity
              }
            }
          }
          // Compute vulnerability breakdown
          const vulnCounts = { critical: 0, high: 0, medium: 0, low: 0, total: vulnerabilities.length }
          for (const v of vulnerabilities) {
            const sev = (v.cve?.severity || '').toLowerCase()
            if (sev === 'critical') vulnCounts.critical++
            else if (sev === 'high') vulnCounts.high++
            else if (sev === 'medium') vulnCounts.medium++
            else vulnCounts.low++
          }
          // Count security update packages from lastScan summary or ports
          const scanSummary = secData.lastScan?.summary
          let securityUpdates = 0
          if (scanSummary) {
            const parsed = typeof scanSummary === 'string' ? JSON.parse(scanSummary) : scanSummary
            securityUpdates = parsed?.securityUpdates ?? 0
          }
          setSecuritySummary({
            openEvents,
            highestSeverity: openEvents > 0 ? highestSeverity : null,
            securityUpdates,
            vulnerabilities: vulnCounts
          })
        } catch (secError) {
          console.error('Failed to parse security summary:', secError)
        }
      }
    } catch (error) {
      console.error('Failed to fetch machine:', error)
      router.push('/')
    } finally {
      setLoading(false)
    }
  }

  const fetchAnalytics = async (range: RangeKey = analyticsRange) => {
    if (!machine?.id) return

    setAnalyticsLoading(true)
    setAnalyticsError(null)
    try {
      const res = await fetch(`/api/machines/${machine.id}/analytics?range=${range}&maxPoints=900`)
      if (!res.ok) {
        throw new Error('Failed to fetch analytics')
      }
      const data = await res.json()
      const resolvedRange = (data.rangeKey || range) as RangeKey
      const fallbackHours = RANGE_TO_HOURS[resolvedRange] || RANGE_TO_HOURS['7d']
      setAnalyticsData(data.points || [])
      setAnalyticsMeta({
        bucketSize: data.bucketSize || 1,
        rawCount: data.rawCount || 0,
        rangeKey: resolvedRange,
        rangeHours: data.rangeHours || fallbackHours
      })
    } catch (error) {
      console.error('Failed to fetch analytics:', error)
      setAnalyticsError(t('analytics.error'))
    } finally {
      setAnalyticsLoading(false)
    }
  }

  // Prüft ob ein Befehl kritisch ist und führt ihn entsprechend aus
  const handleCommand = (command: string) => {
    if (isCriticalCommand(command)) {
      // Kritischer Befehl - zeige Passwort-Dialog
      setPendingCriticalCommand(command)
    } else {
      // Normaler Befehl - direkt ausführen
      executeCommand(command)
    }
  }

  const executeCommand = (command: string) => {
    if (!socket || !machine || socket.readyState !== WebSocket.OPEN) return
    
    const commandId = Math.random().toString(36).substring(7)
    setExecuting(command)
    
    // Check if this is a reboot/shutdown command
    const cmd = command.toLowerCase().trim()
    const isRebootCommand = cmd === 'reboot' || 
                           cmd === 'shutdown' || 
                           cmd.startsWith('reboot ') || 
                           cmd.startsWith('shutdown ') ||
                           cmd.includes('systemctl reboot') ||
                           cmd.includes('systemctl poweroff') ||
                           cmd.includes('init 6')
    
    if (isRebootCommand) {
      setRebooting(true)
      setLastSeenBeforeReboot(machine.lastSeen)
    }
    
    // Show log dialog
    setCommandLogDialog({ command, commandId })
    
    // Send command to agent
    socket.send(JSON.stringify({
      type: 'execute_command',
      machineId: machine.id,
      command,
      commandId,
    }))
  }

  const updateAgent = async () => {
    if (!machine || !socket || socket.readyState !== WebSocket.OPEN) return
    
    try {
      // Get server IP for the agent to download source code
      const res = await fetch('/api/server-info')
      const data = await res.json()
      const serverUrl = `http://${data.ip}:${data.port}`
      
      const commandId = Math.random().toString(36).substring(7)
      setExecuting('Agent Update')
      
      // Show log dialog
      setCommandLogDialog({ command: 'Agent Update (Build from Source)', commandId })
      
      // Send update_agent message via WebSocket
      // This triggers the agent's robust self-update mechanism which:
      // 1. Creates an external update script
      // 2. Runs it independently with setsid/nohup
      // 3. The script handles service stop/restart safely
      socket.send(JSON.stringify({
        type: 'update_agent',
        machineId: machine.id,
        commandId,
        serverUrl,
      }))
    } catch (error) {
      console.error('Failed to update agent:', error)
      alert(t('errors.agentUpdate'))
    }
  }

  const deleteMachine = async () => {
    if (!machine) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/machines/${machine.id}/delete`, {
        method: 'DELETE',
      })
      if (res.ok) {
        router.push('/')
      } else {
        alert(t('errors.deleteMachine'))
      }
    } catch (error) {
      console.error('Failed to delete machine:', error)
      alert(t('errors.deleteMachine'))
    } finally {
      setDeleting(false)
    }
  }

  const saveNotes = async () => {
    if (!machine || notesSaving) return

    try {
      setNotesSaving(true)
      const res = await fetch(`/api/machines/${machine.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ notes: notesDraft })
      })

      if (!res.ok) {
        throw new Error('Failed to save notes')
      }

      const data = await res.json()
      setMachine((prev) => prev ? { ...prev, notes: data.notes } : prev)
      setNotesDirty(false)
      setNotesSavedAt(new Date().toISOString())
    } catch (error) {
      console.error('Failed to save notes:', error)
      alert(t('errors.saveNotes'))
    } finally {
      setNotesSaving(false)
    }
  }

  const addLink = async (event: FormEvent) => {
    event.preventDefault()
    if (!machine || linkSaving) return

    if (!linkForm.title.trim() || !linkForm.url.trim()) {
      alert(t('errors.linkValidation'))
      return
    }

    try {
      setLinkSaving(true)
      const res = await fetch(`/api/machines/${machine.id}/links`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(linkForm)
      })

      if (!res.ok) {
        throw new Error('Failed to add link')
      }

      const data = await res.json()
      setMachine((prev) => prev ? { ...prev, links: [data.link, ...(prev.links || [])] } : prev)
      setLinkForm({ title: '', url: '', description: '' })
    } catch (error) {
      console.error('Failed to add link:', error)
      alert(t('errors.addLink'))
    } finally {
      setLinkSaving(false)
    }
  }

  const removeLink = async (linkId: string) => {
    if (!machine) return

    try {
      setLinkRemoving(linkId)
      const res = await fetch(`/api/machines/${machine.id}/links`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ linkId })
      })

      if (!res.ok) {
        throw new Error('Failed to delete link')
      }

      setMachine((prev) => prev ? {
        ...prev,
        links: prev.links?.filter((link) => link.id !== linkId) || []
      } : prev)
    } catch (error) {
      console.error('Failed to delete link:', error)
      alert(t('errors.deleteLink'))
    } finally {
      setLinkRemoving(null)
    }
  }

  if (loading) {
    return (
      <AppShell hideNav>
        <div className="flex items-center justify-center min-h-[50vh]">
          <div className="flex flex-col items-center gap-4">
            <div className="h-14 w-14 rounded-xl border border-cyan-500/50 bg-cyan-500/10 flex items-center justify-center shadow-[0_0_30px_rgba(0,243,255,0.35)]">
              <div className="h-10 w-10 rounded-full border border-cyan-400/60 animate-spin border-t-transparent" />
            </div>
            <p className="text-sm font-mono tracking-[0.24em] uppercase text-cyan-200/80">
              {t('loading.sync')}
            </p>
          </div>
        </div>
      </AppShell>
    )
  }

  if (!machine) {
    return null
  }

  const isOnline = machine.status === 'online'
  const latestMetric = machine.metrics?.[0]
  const lastSeenDate = new Date(machine.lastSeen)
  const lastSeenDisplay = Date.now() - lastSeenDate.getTime() <= 60_000
    ? t('status.live')
    : formatDistanceToNow(lastSeenDate, { addSuffix: true, locale: dateLocale })

  let osInfo: any = {}
  if (machine.osInfo) {
    try {
      osInfo = JSON.parse(machine.osInfo)
    } catch (_error) {
      osInfo = {}
    }
  }

  const sortedAnalytics = analyticsData
    .slice()
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
  const smoothingWindow = computeSMAWindow(analyticsMeta.rangeHours, sortedAnalytics.length)
  const smaCpu = calculateSMA(sortedAnalytics, 'cpuUsage', smoothingWindow)
  const smaRam = calculateSMA(sortedAnalytics, 'ramUsage', smoothingWindow)
  const smaDisk = calculateSMA(sortedAnalytics, 'diskUsage', smoothingWindow)
  const bollingerCpu = calculateBollinger(sortedAnalytics, 'cpuUsage', smoothingWindow)
  const bollingerRam = calculateBollinger(sortedAnalytics, 'ramUsage', smoothingWindow)
  const bollingerDisk = calculateBollinger(sortedAnalytics, 'diskUsage', smoothingWindow)
  const chartData = sortedAnalytics.map((point, index) => ({
    ...point,
    smaCpu: smaCpu[index],
    smaRam: smaRam[index],
    smaDisk: smaDisk[index],
    bbCpuUpper: bollingerCpu[index].upper,
    bbCpuLower: bollingerCpu[index].lower,
    bbRamUpper: bollingerRam[index].upper,
    bbRamLower: bollingerRam[index].lower,
    bbDiskUpper: bollingerDisk[index].upper,
    bbDiskLower: bollingerDisk[index].lower,
  }))
  const forecastDisk = forecastThreshold(sortedAnalytics, 'diskUsage', 100)
  const forecastCpu = forecastThreshold(sortedAnalytics, 'cpuUsage', 90)
  // Weighted regression (exponential decay) for CPU+RAM; log-transform for Disk
  const regressionCpu = calculateWeightedRegression(sortedAnalytics, 'cpuUsage')
  const regressionRam = calculateWeightedRegression(sortedAnalytics, 'ramUsage')
  const regressionDisk = calculateExpRegression(sortedAnalytics, 'diskUsage')
  // Windowed rate-of-change: mini-regression on last 10 % of points (more stable than 2-point diff)
  const rocCpu = calculateWindowedRoC(sortedAnalytics, 'cpuUsage')
  const rocRam = calculateWindowedRoC(sortedAnalytics, 'ramUsage')
  const rocDisk = calculateWindowedRoC(sortedAnalytics, 'diskUsage')
  // Human-readable trend direction
  const trendCpu = describeTrend(rocCpu)
  const trendRam = describeTrend(rocRam)
  const trendDisk = describeTrend(rocDisk)
  // Mean utilization
  const avgCpu = meanUsage(sortedAnalytics, 'cpuUsage')
  const avgRam = meanUsage(sortedAnalytics, 'ramUsage')
  const avgDisk = meanUsage(sortedAnalytics, 'diskUsage')
  // Data span for "insufficient data" warnings
  const spanHours = dataSpanHours(sortedAnalytics)
  const pctCpu = calculatePercentile(sortedAnalytics, 'cpuUsage', 0.95)
  const pctRam = calculatePercentile(sortedAnalytics, 'ramUsage', 0.95)
  const pctDisk = calculatePercentile(sortedAnalytics, 'diskUsage', 0.95)
  const leakPerDayRam = (regressionRam?.slopePerHour || 0) * 24
  const provisioning = {
    cpu: describeProvisioning(pctCpu, t),
    ram: describeProvisioning(pctRam, t),
    disk: describeProvisioning(pctDisk, t),
  }
  const horizonCapHours = 24 * 365 * 5
  const diskForecastFar = forecastDisk ? forecastDisk.hoursRemaining > horizonCapHours : false
  const cpuForecastFar = forecastCpu ? forecastCpu.hoursRemaining > horizonCapHours : false
  const healthScore = calculateHealthScore(pctCpu, pctRam, pctDisk)
  const healthTone: Tone = healthScore === null ? 'muted' : healthScore >= 80 ? 'warn' : healthScore >= 60 ? 'note' : 'ok'
  // R² confidence labels for forecast tiles
  const confCpu = regressionCpu ? confidenceLabel(regressionCpu.r2) : null
  const confRam = regressionRam ? confidenceLabel(regressionRam.r2) : null
  const confDisk = regressionDisk ? confidenceLabel(regressionDisk.r2) : null

  return (
    <AppShell hideNav onAddAgent={() => setShowAddModal(true)}>
      {/* Rebooting Overlay */}
      {rebooting && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40 flex items-center justify-center px-4">
          <div className="relative max-w-md w-full rounded-xl border border-slate-800 bg-[#0d141b] p-8 space-y-4 shadow-lg">
            <div className="relative flex flex-col items-center gap-4">
              <RefreshCw className="h-12 w-12 text-cyan-300 animate-spin" />
              <div className="text-center space-y-2">
                <h3 className="text-lg font-semibold text-white">{t('rebooting.title')}</h3>
                <p className="text-sm text-slate-300">
                  {t('rebooting.subtitle')}
                </p>
              </div>
              <div className="w-full h-2 rounded-full bg-slate-900 overflow-hidden">
                <div className="h-full bg-cyan-500/70 animate-[pulse_2s_ease-in-out_infinite]" />
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-8">
        {/* Header */}
        <header className={cn(
          "flex flex-col gap-6",
          rebooting && "opacity-50 pointer-events-none"
        )}>
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.push('/')}
                className="h-12 w-12 rounded-lg border border-slate-700 text-slate-200 hover:bg-slate-800 transition-all flex items-center justify-center"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div className="h-12 w-12 rounded-lg border border-cyan-400/30 bg-[#0f161d] flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor" className="h-6 w-6 text-cyan-200">
                  <path d="M440-183v-274L200-596v274l240 139Zm80 0 240-139v-274L520-457v274Zm-40-343 237-137-237-137-237 137 237 137ZM160-252q-19-11-29.5-29T120-321v-318q0-22 10.5-40t29.5-29l280-161q19-11 40-11t40 11l280 161q19 11 29.5 29t10.5 40v318q0 22-10.5 40T800-252L520-91q-19 11-40 11t-40-11L160-252Zm320-228Z"/>
                </svg>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-cyan-200/80 font-mono">{t('header.eyebrow')}</p>
                <h1 className="text-2xl font-semibold text-white">{machine.hostname}</h1>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Vulnerability Severity Badges */}
              {securitySummary.vulnerabilities.critical > 0 && (
                <a
                  href={`/security/${machine.id}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-rose-500 bg-rose-500/20 text-rose-200 text-xs font-semibold transition-colors hover:opacity-80"
                  title={t('header.securityLink')}
                >
                  <ShieldAlert className="h-3.5 w-3.5" />
                  <span>{securitySummary.vulnerabilities.critical} Critical</span>
                </a>
              )}
              {securitySummary.vulnerabilities.high > 0 && (
                <a
                  href={`/security/${machine.id}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-orange-500 bg-orange-500/20 text-orange-200 text-xs font-semibold transition-colors hover:opacity-80"
                  title={t('header.securityLink')}
                >
                  <ShieldAlert className="h-3.5 w-3.5" />
                  <span>{securitySummary.vulnerabilities.high} High</span>
                </a>
              )}
              {securitySummary.vulnerabilities.medium > 0 && (
                <a
                  href={`/security/${machine.id}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-amber-500 bg-amber-500/20 text-amber-200 text-xs font-semibold transition-colors hover:opacity-80"
                  title={t('header.securityLink')}
                >
                  <span>{securitySummary.vulnerabilities.medium} Medium</span>
                </a>
              )}
              {/* Security Events Badge */}
              {securitySummary.openEvents > 0 && (
                <a
                  href={`/security/${machine.id}`}
                  className={cn(
                    "inline-flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-semibold transition-colors hover:opacity-80",
                    securitySummary.highestSeverity === 'critical'
                      ? "border-rose-500 bg-rose-500/20 text-rose-200"
                      : securitySummary.highestSeverity === 'high'
                        ? "border-orange-500 bg-orange-500/20 text-orange-200"
                        : securitySummary.highestSeverity === 'medium'
                          ? "border-amber-500 bg-amber-500/20 text-amber-200"
                          : "border-yellow-500 bg-yellow-500/20 text-yellow-200"
                  )}
                  title={t('header.securityLink')}
                >
                  <ShieldAlert className="h-4 w-4" />
                  <span>{t('header.securityBadge', { count: securitySummary.openEvents })}</span>
                </a>
              )}
              {/* Security Updates Badge */}
              {securitySummary.securityUpdates > 0 && (
                <a
                  href={`/security/${machine.id}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-cyan-500/60 bg-cyan-500/10 text-cyan-200 text-xs font-semibold transition-colors hover:opacity-80"
                  title={t('header.securityLink')}
                >
                  <PackageCheck className="h-3.5 w-3.5" />
                  <span>{securitySummary.securityUpdates} Updates</span>
                </a>
              )}
              <span className={cn(
                "inline-flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-mono uppercase tracking-[0.18em]",
                isOnline
                  ? "border-emerald-400/40 text-emerald-100 bg-emerald-500/10"
                  : "border-amber-400/40 text-amber-100 bg-amber-500/10"
              )}>
                {isOnline ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <AlertCircle className="h-4 w-4" />
                )}
                {isOnline ? t('status.online') : t('status.offline')}
              </span>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-red-500/40 text-red-100 hover:bg-red-500/10 transition-colors"
                title={t('actions.delete.title')}
              >
                <Trash2 className="h-4 w-4" />
                <span>{t('actions.delete.label')}</span>
              </button>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className={cn(
          "space-y-8",
          rebooting && "opacity-50 pointer-events-none"
        )}>
          <div className="grid grid-cols-1 lg:grid-cols-3 xl:grid-cols-4 gap-6 xl:gap-8">
            {/* System Info */}
            <div className="lg:col-span-2 xl:col-span-3 relative rounded-xl border border-slate-800 bg-[#0d141b] p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor" className="h-5 w-5 text-cyan-300">
                  <path d="M440-183v-274L200-596v274l240 139Zm80 0 240-139v-274L520-457v274Zm-40-343 237-137-237-137-237 137 237 137ZM160-252q-19-11-29.5-29T120-321v-318q0-22 10.5-40t29.5-29l280-161q19-11 40-11t40 11l280 161q19 11 29.5 29t10.5 40v318q0 22-10.5 40T800-252L520-91q-19 11-40 11t-40-11L160-252Zm320-228Z"/>
                </svg>
                {t('system.title')}
              </h2>
              <div className={cn(
                "grid gap-6",
                machine.links?.length ? "grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px]" : "grid-cols-1"
              )}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                  {osInfo.distro && (
                    <InfoItem label={t('system.os')} value={`${osInfo.distro} ${osInfo.release}`} />
                  )}
                  {osInfo.kernel && (
                    <InfoItem label={t('system.kernel')} value={osInfo.kernel} />
                  )}
                  <InfoItem label={t('system.hostname')} value={machine.hostname} />
                  <InfoItem label={t('system.ip')} value={machine.ip} />
                </div>

                {machine.links?.length > 0 && (
                  <div>
                    <div className="space-y-2 max-h-[220px] overflow-auto pr-1">
                      {machine.links.map((link) => (
                        <a
                          key={link.id}
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-full rounded-lg border border-cyan-400/30 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-100 px-3 py-2 transition-colors flex items-center justify-between gap-3"
                          title={link.description || link.url}
                        >
                          <span className="text-sm font-medium truncate">{link.title}</span>
                          <ExternalLink className="h-4 w-4 shrink-0 text-cyan-200/80" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Status Info */}
            <div className="relative rounded-xl border border-slate-800 bg-[#0d141b] p-6 shadow-sm">
            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-white mb-2">{t('status.title')}</h2>
              <StatusRow label={t('status.lastSeen')} value={lastSeenDisplay} />
              <StatusRow label={t('status.added')} value={formatDistanceToNow(new Date(machine.createdAt), { addSuffix: true, locale: dateLocale })} />
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">{t('status.connection')}</span>
                <div className="flex items-center space-x-2">
                  <div className={cn(
                      "h-2.5 w-2.5 rounded-full",
                      isOnline ? "bg-emerald-400 animate-pulse" : "bg-slate-500"
                    )} />
                    <span className="text-sm font-medium text-white">
                      {isOnline ? t('status.connected') : t('status.disconnected')}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Metrics */}
            {latestMetric && (
              <div className="lg:col-span-2 xl:col-span-3 relative rounded-xl border border-slate-800 bg-[#0d141b] p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                  <Activity className="h-5 w-5 text-emerald-300" />
                  {t('metrics.title')}
                </h2>
                <div className="space-y-6">
                  <MetricBar
                    icon={<Cpu className="h-5 w-5 text-cyan-300" />}
                    label={t('metrics.cpu')}
                    value={latestMetric.cpuUsage}
                    color="from-cyan-400 to-cyan-600"
                  />
                  <MetricBar
                    icon={<MemoryStick className="h-5 w-5 text-purple-300" />}
                    label={t('metrics.ram')}
                    value={latestMetric.ramUsage}
                    color="from-purple-400 to-fuchsia-600"
                    subtitle={`${formatBytes(latestMetric.ramUsed * 1024 * 1024 * 1024)} / ${formatBytes(latestMetric.ramTotal * 1024 * 1024 * 1024)}`}
                  />
                  <MetricBar
                    icon={<HardDrive className="h-5 w-5 text-amber-300" />}
                    label={t('metrics.disk')}
                    value={latestMetric.diskUsage}
                    color="from-amber-400 to-orange-600"
                    subtitle={`${formatBytes(latestMetric.diskUsed * 1024 * 1024 * 1024)} / ${formatBytes(latestMetric.diskTotal * 1024 * 1024 * 1024)}`}
                  />
                  <div className="flex items-center justify-between pt-4 border-t border-slate-800">
                    <div className="flex items-center space-x-2 text-slate-300">
                      <Clock className="h-5 w-5 text-slate-400" />
                      <span className="text-sm">{t('metrics.uptime')}</span>
                    </div>
                    <span className="text-lg font-semibold text-white">
                      {formatUptime(latestMetric.uptime)}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Quick Actions */}
            <div className="relative rounded-xl border border-slate-800 bg-[#0d141b] p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <TerminalIcon className="h-5 w-5 text-cyan-300" />
                {t('actions.title')}
              </h2>
              <div className="space-y-3">
                <ActionButton
                  onClick={() => setPendingTerminalAuth(true)}
                  disabled={!isOnline || rebooting}
                  tone="primary"
                  icon={<TerminalIcon className="h-5 w-5" />}
                  label={t('actions.openTerminal')}
                />
                <ActionButton
                  onClick={() => handleCommand('apt update && apt upgrade -y')}
                  disabled={!isOnline || !!executing || rebooting}
                  tone="success"
                  icon={<Download className="h-5 w-5" />}
                  label={t('actions.systemUpdate')}
                />
                <ActionButton
                  onClick={updateAgent}
                  disabled={!isOnline || !!executing || rebooting}
                  tone="purple"
                  icon={<PackageCheck className="h-5 w-5" />}
                  label={t('actions.agentUpdate')}
                />
                <ActionButton
                  onClick={() => handleCommand('reboot')}
                  disabled={!isOnline || !!executing || rebooting}
                  tone="warning"
                  icon={<Power className="h-5 w-5" />}
                  label={t('actions.reboot')}
                />
                <ActionButton
                  onClick={fetchMachine}
                  disabled={rebooting}
                  tone="neutral"
                  icon={<RefreshCw className="h-5 w-5" />}
                  label={t('actions.refresh')}
                />
              </div>

              {executing && !rebooting && (
                <div className="mt-4 p-3 rounded-lg border border-amber-400/40 bg-amber-600/10 text-amber-100">
                  <div className="flex items-center space-x-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-amber-300"></div>
                    <span className="text-sm">{t('actions.executing', { command: executing })}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Historical Analytics */}
          <div className="relative rounded-xl border border-slate-800 bg-[#0d141b] shadow-sm overflow-hidden">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between border-b border-slate-800 p-6">
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-[0.22em] text-cyan-200/70 font-mono">{t('analytics.eyebrow')}</p>
                <div className="flex items-center gap-2">
                  <LineChartIcon className="h-5 w-5 text-cyan-300" />
                  <h2 className="text-lg font-semibold text-white">{t('analytics.title')}</h2>
                </div>
                <p className="text-sm text-slate-400">
                  {t('analytics.subtitle')}
                </p>
                <div className="flex flex-wrap gap-2 items-center">
                  <div className="inline-flex items-center gap-2 rounded-md bg-slate-900/80 px-3 py-1 text-xs text-slate-300 border border-slate-800">
                    <Sigma className="h-4 w-4 text-cyan-300" />
                    <span>{t('analytics.badge')}</span>
                  </div>
                  {healthScore !== null && (
                    <div className={cn(
                      "inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold border",
                      healthScore >= 80 ? 'bg-red-500/10 border-red-500/40 text-red-200' :
                      healthScore >= 60 ? 'bg-amber-500/10 border-amber-500/40 text-amber-200' :
                      'bg-emerald-500/10 border-emerald-500/40 text-emerald-200'
                    )}>
                      <Activity className="h-3.5 w-3.5" />
                      <span>{t('analytics.healthScore.badge', { score: healthScore })}</span>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 items-center justify-end whitespace-nowrap">
                {(['24h', '7d', '30d', '90d'] as RangeKey[]).map((range) => (
                  <button
                    key={range}
                    onClick={() => setAnalyticsRange(range)}
                    className={cn(
                      "px-3 py-2 rounded-lg text-sm border transition-colors font-medium",
                      analyticsRange === range
                        ? "bg-cyan-600 text-white border-cyan-400/60 shadow-[0_0_18px_rgba(6,182,212,0.35)]"
                        : "bg-slate-900 text-slate-300 border-slate-700 hover:border-cyan-400/40 hover:text-white"
                    )}
                  >
                    {range}
                  </button>
                ))}
                <button
                  onClick={() => fetchAnalytics()}
                  disabled={analyticsLoading}
                  className={cn(
                    "px-3 py-2 rounded-lg text-sm font-medium inline-flex items-center gap-2 transition-colors",
                    analyticsLoading
                      ? "bg-slate-900 text-slate-400 border border-slate-800 cursor-not-allowed"
                      : "bg-slate-800 text-slate-100 border border-slate-700 hover:border-cyan-400/50 hover:text-white"
                  )}
                >
                  {analyticsLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  <span>{analyticsLoading ? t('analytics.loading') : t('analytics.refresh')}</span>
                </button>
              </div>
            </div>

            <div className="p-6 space-y-6">
              {analyticsError && (
                <div className="p-3 rounded-lg border border-red-400/40 bg-red-500/10 text-red-100 text-sm">
                  {analyticsError}
                </div>
              )}

              {analyticsLoading ? (
                <div className="flex items-center justify-center py-12 text-slate-400 gap-2">
                  <div className="h-4 w-4 border-b-2 border-cyan-300 rounded-full animate-spin" />
                  <span className="text-sm">{t('analytics.processing')}</span>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                    <ForecastStat
                      title={t('analytics.tiles.disk.title')}
                      tone={forecastDisk && !diskForecastFar ? (forecastDisk.insufficientData ? 'note' : 'warn') : provisioning.disk.tone}
                      accent="disk"
                      icon={<TrendingUp className="h-4 w-4" />}
                      confidence={confDisk}
                      value={
                        forecastDisk && !diskForecastFar
                          ? t('analytics.tiles.disk.fullIn', { time: formatHours(forecastDisk.hoursRemaining) })
                          : t('analytics.tiles.disk.noLimit')
                      }
                      detail={
                        forecastDisk && !diskForecastFar
                          ? (forecastDisk.insufficientData
                            ? t('analytics.tiles.insufficientData')
                            : t('analytics.tiles.disk.eta', { time: formatDistanceToNow(forecastDisk.eta, { addSuffix: true, locale: dateLocale }) }))
                          : t('analytics.tiles.disk.trend', { trend: formatSlopePerDay(regressionDisk?.slopePerHour || 0, t) })
                      }
                    />
                    <ForecastStat
                      title={t('analytics.tiles.ramLeak.title')}
                      tone={leakPerDayRam > 0.2 ? 'warn' : leakPerDayRam > 0.05 ? 'note' : 'ok'}
                      accent="ram"
                      icon={<MemoryStick className="h-4 w-4" />}
                      confidence={confRam}
                      value={formatSlopePerDay(regressionRam?.slopePerHour || 0)}
                      detail={pctRam ? loadSummary(pctRam, t) : t('analytics.tiles.ramLeak.noData')}
                    />
                    <ForecastStat
                      title={t('analytics.tiles.cpu.title')}
                      tone={pctCpu && pctCpu > 90 ? 'warn' : 'ok'}
                      accent="cpu"
                      icon={<Cpu className="h-4 w-4" />}
                      confidence={confCpu}
                      value={
                        forecastCpu && !cpuForecastFar
                          ? t('analytics.tiles.cpu.ninetyIn', { time: formatHours(forecastCpu.hoursRemaining) })
                          : t('analytics.tiles.cpu.headroom')
                      }
                      detail={
                        forecastCpu && !cpuForecastFar
                          ? (forecastCpu.insufficientData
                            ? t('analytics.tiles.insufficientData')
                            : t('analytics.tiles.cpu.eta', { time: formatDistanceToNow(forecastCpu.eta, { addSuffix: true, locale: dateLocale }) }))
                          : pctCpu
                            ? loadSummary(pctCpu, t)
                            : t('analytics.tiles.cpu.stable')
                      }
                    />
                    <ForecastStat
                      title={t('analytics.tiles.dynamics.title')}
                      tone="info"
                      icon={<Activity className="h-4 w-4" />}
                      value={t('analytics.tiles.dynamics.cpuLine', {
                        arrow: t(`analytics.tiles.trend.${trendCpu}`),
                        avg: avgCpu?.toFixed(1) ?? '—',
                      })}
                      detail={[
                        t('analytics.tiles.dynamics.ramLine', {
                          arrow: t(`analytics.tiles.trend.${trendRam}`),
                          avg: avgRam?.toFixed(1) ?? '—',
                        }),
                        t('analytics.tiles.dynamics.diskLine', {
                          arrow: t(`analytics.tiles.trend.${trendDisk}`),
                          avg: avgDisk?.toFixed(1) ?? '—',
                        }),
                      ].join(' · ')}
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap gap-2 items-center">
                      <SeriesToggle
                        active={selectedSeries.cpu}
                        color="from-cyan-400 to-cyan-600"
                        label={t('analytics.series.cpu')}
                        onClick={() => setSelectedSeries((prev) => ({ ...prev, cpu: !prev.cpu }))}
                      />
                      <SeriesToggle
                        active={selectedSeries.ram}
                        color="from-purple-400 to-fuchsia-600"
                        label={t('analytics.series.ram')}
                        onClick={() => setSelectedSeries((prev) => ({ ...prev, ram: !prev.ram }))}
                      />
                      <SeriesToggle
                        active={selectedSeries.disk}
                        color="from-amber-400 to-orange-600"
                        label={t('analytics.series.disk')}
                        onClick={() => setSelectedSeries((prev) => ({ ...prev, disk: !prev.disk }))}
                      />
                    </div>
                    <div className="flex items-center gap-3 text-xs text-slate-400">
                      <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          className="form-checkbox rounded border-slate-700 bg-slate-900"
                          checked={showSmoothing}
                          onChange={(e) => setShowSmoothing(e.target.checked)}
                        />
                        <span>{t('analytics.smoothing', { window: smoothingWindow })}</span>
                      </label>
                      <span className="px-2 py-1 rounded bg-slate-900 border border-slate-800 text-slate-300">
                        {analyticsMeta.bucketSize > 1
                          ? t('analytics.downsample.compacted', { bucket: analyticsMeta.bucketSize, raw: analyticsMeta.rawCount })
                          : t('analytics.downsample.raw', { raw: analyticsMeta.rawCount })}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 w-full md:w-auto">
                      {t('analytics.smoothingHint')}
                    </p>
                  </div>

                  <div className="h-[360px] rounded-lg border border-slate-800 bg-[#0f161d] p-3">
                    {chartData.length > 1 ? (
                      <ResponsiveContainer width={undefined} height={undefined}>
                        <LineChart data={chartData} margin={{ left: 12, right: 12, top: 10, bottom: 10 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                          <XAxis
                            dataKey="timestamp"
                            stroke="#94a3b8"
                            tickFormatter={(value) => formatTickLabel(value, analyticsMeta.rangeHours, localeCode)}
                            minTickGap={24}
                          />
                          <YAxis stroke="#94a3b8" domain={[0, 110]} tickFormatter={(value) => `${value}%`} />
                          <Tooltip
                            contentStyle={{ backgroundColor: '#0b1223', borderColor: '#1f2937', borderWidth: 1 }}
                            labelFormatter={(value) => formatTimestampLabel(value, localeCode)}
                            formatter={(value: any, name) => {
                              if (value === null || value === undefined || Number.isNaN(Number(value))) {
                                return ['—', name]
                              }
                              return [`${Number(value).toFixed(2)}%`, name]
                            }}
                          />
                          <Legend />
                          <ReferenceLine y={100} stroke="#f87171" strokeDasharray="4 4" />
                          <ReferenceLine y={90} stroke="#fbbf24" strokeDasharray="4 4" />
                          {selectedSeries.cpu && (
                            <Line
                              type="monotone"
                              dataKey="cpuUsage"
                              stroke="#22d3ee"
                              strokeWidth={2}
                              dot={false}
                              name={t('analytics.series.cpu')}
                            />
                          )}
                          {selectedSeries.ram && (
                            <Line
                              type="monotone"
                              dataKey="ramUsage"
                              stroke="#a855f7"
                              strokeWidth={2}
                              dot={false}
                              name={t('analytics.series.ram')}
                            />
                          )}
                          {selectedSeries.disk && (
                            <Line
                              type="monotone"
                              dataKey="diskUsage"
                              stroke="#f59e0b"
                              strokeWidth={2}
                              dot={false}
                              name={t('analytics.series.disk')}
                            />
                          )}
                          {showSmoothing && selectedSeries.cpu && (
                            <Line
                              type="monotone"
                              dataKey="smaCpu"
                              stroke="#67e8f9"
                              strokeWidth={1.5}
                              strokeDasharray="5 5"
                              dot={false}
                              name={`${t('analytics.series.cpu')} SMA`}
                              isAnimationActive={false}
                            />
                          )}
                          {showSmoothing && selectedSeries.ram && (
                            <Line
                              type="monotone"
                              dataKey="smaRam"
                              stroke="#c084fc"
                              strokeWidth={1.5}
                              strokeDasharray="5 5"
                              dot={false}
                              name={`${t('analytics.series.ram')} SMA`}
                              isAnimationActive={false}
                            />
                          )}
                          {showSmoothing && selectedSeries.disk && (
                            <Line
                              type="monotone"
                              dataKey="smaDisk"
                              stroke="#fbbf24"
                              strokeWidth={1.5}
                              strokeDasharray="5 5"
                              dot={false}
                              name={`${t('analytics.series.disk')} SMA`}
                              isAnimationActive={false}
                            />
                          )}
                          {/* Bollinger bands (±2σ) — shown alongside SMA */}
                          {showSmoothing && selectedSeries.cpu && (
                            <>
                              <Line type="monotone" dataKey="bbCpuUpper" stroke="#22d3ee" strokeWidth={1} strokeOpacity={0.3} strokeDasharray="2 5" dot={false} legendType="none" isAnimationActive={false} />
                              <Line type="monotone" dataKey="bbCpuLower" stroke="#22d3ee" strokeWidth={1} strokeOpacity={0.3} strokeDasharray="2 5" dot={false} legendType="none" isAnimationActive={false} />
                            </>
                          )}
                          {showSmoothing && selectedSeries.ram && (
                            <>
                              <Line type="monotone" dataKey="bbRamUpper" stroke="#a855f7" strokeWidth={1} strokeOpacity={0.3} strokeDasharray="2 5" dot={false} legendType="none" isAnimationActive={false} />
                              <Line type="monotone" dataKey="bbRamLower" stroke="#a855f7" strokeWidth={1} strokeOpacity={0.3} strokeDasharray="2 5" dot={false} legendType="none" isAnimationActive={false} />
                            </>
                          )}
                          {showSmoothing && selectedSeries.disk && (
                            <>
                              <Line type="monotone" dataKey="bbDiskUpper" stroke="#f59e0b" strokeWidth={1} strokeOpacity={0.3} strokeDasharray="2 5" dot={false} legendType="none" isAnimationActive={false} />
                              <Line type="monotone" dataKey="bbDiskLower" stroke="#f59e0b" strokeWidth={1} strokeOpacity={0.3} strokeDasharray="2 5" dot={false} legendType="none" isAnimationActive={false} />
                            </>
                          )}
                          <Brush
                            dataKey="timestamp"
                            height={28}
                            travellerWidth={12}
                            stroke="#22d3ee"
                            tickFormatter={(value) => formatTickLabel(value, analyticsMeta.rangeHours, localeCode)}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex items-center justify-center h-full text-slate-500 text-sm">
                        {t('analytics.tooFew')}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <UtilizationTile
                      label={t('analytics.tiles.provision.cpu')}
                      status={provisioning.cpu.label}
                      tone={provisioning.cpu.tone}
                      detail={loadSummary(pctCpu, t)}
                    />
                    <UtilizationTile
                      label={t('analytics.tiles.provision.ram')}
                      status={provisioning.ram.label}
                      tone={provisioning.ram.tone}
                      detail={
                        pctRam
                          ? `${loadSummary(pctRam, t)}${leakPerDayRam > 0.1 ? ` | ${t('analytics.tiles.provision.leak')}` : ''}`
                          : tShared('noData')
                      }
                    />
                    <UtilizationTile
                      label={t('analytics.tiles.provision.disk')}
                      status={forecastDisk && !diskForecastFar ? t('analytics.tiles.disk.fillTrend') : provisioning.disk.label}
                      tone={forecastDisk && !diskForecastFar ? 'warn' : provisioning.disk.tone}
                      detail={
                        forecastDisk && !diskForecastFar
                          ? t('analytics.tiles.disk.fullAt', { time: formatDistanceToNow(forecastDisk.eta, { addSuffix: true, locale: dateLocale }) })
                          : pctDisk
                            ? `${loadSummary(pctDisk, t)} · ${t('analytics.tiles.disk.trendLabel', { trend: formatSlopePerDay(regressionDisk?.slopePerHour || 0, t) })}`
                            : tShared('noData')
                      }
                    />
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Documentation & Notes - Full Width Below */}
          <div className="relative rounded-xl border border-slate-800 bg-[#0d141b] shadow-sm overflow-hidden">
            <button
              type="button"
              onClick={() => setDocsExpanded((prev) => !prev)}
              className="w-full flex items-center justify-between p-6 text-left hover:bg-slate-800/30 transition-colors"
            >
              <div className="flex items-center gap-3">
                <BookOpen className="h-5 w-5 text-cyan-300" />
                <div>
                  <h2 className="text-lg font-semibold text-white">{t('notesPanel.title')}</h2>
                  <p className="text-sm text-slate-400 mt-1">
                    {t('notesPanel.summary', { notes: machine.notes ? 1 : 0, links: machine.links?.length || 0 })}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {notesDirty && (
                  <span className="text-xs px-2 py-1 rounded-full border bg-amber-900/30 text-amber-200 border-amber-700/50">
                    {t('notesPanel.unsaved')}
                  </span>
                )}
                <ChevronDown className={cn(
                  "h-5 w-5 text-slate-400 transition-transform",
                  docsExpanded && "rotate-180"
                )} />
              </div>
            </button>

            {docsExpanded && (
              <div className="border-t border-slate-800">
                {/* Notizen Section */}
                <div className="p-6 space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-semibold text-white uppercase tracking-wider">{t('notesPanel.notesTitle')}</h3>
                      {notesSavedAt && !notesDirty && (
                        <span className="text-xs text-slate-500">
                          {t('notes.saved', { time: formatDistanceToNow(new Date(notesSavedAt), { addSuffix: true, locale: dateLocale }) })}
                        </span>
                      )}
                    </div>
                    <textarea
                      value={notesDraft}
                      onChange={(e) => {
                        setNotesDraft(e.target.value)
                        setNotesDirty(true)
                      }}
                      rows={8}
                      className="w-full rounded-lg border border-slate-800 bg-[#0f161d] px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-400 resize-none"
                      placeholder={t('notesPanel.placeholder')}
                      disabled={notesSaving}
                    />
                    <div className="flex justify-end mt-3">
                      <button
                        onClick={saveNotes}
                        disabled={notesSaving || (!notesDirty && (machine.notes || '') === notesDraft)}
                        className={cn(
                          "inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
                          notesSaving || (!notesDirty && (machine.notes || '') === notesDraft)
                            ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                            : "bg-cyan-600 text-white hover:bg-cyan-500"
                        )}
                      >
                        <Save className="h-4 w-4" />
                        <span>{notesSaving ? t('notesPanel.saving') : t('notesPanel.save')}</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Links Section */}
                <div className="border-t border-slate-800 p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-white uppercase tracking-wider">{t('notesPanel.links.title')}</h3>
                    {machine.links?.length ? (
                      <span className="text-xs px-2 py-1 rounded bg-slate-800 text-slate-300 border border-slate-700">
                        {t('notesPanel.links.count', { count: machine.links.length })}
                      </span>
                    ) : null}
                  </div>

                  {/* Link Form */}
                  <form onSubmit={addLink} className="space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-[2fr_3fr_2fr_auto] gap-3">
                      <input
                        type="text"
                        value={linkForm.title}
                        onChange={(e) => setLinkForm((prev) => ({ ...prev, title: e.target.value }))}
                        className="w-full rounded-lg border border-slate-800 bg-[#0f161d] px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-400"
                        placeholder={t('notesPanel.links.titlePlaceholder')}
                        disabled={linkSaving}
                      />
                      <input
                        type="url"
                        value={linkForm.url}
                        onChange={(e) => setLinkForm((prev) => ({ ...prev, url: e.target.value }))}
                        className="w-full rounded-lg border border-slate-800 bg-[#0f161d] px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-400"
                        placeholder={t('notesPanel.links.urlPlaceholder')}
                        disabled={linkSaving}
                      />
                      <input
                        type="text"
                        value={linkForm.description}
                        onChange={(e) => setLinkForm((prev) => ({ ...prev, description: e.target.value }))}
                        className="w-full rounded-lg border border-slate-800 bg-[#0f161d] px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-400"
                        placeholder={t('notesPanel.links.descriptionPlaceholder')}
                        disabled={linkSaving}
                      />
                      <button
                        type="submit"
                        disabled={linkSaving}
                        className={cn(
                          "inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap",
                          linkSaving
                            ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                            : "bg-cyan-600 text-white hover:bg-cyan-500"
                        )}
                      >
                        {linkSaving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                        <span>{linkSaving ? t('notesPanel.links.saving') : t('notesPanel.links.add')}</span>
                      </button>
                    </div>
                  </form>

                  {/* Links List */}
                  <div className="space-y-2">
                    {(!machine.links || machine.links.length === 0) && (
                      <p className="text-sm text-slate-500 text-center py-4">
                        {t('notesPanel.links.empty')}
                      </p>
                    )}
                    {machine.links?.map((link) => (
                      <div
                        key={link.id}
                        className="flex items-center justify-between rounded-lg border border-slate-800 bg-[#0f161d] p-3 hover:border-cyan-400/40 transition-colors group"
                      >
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex-1 min-w-0"
                        >
                          <div className="flex items-center gap-2">
                            <ExternalLink className="h-4 w-4 text-cyan-300 flex-shrink-0" />
                            <span className="text-sm font-medium text-white group-hover:text-cyan-200 truncate">
                              {link.title}
                            </span>
                          </div>
                          {link.description && (
                            <p className="text-xs text-slate-400 mt-1 truncate">{link.description}</p>
                          )}
                        </a>
                        <button
                          onClick={() => removeLink(link.id)}
                          disabled={linkRemoving === link.id}
                          className="ml-3 text-slate-500 hover:text-red-400 p-1 rounded-md hover:bg-red-500/10 disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                          title={t('notesPanel.links.remove')}
                        >
                          {linkRemoving === link.id ? (
                            <RefreshCw className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Security Section Link */}
          {(() => {
            const hasAnyIssue = securitySummary.openEvents > 0 || securitySummary.vulnerabilities.total > 0 || securitySummary.securityUpdates > 0
            const isCritical = securitySummary.highestSeverity === 'critical' || securitySummary.highestSeverity === 'high' || securitySummary.vulnerabilities.critical > 0 || securitySummary.vulnerabilities.high > 0
            return (
              <Link
                href={`/security/${machine.id}`}
                className={cn(
                  "block relative rounded-xl border bg-[#0d141b] shadow-sm overflow-hidden hover:border-cyan-500/40 transition-colors group",
                  hasAnyIssue
                    ? isCritical
                      ? "border-rose-500/50 ring-1 ring-rose-500/20"
                      : "border-amber-500/50 ring-1 ring-amber-500/20"
                    : "border-slate-800"
                )}
              >
                <div className="flex items-center justify-between p-6">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "h-10 w-10 rounded-lg flex items-center justify-center",
                      hasAnyIssue
                        ? isCritical
                          ? "bg-rose-500/20 border border-rose-500/40"
                          : "bg-amber-500/20 border border-amber-500/40"
                        : "bg-emerald-500/20 border border-emerald-500/40"
                    )}>
                      <ShieldAlert className={cn(
                        "h-5 w-5",
                        hasAnyIssue
                          ? isCritical ? "text-rose-300" : "text-amber-300"
                          : "text-emerald-300"
                      )} />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-white group-hover:text-cyan-100 transition-colors">{t('security.title')}</h2>
                      <p className="text-sm text-slate-400 mt-1">
                        {hasAnyIssue
                          ? securitySummary.openEvents > 0
                            ? t('security.open', { count: securitySummary.openEvents, severity: t(`security.severity.${securitySummary.highestSeverity || 'info'}`) })
                            : t('security.vulnerabilitiesFound')
                          : t('security.safe')
                        }
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <ExternalLink className="h-5 w-5 text-slate-400 group-hover:text-cyan-400 transition-colors" />
                  </div>
                </div>
                {/* Detailed Security Badges */}
                {hasAnyIssue && (
                  <div className="flex flex-wrap items-center gap-2 px-6 pb-4">
                    {securitySummary.vulnerabilities.critical > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-rose-500 bg-rose-500/20 text-rose-200 text-[11px] font-semibold">
                        <ShieldAlert className="h-3 w-3" />
                        {securitySummary.vulnerabilities.critical} Critical
                      </span>
                    )}
                    {securitySummary.vulnerabilities.high > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-orange-500 bg-orange-500/20 text-orange-200 text-[11px] font-semibold">
                        <ShieldAlert className="h-3 w-3" />
                        {securitySummary.vulnerabilities.high} High
                      </span>
                    )}
                    {securitySummary.vulnerabilities.medium > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-amber-500 bg-amber-500/20 text-amber-200 text-[11px] font-semibold">
                        {securitySummary.vulnerabilities.medium} Medium
                      </span>
                    )}
                    {securitySummary.openEvents > 0 && (
                      <span className={cn(
                        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold",
                        securitySummary.highestSeverity === 'critical'
                          ? "border-rose-500 bg-rose-500/20 text-rose-200"
                          : securitySummary.highestSeverity === 'high'
                            ? "border-orange-500 bg-orange-500/20 text-orange-200"
                            : "border-amber-500 bg-amber-500/20 text-amber-200"
                      )}>
                        <ShieldAlert className="h-3 w-3" />
                        {securitySummary.openEvents} Events
                      </span>
                    )}
                    {securitySummary.securityUpdates > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-cyan-500/60 bg-cyan-500/10 text-cyan-200 text-[11px] font-semibold">
                        <PackageCheck className="h-3 w-3" />
                        {securitySummary.securityUpdates} Updates
                      </span>
                    )}
                  </div>
                )}
              </Link>
            )
          })()}
        </main>

        {/* Terminal Modal */}
        {showTerminal && (
          <Terminal
            machineId={machine.id}
            socket={socket}
            onClose={() => setShowTerminal(false)}
          />
        )}

        {/* Delete Confirmation Modal */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="relative max-w-md w-full rounded-xl border border-slate-800 bg-[#0d141b] shadow-lg p-6">
              <div className="flex items-start space-x-4">
                <div className="flex-shrink-0">
                  <div className="bg-red-500/15 border border-red-400/40 rounded-full p-3">
                    <Trash2 className="h-6 w-6 text-red-200" />
                  </div>
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-white mb-2">
                    {t('deleteModal.title')}
                  </h3>
                  <p className="text-sm text-slate-300 mb-4">
                    {t('deleteModal.description', { hostname: machine.hostname })}
                  </p>
                  <div className="flex space-x-3">
                    <button
                      onClick={() => setShowDeleteConfirm(false)}
                      disabled={deleting}
                      className="flex-1 px-4 py-2 rounded-lg border border-white/20 text-slate-200 hover:bg-white/5 transition-colors disabled:opacity-60"
                    >
                      {t('deleteModal.cancel')}
                    </button>
                    <button
                      onClick={() => {
                        setShowDeleteConfirm(false)
                        deleteMachine()
                      }}
                      disabled={deleting}
                      className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-60 flex items-center justify-center space-x-2 shadow-[0_0_20px_rgba(255,0,85,0.25)]"
                    >
                      {deleting ? (
                        <>
                          <RefreshCw className="h-4 w-4 animate-spin" />
                          <span>{t('deleteModal.deleting')}</span>
                        </>
                      ) : (
                        <>
                          <Trash2 className="h-4 w-4" />
                          <span>{t('deleteModal.confirm')}</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Command Log Dialog */}
        {commandLogDialog && (
          <CommandLogDialog
            command={commandLogDialog.command}
            commandId={commandLogDialog.commandId}
            machineId={machine.id}
            socket={socket}
            onClose={() => {
              setCommandLogDialog(null)
              setExecuting(null)
            }}
          />
        )}

        {/* Critical Command Password Dialog */}
        {pendingCriticalCommand && (
          <CriticalCommandDialog
            command={pendingCriticalCommand}
            onConfirm={() => {
              const cmd = pendingCriticalCommand
              setPendingCriticalCommand(null)
              executeCommand(cmd)
            }}
            onCancel={() => setPendingCriticalCommand(null)}
          />
        )}
      </div>

      {/* Add Agent Modal */}
      {showAddModal && (
        <AddAgentModal onClose={() => setShowAddModal(false)} />
      )}

      {/* Terminal Authentication Dialog */}
      {pendingTerminalAuth && (
        <TerminalAuthDialog
          machineName={machine.hostname}
          onConfirm={() => {
            setPendingTerminalAuth(false)
            setShowTerminal(true)
          }}
          onCancel={() => setPendingTerminalAuth(false)}
        />
      )}
    </AppShell>
  )
}

type Tone = 'ok' | 'warn' | 'info' | 'note' | 'muted'

function ForecastStat({
  title,
  value,
  detail,
  tone,
  icon,
  accent = 'neutral',
  confidence,
}: {
  title: string
  value: string
  detail: string
  tone: Tone
  icon: ReactNode
  accent?: 'cpu' | 'ram' | 'disk' | 'neutral'
  confidence?: ConfidenceLabel | null
}) {
  const accentClasses: Record<typeof accent, string> = {
    cpu: 'border-cyan-400/60 bg-cyan-500/5 text-cyan-50',
    ram: 'border-purple-400/60 bg-purple-500/5 text-purple-50',
    disk: 'border-amber-400/60 bg-amber-500/5 text-amber-50',
    neutral: 'border-slate-700 bg-slate-900/70 text-slate-100',
  }

  const toneClasses: Record<Tone, string> = {
    ok: '',
    warn: 'ring-1 ring-amber-400/70 shadow-[0_0_14px_rgba(251,191,36,0.25)]',
    info: 'ring-1 ring-cyan-400/50',
    note: 'ring-1 ring-blue-400/50',
    muted: '',
  }

  const confColor: Record<ConfidenceLabel, string> = {
    high: 'bg-emerald-500',
    medium: 'bg-amber-400',
    low: 'bg-slate-600',
  }
  const confWidth: Record<ConfidenceLabel, string> = {
    high: 'w-full',
    medium: 'w-1/2',
    low: 'w-1/4',
  }

  return (
    <div className={cn("rounded-lg border p-4 transition-colors", accentClasses[accent], toneClasses[tone])}>
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg border border-white/10 bg-black/10 flex items-center justify-center">
          {icon}
        </div>
        <div className="space-y-1 flex-1 min-w-0">
          <p className="text-xs uppercase tracking-[0.18em] text-white/70 font-mono">{title}</p>
          <p className="text-base font-semibold text-white leading-snug break-words">{value}</p>
          <p className="text-sm text-white/70 leading-snug">{detail}</p>
        </div>
      </div>
      {confidence && (
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-mono text-white/40 uppercase tracking-widest">R²</span>
            <span className={cn(
              "text-[10px] font-mono uppercase tracking-wider",
              confidence === 'high' ? 'text-emerald-400' : confidence === 'medium' ? 'text-amber-400' : 'text-slate-500'
            )}>{confidence}</span>
          </div>
          <div className="w-full h-1 rounded-full bg-white/10 overflow-hidden">
            <div className={cn("h-full rounded-full transition-all duration-500", confColor[confidence], confWidth[confidence])} />
          </div>
        </div>
      )}
    </div>
  )
}

function SeriesToggle({
  active,
  label,
  color,
  onClick,
}: {
  active: boolean
  label: string
  color: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition-all",
        active
          ? "border-cyan-500/50 bg-cyan-500/10 text-white shadow-[0_0_14px_rgba(34,211,238,0.25)]"
          : "border-slate-700 bg-slate-900 text-slate-300 hover:border-cyan-400/40 hover:text-white"
      )}
    >
      <span className={cn("h-2.5 w-2.5 rounded-full bg-gradient-to-r", color)} />
      <span>{label}</span>
    </button>
  )
}

function UtilizationTile({
  label,
  status,
  detail,
  tone,
}: {
  label: string
  status: string
  detail: string
  tone: Tone
}) {
  const toneClasses: Record<Tone, string> = {
    ok: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-100',
    warn: 'border-amber-500/30 bg-amber-500/10 text-amber-100',
    info: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-100',
    note: 'border-blue-500/30 bg-blue-500/10 text-blue-100',
    muted: 'border-slate-700 bg-slate-900/70 text-slate-200',
  }

  return (
    <div className={cn("p-4 rounded-lg border", toneClasses[tone])}>
      <p className="text-xs uppercase tracking-[0.18em] font-mono text-white/80">{label}</p>
      <p className="text-lg font-semibold text-white mt-1">{status}</p>
      <p className="text-sm text-white/70 mt-1">{detail}</p>
    </div>
  )
}

// RegressionResult, ForecastResult, UsageKey are imported from @/lib/analytics

function formatSlopePerDay(slopePerHour: number, t: any = null) {
  const perDay = slopePerHour * 24
  if (Number.isNaN(perDay)) return '-'
  if (Math.abs(perDay) < 0.01) return t ? t('analytics.trend.flat') : 'flach'
  return `${perDay > 0 ? '+' : ''}${perDay.toFixed(2)}%/Tag`
}

function describeProvisioning(percentile: number | null, t: any = null): { label: string; tone: Tone } {
  if (percentile === null || Number.isNaN(percentile)) {
    return { label: t ? t('analytics.statuses.noData') : 'Keine Daten', tone: 'muted' }
  }
  if (percentile >= 90) return { label: t ? t('analytics.statuses.underprovisioned') : 'Unterversorgt', tone: 'warn' }
  if (percentile <= 10) return { label: t ? t('analytics.statuses.overprovisioned') : 'Überversorgt', tone: 'info' }
  return { label: t ? t('analytics.statuses.balanced') : 'Ausbalanciert', tone: 'ok' }
}

function loadSummary(percentile: number | null, t: any = null) {
  if (percentile === null || Number.isNaN(percentile)) return t ? t('shared.noData') : 'Keine Daten'
  const headroom = Math.max(0, 100 - percentile)
  if (percentile >= 90) {
    return t ? t('analytics.load.high', { peak: percentile.toFixed(1), headroom: headroom.toFixed(1) }) : `Spitzen ~${percentile.toFixed(1)}% — Reserve ~${headroom.toFixed(1)}% (knapp)`
  }
  if (percentile <= 10) {
    return t ? t('analytics.load.low', { peak: percentile.toFixed(1), unused: headroom.toFixed(1) }) : `Spitzen ~${percentile.toFixed(1)}% — ungenutzt ~${headroom.toFixed(1)}%`
  }
  return t ? t('analytics.load.balanced', { peak: percentile.toFixed(1), headroom: headroom.toFixed(1) }) : `Spitzen ~${percentile.toFixed(1)}% — Reserve ~${headroom.toFixed(1)}%`
}

function formatTickLabel(value: string | number, rangeHours: number, localeCode: string = 'de-DE') {
  const date = new Date(value)
  if (rangeHours <= 30) {
    return date.toLocaleTimeString(localeCode, { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString(localeCode, { month: 'short', day: 'numeric' })
}

function formatTimestampLabel(value: string | number, localeCode: string = 'de-DE') {
  const date = new Date(value)
  return `${date.toLocaleDateString(localeCode, { month: 'short', day: 'numeric' })} ${date.toLocaleTimeString(localeCode, { hour: '2-digit', minute: '2-digit' })}`
}

function formatHours(hours: number, t: any = null) {
  if (!isFinite(hours)) return '-'
  const days = hours / 24
  const years = days / 365
  if (years >= 10) return t ? t('analytics.time.decadeOrMore') : '>10 Jahre'
  if (years >= 1) return t ? t('analytics.time.years', { value: years.toFixed(1) }) : `${years.toFixed(1)} Jahre`
  if (days >= 2) return t ? t('analytics.time.days', { value: days.toFixed(1) }) : `${days.toFixed(1)} Tage`
  if (hours >= 1) return t ? t('analytics.time.hours', { value: hours.toFixed(1) }) : `${hours.toFixed(1)} Std`
  return t ? t('analytics.time.minutes', { value: Math.round(hours * 60) }) : `${Math.round(hours * 60)} Min`
}

function MetricBar({
  icon,
  label,
  value,
  color,
  subtitle,
}: {
  icon: ReactNode
  label: string
  value: number
  color: string
  subtitle?: string
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2 text-slate-300">
          {icon}
          <span className="text-sm font-medium">{label}</span>
        </div>
        <span className="text-lg font-semibold text-white">{value.toFixed(1)}%</span>
      </div>
      <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-500 bg-gradient-to-r", color)}
          style={{ width: `${Math.min(value, 100)}%` }}
        />
      </div>
      {subtitle && (
        <p className="text-xs text-slate-400 mt-1">{subtitle}</p>
      )}
    </div>
  )
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-[0.18em] text-slate-400 font-mono">{label}</p>
      <p className="text-sm font-semibold text-white break-all">{value}</p>
    </div>
  )
}

type ActionTone = 'primary' | 'success' | 'purple' | 'warning' | 'neutral'

function ActionButton({
  onClick,
  disabled,
  icon,
  label,
  tone = 'primary',
}: {
  onClick: () => void
  disabled?: boolean
  icon: ReactNode
  label: string
  tone?: ActionTone
}) {
  const toneMap: Record<ActionTone, string> = {
    primary: 'bg-cyan-600 text-white hover:bg-cyan-500 border border-cyan-500/50',
    success: 'bg-emerald-600 text-white hover:bg-emerald-500 border border-emerald-500/50',
    purple: 'bg-purple-600 text-white hover:bg-purple-500 border border-purple-500/50',
    warning: 'bg-amber-600 text-white hover:bg-amber-500 border border-amber-500/50',
    neutral: 'bg-slate-800 text-slate-100 hover:bg-slate-700 border border-slate-700',
  }

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "relative w-full flex items-center space-x-3 px-4 py-3 rounded-lg font-medium transition-all",
        disabled
          ? "opacity-50 cursor-not-allowed"
          : "",
        toneMap[tone]
      )}
    >
      <div className="flex items-center gap-3">
        {icon}
        <span>{label}</span>
      </div>
    </button>
  )
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-slate-400">{label}</span>
      <span className="text-sm font-medium text-white">{value}</span>
    </div>
  )
}
