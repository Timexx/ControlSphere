/**
 * In-Memory State Cache
 *
 * Holds the most-queried data (machines, latest metric, ports, security-event
 * summaries) in RAM so that API reads return in ~0 ms without touching the DB.
 *
 * Write-through: every DB write that touches cached data also updates the cache
 * so clients always see fresh state.
 *
 * The cache is warmed once at server startup via `warmCache(prisma)`.
 */
import type { PrismaClient } from '@prisma/client'

// ── Types ──────────────────────────────────────────────────────────────
export interface CachedMetric {
  cpuUsage: number
  ramUsage: number
  ramTotal: number
  ramUsed: number
  diskUsage: number
  diskTotal: number
  diskUsed: number
  uptime: number
}

export interface CachedPort {
  port: number
  proto: string
  service: string
  state: string
}

export interface CachedMachine {
  id: string
  hostname: string
  ip: string
  osInfo: string | null
  status: string
  lastSeen: Date
  notes: string | null
  createdAt: Date
  updatedAt: Date
  latestMetric: CachedMetric | null
  ports: CachedPort[]
  openSecurityEvents: number
  highestSeverity: string | null
}

// ── Singleton store ────────────────────────────────────────────────────
const globalForCache = globalThis as unknown as { __stateCache?: StateCache }

class StateCache {
  /** machineId → full cached state */
  private machines = new Map<string, CachedMachine>()
  private _ready = false

  get ready() {
    return this._ready
  }

  // ── Warm the cache from DB at startup ──────────────────────────────
  async warmCache(prisma: PrismaClient): Promise<void> {
    const t0 = Date.now()

    const [allMachines, latestMetrics, allPorts, openEvents] = await Promise.all([
      prisma.machine.findMany({
        select: {
          id: true,
          hostname: true,
          ip: true,
          osInfo: true,
          status: true,
          lastSeen: true,
          notes: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      // One metric per machine (latest) — uses the composite index [machineId, timestamp]
      prisma.$queryRaw<Array<{
        machineId: string
        cpuUsage: number
        ramUsage: number
        ramTotal: number
        ramUsed: number
        diskUsage: number
        diskTotal: number
        diskUsed: number
        uptime: number
      }>>`
        SELECT DISTINCT ON ("machineId")
          "machineId", "cpuUsage", "ramUsage", "ramTotal", "ramUsed",
          "diskUsage", "diskTotal", "diskUsed", "uptime"
        FROM "Metric"
        ORDER BY "machineId", "timestamp" DESC
      `,
      prisma.port.findMany({
        select: { machineId: true, port: true, proto: true, service: true, state: true },
      }),
      prisma.securityEvent.findMany({
        where: { status: { in: ['open', 'ack'] } },
        select: { machineId: true, severity: true },
      }),
    ])

    // Build lookup maps
    const metricMap = new Map<string, CachedMetric>()
    for (const m of latestMetrics) {
      metricMap.set(m.machineId, {
        cpuUsage: m.cpuUsage,
        ramUsage: m.ramUsage,
        ramTotal: m.ramTotal,
        ramUsed: m.ramUsed,
        diskUsage: m.diskUsage,
        diskTotal: m.diskTotal,
        diskUsed: m.diskUsed,
        uptime: m.uptime,
      })
    }

    const portMap = new Map<string, CachedPort[]>()
    for (const p of allPorts) {
      const list = portMap.get(p.machineId) ?? []
      list.push({ port: p.port, proto: p.proto, service: p.service, state: p.state })
      portMap.set(p.machineId, list)
    }

    const sevOrder: Record<string, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 }
    const eventMap = new Map<string, { count: number; highest: string }>()
    for (const evt of openEvents) {
      const cur = eventMap.get(evt.machineId) ?? { count: 0, highest: 'info' }
      cur.count += 1
      if ((sevOrder[evt.severity] ?? 0) > (sevOrder[cur.highest] ?? 0)) {
        cur.highest = evt.severity
      }
      eventMap.set(evt.machineId, cur)
    }

    // Populate cache
    this.machines.clear()
    for (const m of allMachines) {
      const sec = eventMap.get(m.id)
      this.machines.set(m.id, {
        ...m,
        latestMetric: metricMap.get(m.id) ?? null,
        ports: portMap.get(m.id) ?? [],
        openSecurityEvents: sec?.count ?? 0,
        highestSeverity: sec ? sec.highest : null,
      })
    }

    this._ready = true
    console.log(`[StateCache] warmed ${this.machines.size} machines in ${Date.now() - t0}ms`)
  }

  // ── Read helpers (0 ms) ────────────────────────────────────────────
  getMachines(): CachedMachine[] {
    return Array.from(this.machines.values())
  }

  getMachine(id: string): CachedMachine | undefined {
    return this.machines.get(id)
  }

  // ── Write-through helpers (called after DB writes) ─────────────────

  /** Called after heartbeat status update */
  updateMachineStatus(machineId: string, status: string, lastSeen: Date): void {
    const m = this.machines.get(machineId)
    if (m) {
      m.status = status
      m.lastSeen = lastSeen
    }
  }

  /** Called after metric.create */
  updateMetric(machineId: string, metric: CachedMetric): void {
    const m = this.machines.get(machineId)
    if (m) {
      m.latestMetric = metric
    }
  }

  /** Called after port upsert transaction */
  updatePorts(machineId: string, ports: CachedPort[]): void {
    const m = this.machines.get(machineId)
    if (m) {
      m.ports = ports
    }
  }

  /** Called when a machine is created or updated (registration) */
  upsertMachine(machine: {
    id: string
    hostname: string
    ip: string
    osInfo: string | null
    status: string
    lastSeen: Date
    notes: string | null
    createdAt: Date
    updatedAt: Date
  }): void {
    const existing = this.machines.get(machine.id)
    this.machines.set(machine.id, {
      ...machine,
      latestMetric: existing?.latestMetric ?? null,
      ports: existing?.ports ?? [],
      openSecurityEvents: existing?.openSecurityEvents ?? 0,
      highestSeverity: existing?.highestSeverity ?? null,
    })
  }

  /** Called when a machine goes offline */
  setOffline(machineId: string): void {
    const m = this.machines.get(machineId)
    if (m) {
      m.status = 'offline'
    }
  }

  /** Called when a machine is deleted */
  deleteMachine(machineId: string): void {
    this.machines.delete(machineId)
  }

  /** Increment or refresh security event counts — call after event writes */
  refreshSecurityEvents(machineId: string, openCount: number, highest: string | null): void {
    const m = this.machines.get(machineId)
    if (m) {
      m.openSecurityEvents = openCount
      m.highestSeverity = highest
    }
  }
}

// Ensure only one instance across hot-reloads
export const stateCache: StateCache = globalForCache.__stateCache ?? new StateCache()
globalForCache.__stateCache = stateCache

/**
 * Query current open security-event counts for a machine and update the
 * in-memory state cache.  Call this after any DB write that creates or
 * resolves security events so the dashboard cards stay accurate.
 */
export async function refreshSecurityCacheForMachine(
  prisma: PrismaClient,
  machineId: string,
): Promise<void> {
  const sevOrder: Record<string, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 }

  const openEvents = await prisma.securityEvent.findMany({
    where: { machineId, status: { in: ['open', 'ack'] } },
    select: { severity: true },
  })

  let highest: string | null = null
  for (const evt of openEvents) {
    if (highest === null || (sevOrder[evt.severity] ?? 0) > (sevOrder[highest] ?? 0)) {
      highest = evt.severity
    }
  }

  stateCache.refreshSecurityEvents(machineId, openEvents.length, highest)
}
