import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const machines = await prisma.machine.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        hostname: true,
        ip: true,
        osInfo: true,
        status: true,
        lastSeen: true
      }
    })

    if (machines.length === 0) {
      return NextResponse.json({ machines: [] })
    }

    const machineIds = machines.map((m) => m.id)

    type MetricRow = {
      machineId: string
      cpuUsage: number
      ramUsage: number
      ramTotal: number
      ramUsed: number
      diskUsage: number
      diskTotal: number
      diskUsed: number
      uptime: number
    }

    const [metricsRows, securityEvents] = await Promise.all([
      prisma.$queryRaw<MetricRow[]>`
        SELECT m."machineId",
               m."cpuUsage",
               m."ramUsage",
               m."ramTotal",
               m."ramUsed",
               m."diskUsage",
               m."diskTotal",
               m."diskUsed",
               m."uptime"
        FROM "Metric" m
        INNER JOIN (
          SELECT "machineId", MAX("timestamp") AS "maxTs"
          FROM "Metric"
          WHERE "machineId" IN (${Prisma.join(machineIds)})
          GROUP BY "machineId"
        ) latest
        ON m."machineId" = latest."machineId" AND m."timestamp" = latest."maxTs"
      `,
      prisma.securityEvent.findMany({
        where: {
          machineId: { in: machineIds },
          status: { in: ['open', 'ack'] }
        },
        select: { machineId: true, severity: true }
      })
    ])

    const metricsByMachine = new Map<string, MetricRow>()
    for (const row of metricsRows) {
      metricsByMachine.set(row.machineId, row)
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
      const metrics = metricsByMachine.get(m.id)
      const security = securitySummary.get(m.id) || { count: 0, highest: 'info' }
      return {
        ...m,
        metrics: metrics ? [metrics] : [],
        openSecurityEvents: security.count,
        highestSeverity: security.count > 0 ? security.highest : null
      }
    })

    return NextResponse.json({ machines: machinesWithSummary })
  } catch (error) {
    console.error('Error fetching machines:', error)
    return NextResponse.json(
      { error: 'Failed to fetch machines' },
      { status: 500 }
    )
  }
}
