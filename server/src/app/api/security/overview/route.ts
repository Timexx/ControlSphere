import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { stateCache } from '@/lib/state-cache'

const severityRank: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0
}

export async function GET() {
  try {
    // Use cache for machine+event data; only hit DB for scan/package info
    const cachedMachines = stateCache.ready ? stateCache.getMachines() : null

    // Fetch machines, events, and packages ALL in parallel
    const [machines, openEvents, securityPackages] = cachedMachines
      ? [cachedMachines, [] as Array<{ machineId: string; severity: string }>, await prisma.vMPackage.findMany({ where: { status: 'security_update' }, select: { machineId: true } }).catch(() => [] as Array<{ machineId: string }>)]
      : await Promise.all([
      prisma.machine.findMany({
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          hostname: true,
          status: true,
          lastSeen: true
        }
      }),
      prisma.securityEvent.findMany({
        where: { status: { in: ['open', 'ack'] } },
        select: { machineId: true, severity: true }
      }).catch((err) => {
        console.error('Error fetching security events (non-fatal):', err)
        return [] as Array<{ machineId: string; severity: string }>
      }),
      prisma.vMPackage.findMany({
        where: { status: 'security_update' },
        select: { machineId: true }
      }).catch((err) => {
        console.error('Error fetching security update packages (non-fatal):', err)
        return [] as Array<{ machineId: string }>
      })
    ])

    const eventSummary = new Map<string, { count: number; highest: string }>()
    if (cachedMachines) {
      // Use cached event summaries directly
      for (const m of cachedMachines) {
        if (m.openSecurityEvents > 0) {
          eventSummary.set(m.id, { count: m.openSecurityEvents, highest: m.highestSeverity ?? 'info' })
        }
      }
    } else {
      for (const evt of openEvents) {
        const current = eventSummary.get(evt.machineId) || { count: 0, highest: 'info' }
        current.count += 1
        if (severityRank[evt.severity] > (severityRank[current.highest] ?? 0)) {
          current.highest = evt.severity
        }
        eventSummary.set(evt.machineId, current)
      }
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

    // Fetch per-machine vulnerability severity breakdown in a single query
    const vulnSeverityMap = new Map<string, { critical: number; high: number; medium: number; low: number; total: number }>()
    try {
      const machineIds = machines.map(m => m.id)
      const vulnMatches = await prisma.vulnerabilityMatch.findMany({
        where: { machineId: { in: machineIds } },
        select: { machineId: true, cve: { select: { severity: true } } }
      })
      for (const vm of vulnMatches) {
        const entry = vulnSeverityMap.get(vm.machineId) || { critical: 0, high: 0, medium: 0, low: 0, total: 0 }
        entry.total += 1
        const sev = (vm.cve?.severity || '').toLowerCase()
        if (sev === 'critical') entry.critical += 1
        else if (sev === 'high') entry.high += 1
        else if (sev === 'medium') entry.medium += 1
        else entry.low += 1
        vulnSeverityMap.set(vm.machineId, entry)
      }
    } catch (err) {
      console.error('Error fetching vulnerability severity breakdown (non-fatal):', err)
    }

    // Fetch the latest scan per machine in a single query (avoid N+1)
    const latestScan = new Map<string, { createdAt: Date; summary: any; scanId: string }>()
    try {
      const machineIds = machines.map(m => m.id)
      const allScans = await prisma.packageScan.findMany({
        where: { machineId: { in: machineIds } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, machineId: true, createdAt: true, summary: true }
      })
      // Keep only the latest scan per machine
      for (const scan of allScans) {
        if (!latestScan.has(scan.machineId)) {
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
      }
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

      const vulns = vulnSeverityMap.get(m.id) || { critical: 0, high: 0, medium: 0, low: 0, total: 0 }

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
        securityUpdates: pkgCount ?? (summarySecurityUpdates !== null ? summarySecurityUpdates : 0),
        vulnerabilities: vulns
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
