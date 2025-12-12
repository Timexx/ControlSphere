import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

const severityRank: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0
}

export async function GET() {
  try {
    const machines = await prisma.machine.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        hostname: true,
        status: true,
        lastSeen: true
      }
    })

    // Fetch events/scans independently so one failure doesn't kill the entire response
    let openEvents: Array<{ machineId: string; severity: string }> = []
    let securityPackages: Array<{ machineId: string }> = []

    try {
      openEvents = await prisma.securityEvent.findMany({
        where: { status: { in: ['open', 'ack'] } },
        select: { machineId: true, severity: true }
      })
    } catch (err) {
      console.error('Error fetching security events (non-fatal):', err)
    }

    try {
      securityPackages = await prisma.vMPackage.findMany({
        where: {
          machineId: { in: machines.map(m => m.id) },
          status: 'security_update'
        },
        select: { machineId: true }
      })
    } catch (err) {
      console.error('Error fetching security update packages (non-fatal):', err)
    }

    const eventSummary = new Map<string, { count: number; highest: string }>()
    for (const evt of openEvents) {
      const current = eventSummary.get(evt.machineId) || { count: 0, highest: 'info' }
      current.count += 1
      if (severityRank[evt.severity] > (severityRank[current.highest] ?? 0)) {
        current.highest = evt.severity
      }
      eventSummary.set(evt.machineId, current)
    }

    // Build security update package summary per machine
    const securityPackageSummary = new Map<string, number>()
    for (const m of machines) {
      securityPackageSummary.set(m.id, 0)
    }
    for (const pkg of securityPackages) {
      const current = securityPackageSummary.get(pkg.machineId) || 0
      securityPackageSummary.set(pkg.machineId, current + 1)
    }

    // Fetch the latest scan per machine using the same method as the detail API
    const latestScan = new Map<string, { createdAt: Date; summary: any; scanId: string }>()
    try {
      await Promise.all(
        machines.map(async (m) => {
          const scan = await prisma.packageScan.findFirst({
            where: { machineId: m.id },
            orderBy: { createdAt: 'desc' },
            select: { id: true, machineId: true, createdAt: true, summary: true }
          })
          if (scan) {
            let parsedSummary: any = null
            if (typeof scan.summary === 'string') {
              try {
                parsedSummary = JSON.parse(scan.summary)
              } catch {
                parsedSummary = scan.summary
              }
            } else {
              parsedSummary = scan.summary
            }
            latestScan.set(scan.machineId, {
              createdAt: scan.createdAt,
              summary: parsedSummary,
              scanId: scan.id
            })
          }
        })
      )
    } catch (err) {
      console.error('Error fetching package scans (non-fatal):', err)
    }

    const items = machines.map((m) => {
      const events = eventSummary.get(m.id) || { count: 0, highest: 'info' }
      const scanInfo = latestScan.get(m.id)
      const pkgCount = securityPackageSummary.get(m.id) ?? 0
      const summaryData = scanInfo?.summary
      const summarySecurityUpdates =
        summaryData && typeof summaryData === 'object' && summaryData !== null && typeof summaryData.securityUpdates === 'number'
          ? summaryData.securityUpdates
          : null
      let securityStatus: 'good' | 'warn' | 'critical' = 'good'
      if (events.count > 0) {
        securityStatus = events.highest === 'critical' || events.highest === 'high'
          ? 'critical'
          : 'warn'
      }

      return {
        machineId: m.id,
        hostname: m.hostname,
        agentStatus: m.status,
        securityStatus,
        openEvents: events.count,
        highestSeverity: events.highest,
        lastScanAt: scanInfo?.createdAt ?? null,
        summary: scanInfo?.summary ?? null,
        // Prefer live package counts (initialized to 0), fall back only if query failed
        securityUpdates: pkgCount ?? (summarySecurityUpdates !== null ? summarySecurityUpdates : 0)
      }
    })

    return NextResponse.json({ items })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2021') {
      // Tables not migrated yet – return empty payload instead of failing build/static generation
      return NextResponse.json({ items: [], warning: 'Security tables not initialized yet' })
    }
    console.error('Error fetching security overview:', error)
    return NextResponse.json(
      { error: 'Failed to fetch security overview' },
      { status: 500 }
    )
  }
}
