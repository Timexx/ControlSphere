import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { stateCache } from '@/lib/state-cache'
import { getSession } from '@/lib/auth'
import { getAccessibleMachineIds, filterMachinesByAccess } from '@/lib/authorization'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // Get session for role-based filtering
    const session = await getSession()
    const userId = session?.user?.id
    const role = session?.user?.role || 'viewer'
    const accessibleIds = userId
      ? await getAccessibleMachineIds(userId, role as any)
      : []

    // Serve from in-memory cache when warm (~0 ms)
    if (stateCache.ready) {
      let machines = stateCache.getMachines()
      // Sort by createdAt ascending to match DB path ordering
      machines.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())

      // Filter by access
      machines = filterMachinesByAccess(machines, accessibleIds)

      const machinesWithSummary = machines.map((m) => ({
        id: m.id,
        hostname: m.hostname,
        ip: m.ip,
        osInfo: m.osInfo,
        status: m.status,
        lastSeen: m.lastSeen,
        metrics: m.latestMetric ? [m.latestMetric] : [],
        openSecurityEvents: m.openSecurityEvents,
        highestSeverity: m.highestSeverity,
      }))
      return NextResponse.json({ machines: machinesWithSummary })
    }

    // Fallback: DB query (only before cache is warm)
    const [machines, securityEvents] = await Promise.all([
      prisma.machine.findMany({
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          hostname: true,
          ip: true,
          osInfo: true,
          status: true,
          lastSeen: true,
          metrics: {
            orderBy: { timestamp: 'desc' },
            take: 1,
            select: {
              cpuUsage: true,
              ramUsage: true,
              ramTotal: true,
              ramUsed: true,
              diskUsage: true,
              diskTotal: true,
              diskUsed: true,
              uptime: true
            }
          }
        }
      }),
      prisma.securityEvent.findMany({
        where: { status: { in: ['open', 'ack'] } },
        select: { machineId: true, severity: true }
      })
    ])

    if (machines.length === 0) {
      return NextResponse.json({ machines: [] })
    }

    const severityOrder = ['info', 'low', 'medium', 'high', 'critical']
    const securitySummary = new Map<string, { count: number; highest: string }>()
    for (const evt of securityEvents) {
      const current = securitySummary.get(evt.machineId) || { count: 0, highest: 'info' }
      current.count += 1
      if (severityOrder.indexOf(evt.severity) > severityOrder.indexOf(current.highest)) {
        current.highest = evt.severity
      }
      securitySummary.set(evt.machineId, current)
    }

    const machinesWithSummary = machines.map((m) => {
      const security = securitySummary.get(m.id) || { count: 0, highest: 'info' }
      return {
        ...m,
        openSecurityEvents: security.count,
        highestSeverity: security.count > 0 ? security.highest : null
      }
    })

    // Filter by user access
    const filtered = filterMachinesByAccess(machinesWithSummary, accessibleIds)

    return NextResponse.json({ machines: filtered })
  } catch (error) {
    console.error('Error fetching machines:', error)
    return NextResponse.json(
      { error: 'Failed to fetch machines' },
      { status: 500 }
    )
  }
}
