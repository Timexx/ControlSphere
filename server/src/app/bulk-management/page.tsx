'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Layers, Loader2, Play, X, CheckSquare, StopCircle, Trash2, Activity, RefreshCw } from 'lucide-react'
import { useTranslations, useLocale } from 'next-intl'
import AddAgentModal from '@/components/AddAgentModal'
import AppShell, { BackgroundLayers } from '@/components/AppShell'
import StatusBadge from '@/components/StatusBadge'
import CriticalCommandDialog, { isCriticalCommand } from '@/components/CriticalCommandDialog'
import BulkPageAuthDialog from '@/components/BulkPageAuthDialog'
import { cn } from '@/lib/utils'

interface Machine {
  id: string
  hostname: string
  ip: string
  status: string
}

interface JobStrategy {
  concurrency?: number
  batchSize?: number
  waitSeconds?: number
  stopOnFailurePercent?: number
}

interface JobSummary {
  id: string
  name: string
  description?: string | null
  command: string
  mode: 'parallel' | 'rolling'
  status: string
  targetType: string
  groupId?: string | null
  totalTargets: number
  strategy?: JobStrategy | null
  targetQuery?: unknown
  createdAt: string
  startedAt?: string | null
  completedAt?: string | null
}

interface JobExecution {
  id: string
  jobId: string
  machineId: string
  status: string
  exitCode?: number | null
  output?: string | null
  error?: string | null
  machine?: {
    id: string
    hostname: string
    ip: string
    status: string
  }
}

type BulkFormState = {
  command: string
  mode: 'parallel' | 'rolling'
  concurrency: number
  batchSize: number
  waitSeconds: number
  stopOnFailurePercent: number
}

const DEFAULT_BULK_FORM: BulkFormState = {
  command: 'uptime',
  mode: 'parallel',
  concurrency: 20,
  batchSize: 2,
  waitSeconds: 60,
  stopOnFailurePercent: 50
}

export default function BulkManagementPage() {
  const t = useTranslations('bulkManagement')
  const locale = useLocale()
  const [authenticated, setAuthenticated] = useState(false)
  const [machines, setMachines] = useState<Machine[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkSubmitting, setBulkSubmitting] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)
  const [bulkDryRun, setBulkDryRun] = useState<{
    total: number
    offline: number
    targets: Machine[]
  } | null>(null)
  const [bulkForm, setBulkForm] = useState<BulkFormState>({ ...DEFAULT_BULK_FORM })
  const [editingJob, setEditingJob] = useState<{ job: JobSummary; machineIds: string[] } | null>(null)
  const [prefillingJob, setPrefillingJob] = useState(false)

  const [jobs, setJobs] = useState<JobSummary[]>([])
  const [loadingJobs, setLoadingJobs] = useState(false)
  const [activeJob, setActiveJob] = useState<JobSummary | null>(null)
  const [activeJobExecutions, setActiveJobExecutions] = useState<JobExecution[]>([])
  const activeJobExecutionsRef = useRef<JobExecution[]>([])
  const [liveLogs, setLiveLogs] = useState<Record<string, string>>({})
  const activeJobIdRef = useRef<string | null>(null)
  const liveLogsRef = useRef<Record<string, string>>({})
  const [jobLoadingDetail, setJobLoadingDetail] = useState(false)
  const [pendingCriticalJob, setPendingCriticalJob] = useState(false)

  const prefillFormFromJob = useCallback((job: JobSummary) => {
    const strategy = job.strategy || {}
    setBulkForm({
      command: job.command || DEFAULT_BULK_FORM.command,
      mode: job.mode === 'rolling' ? 'rolling' : 'parallel',
      concurrency:
        typeof strategy.concurrency === 'number'
          ? strategy.concurrency
          : DEFAULT_BULK_FORM.concurrency,
      batchSize:
        typeof strategy.batchSize === 'number'
          ? strategy.batchSize
          : DEFAULT_BULK_FORM.batchSize,
      waitSeconds:
        typeof strategy.waitSeconds === 'number'
          ? strategy.waitSeconds
          : DEFAULT_BULK_FORM.waitSeconds,
      stopOnFailurePercent:
        typeof strategy.stopOnFailurePercent === 'number'
          ? strategy.stopOnFailurePercent
          : DEFAULT_BULK_FORM.stopOnFailurePercent
    })
  }, [])

  const handleCloseDialog = useCallback(() => {
    setBulkDialogOpen(false)
    setBulkDryRun(null)
    setEditingJob(null)
    setPrefillingJob(false)
  }, [])

  const mergeExecutionLogs = useCallback(
    (
      execs: JobExecution[],
      options?: { reset?: boolean; forceDb?: boolean }
    ) => {
      const { reset = false, forceDb = false } = options || {}
      setLiveLogs((prev) => {
        const base = reset ? {} : { ...prev }

        execs.forEach((exec) => {
          if (!exec.machineId) return

          const dbOutput = exec.output ?? ''
          const hasExisting = Object.prototype.hasOwnProperty.call(base, exec.machineId)
          const existing = base[exec.machineId] ?? ''

          if (forceDb) {
            base[exec.machineId] = dbOutput
            return
          }

          // Preserve richer live logs; only overwrite if DB has more data or entry is missing
          if (!reset && hasExisting) {
            if (dbOutput && dbOutput.length > existing.length) {
              base[exec.machineId] = dbOutput
            }
            return
          }

          base[exec.machineId] = dbOutput
        })

        liveLogsRef.current = base
        return base
      })
    },
    []
  )

  const machineLabelLookup = useMemo(() => {
    const map = new Map<string, string>()
    machines.forEach((m) => map.set(m.id, m.hostname))
    activeJobExecutions.forEach((exec) => {
      if (exec.machine?.hostname) {
        map.set(exec.machineId, exec.machine.hostname)
      }
    })
    return map
  }, [machines, activeJobExecutions])

  const toggleSelection = useCallback((machineId: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(machineId)) {
        next.delete(machineId)
      } else {
        next.add(machineId)
      }
      return next
    })
  }, [])

  const clearSelection = useCallback(() => {
    setSelected(new Set())
    setBulkDryRun(null)
  }, [])

  const selectAll = useCallback(() => {
    setSelected(new Set(machines.map((m) => m.id)))
  }, [machines])

  const openNewBulkDialog = useCallback(() => {
    setEditingJob(null)
    setPrefillingJob(false)
    setBulkDryRun(null)
    setBulkDialogOpen(true)
  }, [])

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

  const fetchJobs = useCallback(async () => {
    try {
      setLoadingJobs(true)
      const res = await fetch('/api/jobs')
      const data = await res.json()
      setJobs(data.jobs || [])
    } catch (error) {
      console.error('Failed to fetch jobs:', error)
    } finally {
      setLoadingJobs(false)
    }
  }, [])

  const loadJobDetail = useCallback(async (jobId: string, isLiveUpdate = false) => {
    setJobLoadingDetail(true)
    try {
      const res = await fetch(`/api/jobs/${jobId}`)
      if (!res.ok) throw new Error('Failed to load job')
      const data = await res.json()
      setActiveJob(data.job)
      activeJobIdRef.current = data.job?.id || null
      const execs: JobExecution[] = data.job?.executions || []
      setActiveJobExecutions(execs)
      activeJobExecutionsRef.current = execs

      // For completed jobs we prefer the DB snapshot to avoid stale/partial live logs.
      // For running jobs we merge, but never downgrade live output.
      const jobStatus = data.job?.status
      const shouldResetLogs =
        !isLiveUpdate || !liveLogsRef.current || Object.keys(liveLogsRef.current).length === 0
      const isJobRunning = jobStatus === 'RUNNING' || jobStatus === 'PENDING'
      mergeExecutionLogs(execs, {
        reset: shouldResetLogs,
        forceDb: !isJobRunning
      })
    } catch (error) {
      console.error('Failed to load job detail:', error)
    } finally {
      setJobLoadingDetail(false)
    }
  }, [mergeExecutionLogs])

  const openJobDetail = useCallback((job: JobSummary) => {
    setActiveJob(job)
    activeJobIdRef.current = job.id
    setLiveLogs({})
    liveLogsRef.current = {}
    loadJobDetail(job.id)
  }, [loadJobDetail])

  const buildTargetPayload = useCallback(() => {
    if (!editingJob || editingJob.job.targetType === 'adhoc') {
      return {
        targetType: 'adhoc',
        machineIds: Array.from(selected)
      }
    }

    if (editingJob.job.targetType === 'group') {
      return {
        targetType: 'group',
        groupId: editingJob.job.groupId
      }
    }

    if (editingJob.job.targetType === 'dynamic') {
      return {
        targetType: 'dynamic',
        dynamicQuery: editingJob.job.targetQuery
      }
    }

    return {
      targetType: 'adhoc',
      machineIds: Array.from(selected)
    }
  }, [editingJob, selected])

  const handleOpenJobEditor = useCallback(async (job: JobSummary) => {
    setBulkDialogOpen(true)
    setBulkDryRun(null)
    setPrefillingJob(true)
    setEditingJob({ job, machineIds: [] })
    setSelected(new Set())
    prefillFormFromJob(job)

    try {
      const res = await fetch(`/api/jobs/${job.id}`)
      if (!res.ok) {
        throw new Error(t('errors.jobLoadFailed'))
      }
      const data = await res.json()
      const jobDetail = data.job as JobSummary & { executions?: JobExecution[] }
      const machineIds = Array.from(
        new Set(
          (jobDetail?.executions || [])
            .map((exec) => exec.machineId)
            .filter((id): id is string => Boolean(id))
        )
      )
      setSelected(new Set(machineIds))
      prefillFormFromJob(jobDetail || job)
      setEditingJob({
        job: jobDetail || job,
        machineIds
      })
    } catch (error) {
      console.error('Job edit prefill failed:', error)
      alert(t('errors.jobLoadFailedRetry'))
      handleCloseDialog()
    } finally {
      setPrefillingJob(false)
    }
  }, [handleCloseDialog, prefillFormFromJob, t])

  const handleDryRun = useCallback(async () => {
    const targetPayload = buildTargetPayload()
    if (targetPayload.targetType === 'adhoc' && Array.from(selected).length === 0) return
    setBulkSubmitting(true)
    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: bulkForm.command,
          mode: bulkForm.mode,
          ...targetPayload,
          strategy: {
            concurrency: bulkForm.concurrency,
            batchSize: bulkForm.batchSize,
            waitSeconds: bulkForm.waitSeconds,
            stopOnFailurePercent: bulkForm.stopOnFailurePercent
          },
          dryRun: true
        })
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Dry run failed')
      }
      setBulkDryRun(data)
    } catch (error) {
      console.error('Dry run failed:', error)
    } finally {
      setBulkSubmitting(false)
    }
  }, [buildTargetPayload, bulkForm, selected])

  // Wrapper für Job-Ausführung mit kritischer Befehlsprüfung
  const handleRunJobWithCheck = useCallback(() => {
    if (isCriticalCommand(bulkForm.command)) {
      setPendingCriticalJob(true)
    } else {
      // Inline version of handleRunJob to avoid circular dependency
      const runJob = async () => {
        const targetPayload = buildTargetPayload()
        const machineCount = Array.isArray((targetPayload as { machineIds?: string[] }).machineIds)
          ? ((targetPayload as { machineIds?: string[] }).machineIds?.length || 0)
          : 0
        if (targetPayload.targetType === 'adhoc' && machineCount === 0) return

        setBulkSubmitting(true)
        setBulkError(null) // Reset error when starting
        try {
          const res = await fetch('/api/jobs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              command: bulkForm.command,
              mode: bulkForm.mode,
              ...targetPayload,
              strategy: {
                concurrency: bulkForm.concurrency,
                batchSize: bulkForm.batchSize,
                waitSeconds: bulkForm.waitSeconds,
                stopOnFailurePercent: bulkForm.stopOnFailurePercent
              }
            })
          })
          const data = await res.json()
          if (!res.ok) {
            throw new Error(data.error || 'Job creation failed')
          }
          setBulkDryRun(null)
          clearSelection()
          setEditingJob(null)
          await fetchJobs()
          if (data.id) {
            loadJobDetail(data.id)
          }
        } catch (error) {
          console.error('Job creation failed:', error)
          setBulkError(error instanceof Error ? error.message : 'Unknown error')
        } finally {
          setBulkSubmitting(false)
        }
      }
      runJob()
    }
  }, [bulkForm.command, bulkForm.mode, bulkForm.concurrency, bulkForm.batchSize, bulkForm.waitSeconds, bulkForm.stopOnFailurePercent, buildTargetPayload, clearSelection, fetchJobs, loadJobDetail])

  const handleRunJob = useCallback(async () => {
    const targetPayload = buildTargetPayload()
    const machineCount = Array.isArray((targetPayload as { machineIds?: string[] }).machineIds)
      ? ((targetPayload as { machineIds?: string[] }).machineIds?.length || 0)
      : 0
    if (targetPayload.targetType === 'adhoc' && machineCount === 0) return

    setBulkSubmitting(true)
    setBulkError(null) // Reset error when starting
    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: bulkForm.command,
          mode: bulkForm.mode,
          ...targetPayload,
          strategy: {
            concurrency: bulkForm.concurrency,
            batchSize: bulkForm.batchSize,
            waitSeconds: bulkForm.waitSeconds,
            stopOnFailurePercent: bulkForm.stopOnFailurePercent
          }
        })
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Job creation failed')
      }
      setBulkDryRun(null)
      clearSelection()
      setEditingJob(null)
      await fetchJobs()
      if (data.id) {
        loadJobDetail(data.id)
      }
    } catch (error) {
      console.error('Job creation failed:', error)
      setBulkError(error instanceof Error ? error.message : 'Unknown error')
    } finally {
      setBulkSubmitting(false)
    }
  }, [buildTargetPayload, bulkForm, clearSelection, fetchJobs, loadJobDetail])

  const handleAbortJob = useCallback(async (jobId: string) => {
    try {
      await fetch(`/api/jobs/${jobId}/abort`, { method: 'POST' })
      await fetchJobs()
      if (activeJobIdRef.current === jobId) {
        loadJobDetail(jobId)
      }
    } catch (error) {
      console.error('Failed to abort job:', error)
    }
  }, [fetchJobs, loadJobDetail])

  const handleRerunJob = useCallback((job: JobSummary) => {
    handleOpenJobEditor(job)
  }, [handleOpenJobEditor])

  const handleDeleteJob = useCallback(async (jobId: string) => {
    if (!confirm(t('errors.jobDeleteConfirm'))) {
      return
    }
    try {
      const res = await fetch(`/api/jobs/${jobId}`, { method: 'DELETE' })
      if (!res.ok) {
        throw new Error('Failed to delete job')
      }
      await fetchJobs()
      if (activeJobIdRef.current === jobId) {
        setActiveJob(null)
        setActiveJobExecutions([])
        activeJobIdRef.current = null
      }
    } catch (error) {
      console.error('Failed to delete job:', error)
      alert(t('errors.deleteFailed'))
    }
  }, [fetchJobs, t])

  useEffect(() => {
    fetchMachines()
    fetchJobs()
  }, [fetchMachines, fetchJobs])

  useEffect(() => {
    if (!authenticated) return

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
                return [...prev, data.machine]
              })
            } else if (data.type === 'machine_status_changed') {
              setMachines((prev) =>
                prev.map((m) =>
                  m.id === data.machineId ? { ...m, status: data.status } : m
                )
              )
            } else if (data.type === 'job_updated') {
              fetchJobs()
              if (activeJobIdRef.current && data.jobId === activeJobIdRef.current) {
                loadJobDetail(data.jobId, true)
              }
            } else if (data.type === 'job_execution_output') {
              if (activeJobIdRef.current && data.jobId === activeJobIdRef.current) {
                const chunk =
                  typeof data.output === 'string'
                    ? data.output
                    : data.output !== null && data.output !== undefined
                      ? JSON.stringify(data.output)
                      : ''
                const next = { ...liveLogsRef.current }
                next[data.machineId] = (next[data.machineId] || '') + chunk
                liveLogsRef.current = next
                setLiveLogs(next)
              }
            } else if (data.type === 'job_execution_updated') {
              if (activeJobIdRef.current && data.jobId === activeJobIdRef.current) {
                setActiveJobExecutions((prev) =>
                  prev.map((exec) =>
                    exec.id === data.executionId
                      ? { ...exec, status: data.status, exitCode: data.exitCode ?? exec.exitCode }
                      : exec
                  )
                )
                activeJobExecutionsRef.current = activeJobExecutionsRef.current.map((exec) =>
                  exec.id === data.executionId
                    ? { ...exec, status: data.status, exitCode: data.exitCode ?? exec.exitCode }
                    : exec
                )
              }
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
  }, [authenticated, fetchJobs, loadJobDetail])

  const requiresMachineSelection = !editingJob || editingJob.job.targetType === 'adhoc'

  // ALWAYS show auth dialog first when entering bulk page
  if (!authenticated) {
    return (
      <div className="min-h-screen relative flex items-center justify-center bg-[#050505] text-[#E0E0E0] overflow-hidden">
        <BackgroundLayers />
        <BulkPageAuthDialog
          onConfirm={() => setAuthenticated(true)}
          onCancel={() => window.history.back()}
        />
      </div>
    )
  }

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
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-cyan-200/70 font-mono">
              {t('header.eyebrow')}
            </p>
            <h2 className="text-2xl font-semibold text-white">{t('header.title')}</h2>
            <p className="text-sm text-slate-300">{t('header.subtitle')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={openNewBulkDialog}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-cyan-500/60 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/20 transition-all"
            >
              <Layers className="h-4 w-4" />
              <span>{t('actions.newJob')}</span>
            </button>
            <button
              onClick={fetchJobs}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-700 text-slate-200 hover:border-cyan-500/60 hover:text-cyan-100 transition-all"
            >
              <Loader2 className={cn("h-4 w-4", loadingJobs ? "animate-spin" : "opacity-60")} />
              <span>{t('actions.refresh')}</span>
            </button>
          </div>
        </div>

        {bulkDialogOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-6">
            <div className="w-full max-w-6xl max-h-[90vh] flex flex-col rounded-xl border border-slate-700 bg-[#0d141b] shadow-2xl">
              {/* Header */}
              <div className="flex-shrink-0 border-b border-slate-800 px-8 py-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="h-10 w-10 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center">
                        <Layers className="h-5 w-5 text-slate-300" />
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-400 font-mono">
                          {t('dialog.header.eyebrow')}
                        </p>
                        <h3 className="text-xl font-semibold text-white">
                          {t('dialog.header.title', { count: selected.size })}
                        </h3>
                      </div>
                    </div>
                    <p className="text-sm text-slate-300 max-w-2xl">
                      {t('dialog.header.subtitle')}
                    </p>
                    {editingJob && (
                      <div className="mt-3 inline-flex items-center gap-3 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/40 text-emerald-100">
                        <RefreshCw className="h-4 w-4" />
                        <div>
                          <p className="text-[11px] uppercase tracking-[0.14em] text-emerald-200/70">
                            {t('dialog.header.editingSubtitle')}
                          </p>
                          <p className="text-sm font-medium text-emerald-50 truncate max-w-[420px]">
                            {editingJob.job.name || editingJob.job.command}
                          </p>
                        </div>
                      </div>
                    )}
                    {prefillingJob && (
                      <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900/60 border border-slate-700 text-slate-200">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span className="text-sm font-medium">{t('dialog.header.loadingJobData')}</span>
                      </div>
                    )}
                    {bulkDryRun && (
                      <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-200">
                        <Activity className="h-4 w-4" />
                        <span className="text-sm font-medium">
                          {t('dialog.header.dryRun', { total: bulkDryRun.total, offline: bulkDryRun.offline })}
                        </span>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={handleCloseDialog}
                    className="h-9 w-9 rounded-lg border border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white hover:border-slate-600 transition-all flex items-center justify-center flex-shrink-0"
                    aria-label={t('dialog.closeButton')}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-8 py-6">
                <div className="space-y-6">
                  {/* Command Section */}
                  <div className="space-y-3">
                    <label className="flex items-center gap-2 text-sm font-medium text-white">
                      <div className="h-5 w-5 rounded bg-slate-800 flex items-center justify-center">
                        <span className="text-xs text-slate-300">1</span>
                      </div>
                      {t('form.commandLabel')}
                    </label>
                    <p className="text-xs text-slate-400 ml-7">
                      {t('form.commandHint')}
                    </p>
                    <textarea
                      value={bulkForm.command}
                      onChange={(e) => setBulkForm((prev) => ({ ...prev, command: e.target.value }))}
                      rows={3}
                      className="w-full rounded-lg border border-slate-700 bg-[#0a0f16] px-4 py-3 text-sm text-slate-100 font-mono placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500 focus:border-slate-500 transition-all resize-none"
                      placeholder={t('form.commandPlaceholder')}
                    />
                  </div>

                  {/* Strategy Section */}
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-3">
                      <label className="flex items-center gap-2 text-sm font-medium text-white">
                        <div className="h-5 w-5 rounded bg-slate-800 flex items-center justify-center">
                          <span className="text-xs text-slate-300">2</span>
                        </div>
                        {t('form.strategyLabel')}
                      </label>
                      <select
                        value={bulkForm.mode}
                        onChange={(e) =>
                          setBulkForm((prev) => ({ ...prev, mode: e.target.value as 'parallel' | 'rolling' }))
                        }
                        className="w-full rounded-lg border border-slate-700 bg-[#0a0f16] px-4 py-3 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-slate-500 focus:border-slate-500 transition-all cursor-pointer"
                      >
                        <option value="parallel">{t('form.strategyParallel')}</option>
                        <option value="rolling">{t('form.strategyRolling')}</option>
                      </select>
                      <div className="rounded-lg bg-slate-900/40 border border-slate-800 p-3">
                        <p className="text-xs text-slate-300">
                          {bulkForm.mode === 'parallel' 
                            ? t('form.strategyTipParallel')
                            : t('form.strategyTipRolling')
                          }
                        </p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <label className="flex items-center gap-2 text-sm font-medium text-white">
                        <div className="h-5 w-5 rounded bg-slate-800 flex items-center justify-center">
                          <span className="text-xs text-slate-300">3</span>
                        </div>
                        {t('form.configLabel')}
                      </label>
                      <div className="space-y-2">
                        <div>
                          <label className="text-xs text-slate-400 mb-1.5 block">{t('form.concurrencyLabel')}</label>
                          <input
                            type="number"
                            min={1}
                            max={50}
                            value={bulkForm.concurrency}
                            onChange={(e) => setBulkForm((prev) => ({ ...prev, concurrency: Number(e.target.value) }))}
                            className="w-full rounded-lg border border-slate-700 bg-[#0a0f16] px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-slate-500 focus:border-slate-500 transition-all"
                          />
                        </div>
                        {bulkForm.mode === 'rolling' && (
                          <>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="text-xs text-slate-400 mb-1.5 block">
                                  {t('form.batchSizeLabel')}
                                  <span className="ml-1 text-slate-500" title={t('form.batchSizeHint')}>ⓘ</span>
                                </label>
                                <input
                                  type="number"
                                  min={1}
                                  value={bulkForm.batchSize}
                                  onChange={(e) => setBulkForm((prev) => ({ ...prev, batchSize: Number(e.target.value) }))}
                                  className="w-full rounded-lg border border-slate-700 bg-[#0a0f16] px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-slate-500 focus:border-slate-500 transition-all"
                                />
                              </div>
                              <div>
                                <label className="text-xs text-slate-400 mb-1.5 block">{t('form.waitSecondsLabel')}</label>
                                <input
                                  type="number"
                                  min={0}
                                  value={bulkForm.waitSeconds}
                                  onChange={(e) => setBulkForm((prev) => ({ ...prev, waitSeconds: Number(e.target.value) }))}
                                  className="w-full rounded-lg border border-slate-700 bg-[#0a0f16] px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-slate-500 focus:border-slate-500 transition-all"
                                />
                              </div>
                            </div>
                            <div>
                              <label className="text-xs text-slate-400 mb-1.5 block">{t('form.failureToleranceLabel')}</label>
                              <input
                                type="number"
                                min={1}
                                max={100}
                                value={bulkForm.stopOnFailurePercent}
                                onChange={(e) => setBulkForm((prev) => ({ ...prev, stopOnFailurePercent: Number(e.target.value) }))}
                                className="w-full rounded-lg border border-slate-700 bg-[#0a0f16] px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-slate-500 focus:border-slate-500 transition-all"
                              />
                              <p className="text-xs text-slate-500 mt-1">{t('form.failureToleranceHint')}</p>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>                {/* Target Selection */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-sm font-medium text-white">
                      <div className="h-5 w-5 rounded bg-amber-500/10 flex items-center justify-center">
                        <span className="text-xs text-amber-300">4</span>
                      </div>
                      {t('form.targetSelectionLabel')}
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={selectAll}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 text-xs text-slate-300 hover:border-slate-600 hover:text-slate-200 hover:bg-slate-800/50 transition-all"
                      >
                        <CheckSquare className="h-3.5 w-3.5" />
                        <span>{t('form.selectAll')}</span>
                      </button>
                      <button
                        onClick={clearSelection}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 text-xs text-slate-300 hover:border-slate-600 hover:text-slate-200 hover:bg-slate-800/50 transition-all"
                      >
                        <X className="h-3.5 w-3.5" />
                        <span>{t('form.clearSelection')}</span>
                      </button>
                    </div>
                  </div>
                  {editingJob && requiresMachineSelection && (
                    <p className="text-xs text-slate-400">
                      {t('form.targetSelectionPrefilledHint')}
                    </p>
                  )}
                  {!requiresMachineSelection && (
                    <p className="text-xs text-slate-400">
                      {t('form.targetSelectionGroupHint')}
                    </p>
                  )}
                  <div className="rounded-lg border border-slate-700 bg-[#090d14] overflow-hidden">
                    <div className="max-h-80 overflow-y-auto divide-y divide-slate-800/50">
                      {machines.length === 0 ? (
                        <div className="px-4 py-8 text-center text-slate-400 text-sm">
                          {t('form.noMachinesAvailable')}
                        </div>
                      ) : (
                        machines.map((m) => (
                          <label
                            key={m.id}
                            className={cn(
                              "flex items-center gap-3 px-4 py-3 cursor-pointer transition-all",
                              selected.has(m.id)
                                ? "bg-slate-800/50 hover:bg-slate-800/70"
                                : "hover:bg-slate-800/30"
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={selected.has(m.id)}
                              onChange={() => toggleSelection(m.id)}
                              className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-slate-400 focus:ring-slate-500 focus:ring-offset-0 cursor-pointer"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-white truncate">{m.hostname}</p>
                              <p className="text-xs text-slate-400">{m.ip}</p>
                            </div>
                            <span className={cn(
                              "text-[11px] px-2 py-1 rounded-full border flex-shrink-0",
                              m.status === 'online'
                                ? "border-emerald-400/50 text-emerald-100 bg-emerald-500/10"
                                : "border-slate-600 text-slate-300 bg-slate-800/50"
                            )}>
                              {m.status === 'online' ? t('form.online') : t('form.offline')}
                            </span>
                          </label>
                        ))
                      )}
                    </div>
                  </div>
                  {selected.size > 0 && (
                    <p className="text-xs text-slate-400 ml-7">
                      {t('form.selectionSummary', {
                        count: selected.size,
                        total: machines.length
                      })}
                    </p>
                  )}
                </div>

                </div>

                {/* Actions */}
                <div className="flex items-center gap-3 pt-4 border-t border-slate-800">
                  <button
                    onClick={handleDryRun}
                    disabled={bulkSubmitting || prefillingJob || (requiresMachineSelection && selected.size === 0)}
                    title={t('form.dryRunTitle')}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-700 bg-slate-900/50 text-slate-200 hover:border-slate-600 hover:bg-slate-800 hover:text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {bulkSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
                    <span className="font-medium">{t('form.dryRun')}</span>
                  </button>
                  <button
                    onClick={handleRunJobWithCheck}
                    disabled={
                      bulkSubmitting ||
                      prefillingJob ||
                      !bulkForm.command.trim() ||
                      (requiresMachineSelection && selected.size === 0)
                    }
                    title={t('form.runJobTitle')}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg border border-slate-600 bg-slate-700 text-white hover:bg-slate-600 hover:border-slate-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {bulkSubmitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span className="font-semibold">{t('form.running')}</span>
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4" />
                        <span className="font-semibold">
                          {editingJob ? t('form.applyAndRun') : t('form.runJob')}
                        </span>
                      </>
                    )}
                  </button>
                </div>

                {/* Error Display */}
                {bulkError && (
                  <div className="mt-3 p-3 rounded-lg border border-red-800 bg-red-950/20 text-red-300 text-sm">
                    <div className="flex items-start gap-2">
                      <X className="h-4 w-4 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="font-medium">{t('errors.jobStartFailed')}</p>
                        <p className="mt-1 text-red-400">{bulkError}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {jobs.length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-[#0b1118]/80 p-4 text-slate-400 text-sm">
            {t('jobsList.noJobs')}
          </div>
        ) : (
          <div className="rounded-xl border border-slate-800 bg-[#0c1219]/80 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-900/50 border-b border-slate-800">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">{t('jobsList.columns.name')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">{t('jobsList.columns.command')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">{t('jobsList.columns.mode')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">{t('jobsList.columns.targets')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">{t('jobsList.columns.status')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">{t('jobsList.columns.created')}</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">{t('jobsList.columns.actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {jobs.map((job) => (
                    <tr
                      key={job.id}
                      className={cn(
                        "hover:bg-slate-800/40 transition-colors",
                        job.status === 'RUNNING' && "bg-slate-800/20"
                      )}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className={cn(
                            "h-2 w-2 rounded-full",
                            job.status === 'RUNNING' && "bg-cyan-400 animate-pulse",
                            job.status === 'SUCCESS' && "bg-emerald-400",
                            job.status === 'FAILED' && "bg-red-400",
                            job.status === 'ABORTED' && "bg-amber-400",
                            job.status === 'PENDING' && "bg-slate-400"
                          )} />
                          <span className="text-sm font-medium text-white truncate max-w-[200px]">
                            {job.name || t('jobsList.unnamed')}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <code className="text-xs text-slate-300 font-mono truncate block max-w-[300px]">
                          {job.command}
                        </code>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700">
                          {job.mode === 'rolling' ? '🌊' : '⚡'} {job.mode === 'rolling' ? t('form.strategyRolling') : t('form.strategyParallel')}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-slate-300">{job.totalTargets}</span>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge
                          icon={<Activity className="h-3.5 w-3.5" />}
                          label={job.status === 'SUCCESS' ? t('jobsList.statuses.completed') : t(`jobsList.statuses.${job.status.toLowerCase()}`)}
                          tone={job.status === 'RUNNING' ? 'info' : job.status === 'SUCCESS' ? 'good' : job.status === 'PENDING' ? 'info' : 'warn'}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-xs text-slate-400">
                          <div>{new Date(job.createdAt).toLocaleDateString(locale === 'de' ? 'de-DE' : 'en-US')}</div>
                          <div>{new Date(job.createdAt).toLocaleTimeString(locale === 'de' ? 'de-DE' : 'en-US')}</div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              openJobDetail(job)
                            }}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-700 text-xs text-slate-300 hover:border-slate-600 hover:text-white hover:bg-slate-800 transition-all"
                            title={t('jobsList.actions.viewDetails')}
                          >
                            <Layers className="h-3.5 w-3.5" />
                            <span>{t('jobsList.actions.viewDetails')}</span>
                          </button>
                          {job.status === 'RUNNING' ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleAbortJob(job.id)
                              }}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-red-500/60 text-xs text-red-100 hover:bg-red-500/10 transition-all"
                              title={t('jobsList.actions.abort')}
                            >
                              <StopCircle className="h-3.5 w-3.5" />
                              <span>{t('jobsList.actions.abort')}</span>
                            </button>
                          ) : (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleRerunJob(job)
                              }}
                              disabled={bulkSubmitting}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-700 text-xs text-slate-300 hover:border-emerald-500/60 hover:text-emerald-100 hover:bg-emerald-500/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                              title={t('jobsList.actions.rerun')}
                            >
                              <RefreshCw className="h-3.5 w-3.5" />
                              <span>{t('jobsList.actions.rerun')}</span>
                            </button>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDeleteJob(job.id)
                            }}
                            className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-slate-700 text-slate-400 hover:border-red-500/60 hover:text-red-100 hover:bg-red-500/10 transition-all"
                            title={t('jobsList.actions.delete')}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeJob && (
          <div className="rounded-xl border border-cyan-500/30 bg-[#0b1118]/80 p-4 space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-cyan-200/70 font-mono">
                  {t('jobDetail.title')}
                </p>
                <h4 className="text-lg font-semibold text-white">{activeJob.name || activeJob.command}</h4>
                <p className="text-xs text-slate-400 mt-1 break-words">{activeJob.command}</p>
              </div>
              <div className="flex gap-2">
                {activeJob.status !== 'RUNNING' && (
                  <button
                    onClick={() => handleOpenJobEditor(activeJob)}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-emerald-500/50 text-emerald-100 hover:bg-emerald-500/10 transition-all"
                  >
                    <RefreshCw className="h-4 w-4" />
                    <span>{t('jobDetail.editAndRun')}</span>
                  </button>
                )}
                {activeJob.status === 'RUNNING' && (
                  <button
                    onClick={() => handleAbortJob(activeJob.id)}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-rose-500/60 text-rose-100 hover:bg-rose-500/10 transition-all"
                  >
                    <StopCircle className="h-4 w-4" />
                    <span>{t('jobDetail.killSwitch')}</span>
                  </button>
                )}
                <button
                  onClick={async () => {
                    if (!activeJob) return
                    const confirmDelete = window.confirm(t('errors.jobDeleteConfirm'))
                    if (!confirmDelete) return
                    try {
                      await fetch(`/api/jobs/${activeJob.id}`, { method: 'DELETE' })
                      await fetchJobs()
                      setActiveJob(null)
                      activeJobIdRef.current = null
                      setActiveJobExecutions([])
                      setLiveLogs({})
                    } catch (err) {
                      console.error('Failed to delete job', err)
                    }
                  }}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-700 text-slate-200 hover:border-rose-500/70 hover:text-rose-100 transition-all"
                >
                  <Trash2 className="h-4 w-4" />
                  <span>{t('jobDetail.deleteJob')}</span>
                </button>
                <button
                  onClick={() => {
                    setActiveJob(null)
                    activeJobIdRef.current = null
                    setActiveJobExecutions([])
                    setLiveLogs({})
                  }}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-700 text-slate-200 hover:border-slate-500 transition-all"
                >
                  <X className="h-4 w-4" />
                  <span>{t('jobDetail.close')}</span>
                </button>
              </div>
            </div>

            {jobLoadingDetail ? (
              <div className="text-sm text-slate-400">{t('jobDetail.loading')}</div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {activeJobExecutions.map((exec) => (
                    <div
                      key={exec.id}
                      className="rounded-lg border border-slate-800 bg-[#0a0f16] p-3 flex items-start justify-between gap-2"
                    >
                      <div>
                        <p className="text-sm text-white">{exec.machine?.hostname || exec.machineId}</p>
                        <p className="text-xs text-slate-400">{exec.machine?.ip}</p>
                      </div>
                      <StatusBadge
                        icon={<Activity className="h-3 w-3" />}
                        label={exec.status === 'SUCCESS' ? t('jobDetail.executionStatus.success') : t(`jobDetail.executionStatus.${exec.status.toLowerCase()}`)}
                        tone={
                          exec.status === 'SUCCESS'
                            ? 'good'
                            : exec.status === 'RUNNING'
                              ? 'info'
                              : exec.status === 'PENDING'
                                ? 'info'
                                : 'warn'
                        }
                      />
                      {exec.error && (
                        <div className="mt-2 text-[11px] text-rose-300 bg-rose-900/30 border border-rose-600/40 rounded px-2 py-1">
                          {exec.error}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div className="rounded-lg border border-slate-800 bg-[#080c12] p-3">
                  <p className="text-xs uppercase tracking-[0.24em] text-cyan-200/70 font-mono mb-2">{t('jobDetail.liveOutput')}</p>
                  <div className="space-y-3 max-h-64 overflow-y-auto text-sm font-mono text-slate-200">
                    {activeJobExecutions.length === 0 ? (
                      <p className="text-sm text-slate-400">{t('jobDetail.noLogs')}</p>
                    ) : (
                      activeJobExecutions.map((exec) => {
                        const machineId = exec.machineId
                        const label = machineLabelLookup.get(machineId) || machineId
                        // Verwende liveLogs wenn vorhanden (während Job läuft), sonst exec.output (wenn Job fertig ist)
                        // Aber niemals beides gleichzeitig, um Duplikate zu vermeiden
                        const log = liveLogs[machineId] || exec.output || ''
                        return (
                          <div key={machineId} className="border border-slate-800 rounded p-2">
                            <p className="text-[11px] text-slate-400 mb-1">{label}</p>
                            <pre className="whitespace-pre-wrap break-words text-slate-200 text-[12px]">
                              {log || t('jobDetail.noLogs')}
                            </pre>
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {showAddModal && (
        <AddAgentModal onClose={() => setShowAddModal(false)} />
      )}

      {/* Critical Command Password Dialog */}
      {pendingCriticalJob && (
        <CriticalCommandDialog
          command={bulkForm.command}
          onConfirm={() => {
            setPendingCriticalJob(false)
            handleRunJob()
          }}
          onCancel={() => setPendingCriticalJob(false)}
        />
      )}
    </AppShell>
  )
}
