/**
 * Job Orchestrator
 * Handles bulk command execution across machines with parallel and rolling strategies.
 *
 * This module is CommonJS so it can be required from server.js and imported from TS API routes.
 */
// Use the shared singleton PrismaClient from lib/prisma
const { prisma } = require('./prisma')

const MAX_GLOBAL_CONCURRENCY = 50
const DISCONNECT_GRACE_MS = 15000 // 15 seconds grace period for command completion after disconnect

// Singleton orchestrator to keep shared state across Next API routes and custom server
let orchestratorInstance = global.__orchestrator_instance

class JobOrchestrator {
  constructor() {
    this.dispatchers = {
      sendCommand: null,
      isMachineOnline: null,
      broadcast: () => {}
    }
    this.inflight = new Map() // commandId -> { jobId, executionId }
    this.jobState = new Map() // jobId -> state
    this.completedExecutions = new Set() // Track recently completed executions to prevent false failures
  }

  configure(opts) {
    this.dispatchers = {
      ...this.dispatchers,
      ...opts
    }
  }

  isReady() {
    return Boolean(this.dispatchers.sendCommand && this.dispatchers.isMachineOnline)
  }

  /**
   * Resolve target machines based on adhoc list, group, or dynamic query.
   */
  async resolveTargets({ targetType, groupId, machineIds = [], dynamicQuery = null }) {
    if (targetType === 'group' && groupId) {
      const group = await prisma.group.findUnique({
        where: { id: groupId },
        include: {
          members: true
        }
      })
      if (!group) {
        throw new Error('Group not found')
      }

      if (group.type === 'dynamic') {
        return this.applyDynamicQuery(dynamicQuery || this.parseJsonMaybe(group.query))
      }

      const ids = group.members.map((m) => m.machineId)
      return this.fetchMachinesByIds(ids)
    }

    if (targetType === 'dynamic') {
      return this.applyDynamicQuery(dynamicQuery)
    }

    // adhoc (default)
    return this.fetchMachinesByIds(machineIds)
  }

  async fetchMachinesByIds(ids) {
    if (!ids || ids.length === 0) return []
    const machines = await prisma.machine.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        hostname: true,
        ip: true,
        osInfo: true,
        status: true,
        tags: true
      }
    })
    return machines
  }

  /**
   * Very small query engine for dynamic groups.
   * Supported fields:
   * - os: checks distro/version string inside osInfo
   * - status: online/offline/error
   * - hostname / ip: substring match
   * - tag:<key>: match machine tag value (exact)
   * - role (alias for tag:role)
   *
   * Query shape:
   * {
   *   match: 'all' | 'any' (default all)
   *   conditions: [{ field: 'os' | 'status' | 'hostname' | 'ip' | 'role' | 'tag:<key>', op?: 'eq' | 'contains', value: string }]
   * }
   */
  async applyDynamicQuery(query) {
    if (typeof query === 'string') {
      query = this.parseJsonMaybe(query)
    }
    if (!query || !Array.isArray(query.conditions)) {
      return []
    }

    const machines = await prisma.machine.findMany({
      include: { tags: true }
    })

    const matchMode = query.match === 'any' ? 'any' : 'all'

    return machines.filter((machine) => {
      return query.conditions[matchMode === 'all' ? 'every' : 'some']((cond) =>
        this.matchesCondition(machine, cond)
      )
    })
  }

  matchesCondition(machine, cond) {
    const op = cond.op || 'eq'
    const value = String(cond.value || '').toLowerCase()
    const field = (cond.field || '').toLowerCase()

    if (!field) return false

    const osInfo = this.parseOs(machine.osInfo)
    const tags = machine.tags || []

    const getTag = (key) =>
      tags.find((t) => t.key.toLowerCase() === key.toLowerCase())?.value || ''

    let candidate = ''

    if (field === 'os') {
      candidate = osInfo
    } else if (field === 'status') {
      candidate = machine.status || ''
    } else if (field === 'hostname') {
      candidate = machine.hostname || ''
    } else if (field === 'ip') {
      candidate = machine.ip || ''
    } else if (field === 'role') {
      candidate = getTag('role')
    } else if (field.startsWith('tag:')) {
      const key = field.slice(4)
      candidate = getTag(key)
    } else {
      return false
    }

    const candidateLc = String(candidate || '').toLowerCase()

    if (op === 'contains') {
      return candidateLc.includes(value)
    }
    // default eq
    return candidateLc === value
  }

  parseOs(osInfo) {
    if (!osInfo) return ''
    try {
      const parsed = typeof osInfo === 'string' ? JSON.parse(osInfo) : osInfo
      const parts = [parsed?.distro, parsed?.version || parsed?.release].filter(Boolean)
      if (parts.length) return parts.join(' ').toLowerCase()
    } catch (e) {
      // ignore parse errors, fall back to raw string
    }
    return String(osInfo).toLowerCase()
  }

  /**
   * Dry-run returns a resolved target list without creating a job.
   */
  async dryRun(payload) {
    const targets = await this.resolveTargets(payload)
    const offline = targets.filter((m) => m.status !== 'online')
    return {
      dryRun: true,
      total: targets.length,
      offline: offline.length,
      targets
    }
  }

  /**
   * Create and immediately start a job (unless dryRun is set).
   */
  async createJob(payload) {
    if (!this.isReady()) {
      throw new Error('Orchestrator not ready - dispatchers missing')
    }

    if (payload.dryRun) {
      return this.dryRun(payload)
    }

    const targets = await this.resolveTargets(payload)
    if (!targets.length) {
      throw new Error('No target machines matched the selection')
    }

    const strategyObj = this.normalizeStrategy(payload.strategy || {})
    const targetType = payload.targetType || 'adhoc'

    const job = await prisma.job.create({
      data: {
        name: payload.name || payload.command.slice(0, 40),
        description: payload.description,
        command: payload.command,
        mode: payload.mode === 'rolling' ? 'rolling' : 'parallel',
        status: 'PENDING',
        targetType,
        groupId: targetType === 'group' ? payload.groupId : null,
        targetQuery: targetType === 'dynamic'
          ? JSON.stringify(payload.dynamicQuery || payload.query || {})
          : null,
        strategy: JSON.stringify(strategyObj),
        totalTargets: targets.length,
        createdByUserId: payload.createdByUserId || null,
        executions: {
          create: targets.map((m) => ({
            machineId: m.id
          }))
        }
      },
      include: { executions: true }
    })

    this.startJob(job, targets)
    return {
      ...job,
      strategy: strategyObj,
      targetQuery: targetType === 'dynamic'
        ? payload.dynamicQuery || payload.query || null
        : null
    }
  }

  normalizeStrategy(strategy) {
    const normalized = {
      concurrency: Math.min(
        Math.max(1, Number(strategy.concurrency) || MAX_GLOBAL_CONCURRENCY),
        MAX_GLOBAL_CONCURRENCY
      ),
      batchSize: strategy.batchSize ? Math.max(1, Number(strategy.batchSize)) : undefined,
      batchPercent: strategy.batchPercent ? Math.min(100, Math.max(1, Number(strategy.batchPercent))) : undefined,
      waitSeconds: strategy.waitSeconds ? Math.max(0, Number(strategy.waitSeconds)) : 0,
      stopOnFailurePercent: strategy.stopOnFailurePercent
        ? Math.min(100, Math.max(1, Number(strategy.stopOnFailurePercent)))
        : undefined
    }
    return normalized
  }

  /**
   * Initialize a job run and kick off dispatching.
   */
  async startJob(job, targets) {
    const strategy = this.parseStrategy(job.strategy)

    // Build lookup for fast machineId access
    const execLookup = new Map()
    job.executions.forEach((exec) => execLookup.set(exec.id, exec.machineId))

    const pendingQueue = job.executions.map((exec) => exec.id)

    const state = {
      jobId: job.id,
      command: job.command,
      mode: job.mode,
      strategy: strategy || {},
      queue: pendingQueue,
      execLookup,
      running: new Set(),
      batches: [],
      currentBatch: 0,
      timer: null,
      aborted: false,
      counts: {
        pending: pendingQueue.length,
        running: 0,
        success: 0,
        failed: 0,
        skipped: 0,
        aborted: 0
      }
    }

    if (job.mode === 'rolling') {
      const batchSize = this.calculateBatchSize(
        pendingQueue.length,
        state.strategy.batchSize,
        state.strategy.batchPercent
      )
      state.batches = this.chunkArray(pendingQueue, batchSize)
    }

    this.jobState.set(job.id, state)

    await prisma.job.update({
      where: { id: job.id },
      data: { status: 'RUNNING', startedAt: new Date() }
    })
    this.dispatchers.broadcast({
      type: 'job_updated',
      jobId: job.id,
      status: 'RUNNING'
    })

    if (job.mode === 'rolling') {
      this.runRollingBatch(job.id)
    } else {
      this.fillParallel(job.id)
    }
  }

  calculateBatchSize(total, batchSize, batchPercent) {
    if (batchSize) return Math.min(total, Math.max(1, batchSize))
    if (batchPercent) {
      const size = Math.floor((total * batchPercent) / 100)
      return Math.min(total, Math.max(1, size))
    }
    return Math.min(total, 1)
  }

  chunkArray(arr, size) {
    const result = []
    for (let i = 0; i < arr.length; i += size) {
      result.push(arr.slice(i, i + size))
    }
    return result
  }

  fillParallel(jobId) {
    const state = this.jobState.get(jobId)
    if (!state || state.aborted) return

    const limit = Math.min(
      state.strategy.concurrency || MAX_GLOBAL_CONCURRENCY,
      MAX_GLOBAL_CONCURRENCY
    )

    while (state.running.size < limit && state.queue.length > 0) {
      const execId = state.queue.shift()
      this.dispatchExecution(jobId, execId)
    }

    if (state.running.size === 0 && state.queue.length === 0) {
      this.completeJob(jobId)
    }
  }

  runRollingBatch(jobId) {
    const state = this.jobState.get(jobId)
    if (!state || state.aborted) return

    const currentBatch = state.batches[state.currentBatch]
    if (!currentBatch || currentBatch.length === 0) {
      this.completeJob(jobId)
      return
    }

    currentBatch.forEach((execId) => this.dispatchExecution(jobId, execId))
  }

  async dispatchExecution(jobId, executionId) {
    const state = this.jobState.get(jobId)
    if (!state || state.aborted) return

    const machineId = state.execLookup.get(executionId)
    const isOnline = this.dispatchers.isMachineOnline?.(machineId)

    // Remove from queue if present (rolling uses pre-built batches)
    const idx = state.queue.indexOf(executionId)
    if (idx !== -1) {
      state.queue.splice(idx, 1)
    }

    state.counts.pending -= 1

    if (!isOnline) {
      state.counts.failed += 1
      await prisma.jobExecution.update({
        where: { id: executionId },
        data: {
          status: 'FAILED',
          error: 'Agent offline',
          completedAt: new Date()
        }
      })
      this.dispatchers.broadcast({
        type: 'job_execution_updated',
        jobId,
        executionId,
        machineId,
        status: 'FAILED',
        error: 'Agent offline'
      })
      this.onExecutionFinished(jobId, executionId, 'FAILED')
      return
    }

    state.running.add(executionId)
    state.counts.running += 1

    await prisma.jobExecution.update({
      where: { id: executionId },
      data: {
        status: 'RUNNING',
        startedAt: new Date()
      }
    })

    this.inflight.set(executionId, {
      jobId,
      executionId,
      machineId,
      timestamp: Date.now(),
      disconnectTimer: null
    })
    const sent = await this.dispatchers.sendCommand?.(machineId, executionId, state.command)

    if (!sent) {
      state.running.delete(executionId)
      state.counts.running -= 1
      state.counts.failed += 1
      await prisma.jobExecution.update({
        where: { id: executionId },
        data: {
          status: 'FAILED',
          error: 'Failed to dispatch command',
          completedAt: new Date()
        }
      })
      this.dispatchers.broadcast({
        type: 'job_execution_updated',
        jobId,
        executionId,
        machineId,
        status: 'FAILED',
        error: 'Failed to dispatch command'
      })
      this.onExecutionFinished(jobId, executionId, 'FAILED')
    }
  }

  /**
   * Handle command output/exit from agents.
   */
  async handleCommandOutput({ machineId, commandId, output, exitCode, completed }) {
    let inflightEntry = commandId ? this.inflight.get(commandId) : null

    // Recover missing commandId from machineId (some agents omit)
    if (!inflightEntry && machineId) {
      let latest = null
      for (const [cid, info] of this.inflight.entries()) {
        if (info.machineId === machineId) {
          if (!latest || (info.timestamp || 0) > (latest.timestamp || 0)) {
            latest = { ...info, commandId: cid }
          }
        }
      }
      if (latest) {
        inflightEntry = latest
        commandId = latest.commandId
      }
    }

    // Final fallback: load execution directly so we can still persist output even if inflight mapping is missing
    let jobId = inflightEntry?.jobId
    let executionId = inflightEntry?.executionId || commandId
    if (!inflightEntry && executionId) {
      const execution = await prisma.jobExecution.findUnique({
        where: { id: executionId },
        select: { id: true, jobId: true }
      })
      if (execution) {
        jobId = execution.jobId
        inflightEntry = { jobId, executionId: execution.id, machineId }
      }
    }

    if (!inflightEntry || !jobId || !executionId) {
      return
    }
    if (inflightEntry.disconnectTimer) {
      clearTimeout(inflightEntry.disconnectTimer)
      inflightEntry.disconnectTimer = null
      this.inflight.set(commandId, inflightEntry)
    }

    if (output) {
      await this.appendOutput(executionId, output)
      this.dispatchers.broadcast({
        type: 'job_execution_output',
        jobId,
        executionId,
        machineId,
        output
      })
    }

    if (completed) {
      const hasExitCode = exitCode !== undefined && exitCode !== null
      const normalizedExitCode = hasExitCode ? Number(exitCode) : 0
      if (!hasExitCode) {
        console.warn(
          `Command completed without exit code for execution ${executionId} (machine ${machineId}) - treating as success`
        )
      }

      const status = normalizedExitCode === 0 ? 'SUCCESS' : 'FAILED'
      let failureNote = null
      if (status === 'FAILED') {
        if (output) {
          failureNote = output.slice(-500) // capture tail of output as error hint
        } else {
          failureNote = `Command failed with exit code ${normalizedExitCode || 'unknown'}`
        }
      }

      // Mark execution as completed to prevent false failure on disconnect
      this.completedExecutions.add(executionId)
      // Clean up old completed executions after 60 seconds
      setTimeout(() => this.completedExecutions.delete(executionId), 60000)

      // Clear any pending disconnect timer before marking as complete
      if (inflightEntry?.disconnectTimer) {
        clearTimeout(inflightEntry.disconnectTimer)
      }

      await prisma.jobExecution.update({
        where: { id: executionId },
        data: {
          status,
          exitCode: normalizedExitCode,
          error: failureNote || null,
          completedAt: new Date()
        }
      })

      this.inflight.delete(commandId)
      this.dispatchers.broadcast({
        type: 'job_execution_updated',
        jobId,
        executionId,
        machineId,
        status,
        exitCode: normalizedExitCode,
        error: failureNote
      })

      this.onExecutionFinished(jobId, executionId, status)
    }
  }

  async appendOutput(executionId, chunk) {
    let textChunk = ''
    if (typeof chunk === 'string') {
      textChunk = chunk
    } else if (Buffer.isBuffer(chunk)) {
      textChunk = chunk.toString('utf8')
    } else if (chunk !== null && chunk !== undefined) {
      try {
        textChunk = JSON.stringify(chunk)
      } catch (e) {
        textChunk = String(chunk || '')
      }
    }
    if (!textChunk) return
    const current = await prisma.jobExecution.findUnique({
      where: { id: executionId },
      select: { output: true }
    })
    const next = (current?.output || '') + textChunk
    await prisma.jobExecution.update({
      where: { id: executionId },
      data: { output: next }
    })
  }

  async onExecutionFinished(jobId, executionId, status) {
    const state = this.jobState.get(jobId)
    if (!state) return

    state.running.delete(executionId)
    state.counts.running = Math.max(0, state.counts.running - 1)

    if (status === 'SUCCESS') state.counts.success += 1
    if (status === 'FAILED') state.counts.failed += 1
    if (status === 'SKIPPED') state.counts.skipped += 1
    if (status === 'ABORTED') state.counts.aborted += 1

    if (state.mode === 'rolling') {
      const batch = state.batches[state.currentBatch] || []
      const batchStillRunning = batch.some((id) => state.running.has(id))
      if (!batchStillRunning) {
        await this.evaluateRollingBatch(jobId, batch)
      }
    } else {
      this.fillParallel(jobId)
    }
  }

  async evaluateRollingBatch(jobId, batch) {
    const state = this.jobState.get(jobId)
    if (!state || state.aborted) return

    // Fetch batch statuses
    const executions = await prisma.jobExecution.findMany({
      where: { id: { in: batch } },
      select: { id: true, status: true }
    })
    const failures = executions.filter((e) => e.status === 'FAILED').length
    const failureRate = (failures / executions.length) * 100

    const stopThreshold = state.strategy.stopOnFailurePercent
    const shouldAbort = stopThreshold && failureRate > stopThreshold

    if (shouldAbort) {
      await this.abortRemaining(jobId, 'Batch failure threshold exceeded')
      return
    }

    // Schedule next batch
    state.currentBatch += 1
    if (state.currentBatch >= state.batches.length) {
      this.completeJob(jobId)
      return
    }

    if (state.strategy.waitSeconds) {
      state.timer = setTimeout(() => this.runRollingBatch(jobId), state.strategy.waitSeconds * 1000)
    } else {
      this.runRollingBatch(jobId)
    }
  }

  async abortRemaining(jobId, reason = 'Aborted') {
    const state = this.jobState.get(jobId)
    if (!state) return
    state.aborted = true
    if (state.timer) {
      clearTimeout(state.timer)
    }

    const pendingIds = [
      ...state.queue,
      ...[...(state.batches || []).slice(state.currentBatch + 1).flat()]
    ]

    await prisma.jobExecution.updateMany({
      where: { id: { in: pendingIds } },
      data: { status: 'SKIPPED', error: reason }
    })

    state.counts.skipped += pendingIds.length
    state.queue = []

    await prisma.job.update({
      where: { id: jobId },
      data: { status: 'ABORTED', completedAt: new Date() }
    })
    this.dispatchers.broadcast({
      type: 'job_updated',
      jobId,
      status: 'ABORTED',
      reason
    })
  }

  async completeJob(jobId) {
    const state = this.jobState.get(jobId)
    if (!state) return

    const executions = await prisma.jobExecution.findMany({
      where: { jobId },
      select: { status: true }
    })
    const hasFailure = executions.some((e) => e.status === 'FAILED')
    const hasAborted = executions.some((e) => e.status === 'ABORTED' || e.status === 'SKIPPED')

    const status = state.aborted
      ? 'ABORTED'
      : hasFailure
        ? 'FAILED'
        : hasAborted
          ? 'FAILED'
          : 'SUCCESS'

    await prisma.job.update({
      where: { id: jobId },
      data: { status, completedAt: new Date() }
    })

    this.jobState.delete(jobId)
    this.dispatchers.broadcast({
      type: 'job_updated',
      jobId,
      status
    })
  }

  /**
   * Abort a job via API call.
   */
  async abortJob(jobId) {
    const state = this.jobState.get(jobId)
    if (!state) {
      await prisma.job.update({
        where: { id: jobId },
        data: { status: 'ABORTED', completedAt: new Date() }
      })
      return
    }
    await this.abortRemaining(jobId, 'Aborted by user')
  }

  /**
   * Mark inflight executions for a machine as failed on disconnect.
   */
  async handleAgentDisconnect(machineId) {
    const toFail = []
    for (const [cmdId, info] of this.inflight.entries()) {
      if (info.machineId === machineId) {
        toFail.push({ commandId: cmdId, ...info })
      }
    }

    for (const entry of toFail) {
      // If we already scheduled a disconnect timer, skip
      if (entry.disconnectTimer) continue

      // Skip if execution was already completed
      if (this.completedExecutions.has(entry.executionId)) {
        console.log(`Skipping disconnect failure for already completed execution ${entry.executionId}`)
        this.inflight.delete(entry.commandId)
        continue
      }

      const timer = setTimeout(async () => {
        try {
          // Double-check if execution completed while timer was running
          if (this.completedExecutions.has(entry.executionId)) {
            console.log(`Execution ${entry.executionId} completed during grace period, not marking as failed`)
            this.inflight.delete(entry.commandId)
            return
          }

          // Also check DB status before overwriting
          const currentExec = await prisma.jobExecution.findUnique({
            where: { id: entry.executionId },
            select: { status: true }
          })
          if (currentExec && (currentExec.status === 'SUCCESS' || currentExec.status === 'FAILED')) {
            console.log(`Execution ${entry.executionId} already has final status ${currentExec.status}, not overwriting`)
            this.inflight.delete(entry.commandId)
            return
          }

          await prisma.jobExecution.update({
            where: { id: entry.executionId },
            data: {
              status: 'FAILED',
              error: 'Agent disconnected',
              completedAt: new Date()
            }
          })
          this.dispatchers.broadcast({
            type: 'job_execution_updated',
            jobId: entry.jobId,
            executionId: entry.executionId,
            machineId: entry.machineId,
            status: 'FAILED',
            error: 'Agent disconnected'
          })
          this.inflight.delete(entry.commandId)
          await this.onExecutionFinished(entry.jobId, entry.executionId, 'FAILED')
        } catch (err) {
          console.error('Failed to mark execution failed on disconnect', err)
        }
      }, DISCONNECT_GRACE_MS)

      this.inflight.set(entry.commandId, {
        ...entry,
        disconnectTimer: timer
      })
    }
  }

  async getJob(jobId) {
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: {
        executions: {
          orderBy: { createdAt: 'asc' },
          include: {
            machine: {
              select: { id: true, hostname: true, ip: true, status: true }
            }
          }
        },
        group: true
      }
    })
    if (!job) return null
    return {
      ...job,
      strategy: this.parseStrategy(job.strategy),
      targetQuery: this.parseJsonMaybe(job.targetQuery)
    }
  }

  async listJobs(limit = 20, filterUserId = null) {
    const jobs = await prisma.job.findMany({
      where: filterUserId ? { createdByUserId: filterUserId } : undefined,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        _count: {
          select: { executions: true }
        }
      }
    })
    return jobs.map((job) => ({
      ...job,
      strategy: this.parseStrategy(job.strategy),
      targetQuery: this.parseJsonMaybe(job.targetQuery)
    }))
  }

  parseJsonMaybe(value) {
    if (!value) return null
    if (typeof value !== 'string') return value
    try {
      return JSON.parse(value)
    } catch (e) {
      return null
    }
  }

  parseStrategy(strategy) {
    const parsed = this.parseJsonMaybe(strategy)
    return parsed || {}
  }
}

if (!orchestratorInstance) {
  orchestratorInstance = new JobOrchestrator()
  global.__orchestrator_instance = orchestratorInstance
}

const orchestrator = orchestratorInstance

module.exports = { orchestrator }
