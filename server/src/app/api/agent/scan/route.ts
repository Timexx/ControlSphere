import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { realtimeEvents } from '@/lib/realtime-events'
import { refreshSecurityCacheForMachine } from '@/lib/state-cache'
import { scanPackages } from '@/services/vulnerability-scanner'
import { clearScanProgress } from '@/lib/scan-progress-store'

const INTEGRITY_IGNORE_PATTERNS = [
  /^\/var\/log\/.*/i,
  /^\/var\/log\/journal\/.*/i,
  /^\/var\/lib\/docker\/containers\/.*/i,
  /^\/var\/cache\/apt\/.*/i,
  /^\/var\/lib\/apt\/.*/i,
  /^\/var\/lib\/dpkg\/.*/i,
  /^\/var\/tmp\/.*/i,
  /^\/root\/\.pm2\/logs\/.*/i
]
const INTEGRITY_COOLDOWN_MS = 15 * 60 * 1000 // 15 minutes

function hashSecretKey(secret: string) {
  return crypto.createHash('sha256').update(secret).digest('hex')
}

async function verifyAgent(machineId: string, providedSecret: string | undefined) {
  if (!providedSecret) {
    return { ok: false, status: 401, message: 'Missing agent secret' as const }
  }

  const machine = await prisma.machine.findUnique({
    where: { id: machineId },
    select: { id: true, secretKey: true, secretKeyHash: true }
  })

  if (!machine) {
    return { ok: false, status: 404, message: 'Machine not found' as const }
  }

  const hashed = hashSecretKey(providedSecret)
  const valid =
    (machine.secretKeyHash && machine.secretKeyHash === hashed) ||
    (machine.secretKey && machine.secretKey === providedSecret)

  if (!valid) {
    return { ok: false, status: 401, message: 'Invalid agent secret' as const }
  }

  return { ok: true, machine }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const machineId = body.machineId as string
    const packages = Array.isArray(body.packages) ? body.packages : []
    const configFindings = Array.isArray(body.configFindings) ? body.configFindings : []
    const integrityFindings = Array.isArray(body.integrityFindings) ? body.integrityFindings : []
    const extraEvents = Array.isArray(body.events) ? body.events : []
    const reportedPathsRaw = Array.isArray(body.cveScanPaths)
      ? body.cveScanPaths
      : Array.isArray(body.scanPaths)
        ? body.scanPaths
        : Array.isArray(body.paths)
          ? body.paths
          : []
    const reportedPaths = reportedPathsRaw
      .filter((p: any) => typeof p === 'string')
      .map((p: string) => p.trim())
      .filter(Boolean)
    const providedSecret =
      request.headers.get('x-agent-secret') ||
      (typeof body.secretKey === 'string' ? body.secretKey : undefined)

    if (!machineId) {
      return NextResponse.json({ error: 'machineId required' }, { status: 400 })
    }

    const auth = await verifyAgent(machineId, providedSecret)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.message }, { status: auth.status })
    }

    const summaryObj = body.summary && typeof body.summary === 'object'
      ? body.summary
      : {
          total: packages.length,
          updates: packages.filter((p: any) => p?.status === 'update_available').length,
          securityUpdates: packages.filter((p: any) => p?.status === 'security_update').length
        }

    const mergedSummary = {
      ...summaryObj,
      paths: Array.isArray(summaryObj?.paths)
        ? summaryObj.paths.filter((p: any) => typeof p === 'string' && p.trim())
        : reportedPaths
    }

    const summary = JSON.stringify(mergedSummary)

    const scan = await prisma.packageScan.create({
      data: {
        machineId,
        summary
      }
    })

    // Collect all package names from current scan for cleanup
    const currentPackageNames = new Set<string>()
    const scanTime = new Date()

    // Batch upserts in a single transaction to avoid N+1
    const upsertOps = []
    for (const pkg of packages) {
      if (!pkg?.name || !pkg?.version) continue
      currentPackageNames.add(pkg.name)
      upsertOps.push(
        prisma.vMPackage.upsert({
          where: {
            machineId_name: {
              machineId,
              name: pkg.name
            }
          },
          update: {
            version: pkg.version,
            manager: pkg.manager || null,
            status: pkg.status || 'installed',
            cveIds: pkg.cveIds ? JSON.stringify(pkg.cveIds) : null,
            lastSeen: scanTime,
            scanId: scan.id
          },
          create: {
            machineId,
            name: pkg.name,
            version: pkg.version,
            manager: pkg.manager || null,
            status: pkg.status || 'installed',
            cveIds: pkg.cveIds ? JSON.stringify(pkg.cveIds) : null,
            scanId: scan.id
          }
        })
      )
    }

    // Execute all upserts in batches of 50 within a transaction
    for (let i = 0; i < upsertOps.length; i += 50) {
      await prisma.$transaction(upsertOps.slice(i, i + 50))
    }

    // Remove packages that were not in this scan (no longer installed)
    // Only delete if we received at least some packages (to avoid accidental wipe on failed scans)
    if (packages.length > 0) {
      const deleted = await prisma.vMPackage.deleteMany({
        where: {
          machineId,
          lastSeen: {
            lt: scanTime
          }
        }
      })
      if (deleted.count > 0) {
        console.log(`Removed ${deleted.count} stale packages for machine ${machineId}`)
      }
    }

    // Update scan summary with actual package count from DB
    const statusCounts = await prisma.vMPackage.groupBy({
      by: ['status'],
      where: { machineId },
      _count: { _all: true }
    })
    let actualPackageCount = 0
    let actualUpdates = 0
    let actualSecurityUpdates = 0
    for (const row of statusCounts) {
      actualPackageCount += row._count._all
      if (row.status === 'update_available') {
        actualUpdates = row._count._all
      } else if (row.status === 'security_update') {
        actualSecurityUpdates = row._count._all
      }
    }

    const actualSummary = {
      ...mergedSummary,
      total: actualPackageCount,
      updates: actualUpdates,
      securityUpdates: actualSecurityUpdates
    }

    // Update the scan with accurate summary
    await prisma.packageScan.update({
      where: { id: scan.id },
      data: { summary: JSON.stringify(actualSummary) }
    })

    const machinePackages = await prisma.vMPackage.findMany({
      where: { machineId },
      select: {
        id: true,
        machineId: true,
        name: true,
        version: true,
        manager: true
      }
    })

    const vulnerabilityResult = await scanPackages(
      machinePackages.map((pkg) => ({
        id: pkg.id,
        machineId: pkg.machineId,
        name: pkg.name,
        version: pkg.version,
        manager: pkg.manager
      }))
    )

    const criticalVulns = vulnerabilityResult.matches.filter((m) => m.severity === 'critical').length
    const highVulns = vulnerabilityResult.matches.filter((m) => m.severity === 'high').length

    // Get ALL existing events for this machine (including resolved) to avoid duplicates
    const existingEvents = await prisma.securityEvent.findMany({
      where: {
        machineId
      },
      select: {
        id: true,
        type: true,
        message: true,
        data: true,
        status: true,
        updatedAt: true
      },
      orderBy: { createdAt: 'desc' }
    })

    // Separate open events for quick lookup
    const existingOpenEvents = existingEvents.filter(e => e.status === 'open' || e.status === 'ack')

    // Create a set of existing event signatures for quick lookup
    const existingSignatures = new Set(
      existingOpenEvents.map(e => `${e.type}:${e.message}`)
    )

    const eventsToCreate: any[] = []
    const eventsToUpdate: string[] = [] // IDs of existing events to update timestamp

    for (const finding of configFindings) {
      const signature = `drift:${finding.message || `Config drift detected at ${finding.targetPath || 'unknown path'}`}`
      
      // Check if similar event already exists
      const existingEvent = existingOpenEvents.find(e => 
        e.type === 'drift' && 
        (e.message === finding.message || 
         (finding.targetPath && e.message?.includes(finding.targetPath)))
      )
      
      if (existingEvent) {
        eventsToUpdate.push(existingEvent.id)
      } else {
        eventsToCreate.push({
          machineId,
          policyId: finding.policyId || null,
          type: 'drift',
          severity: finding.severity || 'medium',
          message: finding.message || `Config drift detected at ${finding.targetPath || 'unknown path'}`,
          data: JSON.stringify(finding),
        })
      }
    }

    for (const finding of integrityFindings) {
      const path = typeof finding.targetPath === 'string' ? finding.targetPath : undefined
      if (path && INTEGRITY_IGNORE_PATTERNS.some((re) => re.test(path))) {
        continue
      }

      // Check if similar event already exists
      const existingEvent = existingOpenEvents.find(e => 
        e.type === 'integrity' && 
        (e.message === finding.message || 
         (finding.targetPath && e.message?.includes(finding.targetPath)))
      )
      
      if (existingEvent) {
        const withinCooldown =
          existingEvent.updatedAt &&
          Date.now() - new Date(existingEvent.updatedAt as any).getTime() < INTEGRITY_COOLDOWN_MS
        if (withinCooldown) continue
        eventsToUpdate.push(existingEvent.id)
      } else {
        eventsToCreate.push({
          machineId,
          policyId: finding.policyId || null,
          type: 'integrity',
          severity: finding.severity || 'high',
          message: finding.message || `Integrity issue detected at ${finding.targetPath || 'unknown path'}`,
          data: JSON.stringify(finding),
        })
      }
    }

    for (const event of extraEvents) {
      const eventMessage = event.message || 'Security event reported by agent'
      const eventType = event.type || 'vulnerability'
      
      // For failed_auth events, check by type and source IP (from data)
      // Search in ALL events (including resolved) to avoid creating duplicates
      let existingEvent
      if (eventType === 'failed_auth' && event.data?.source_ip) {
        // First check in all events (including resolved) for this source_ip
        existingEvent = existingEvents.find(e => {
          if (e.type !== 'failed_auth') return false
          try {
            const existingData = typeof e.data === 'string' ? JSON.parse(e.data) : e.data
            return existingData?.source_ip === event.data.source_ip
          } catch {
            return false
          }
        })
      } else {
        existingEvent = existingOpenEvents.find(e => 
          e.type === eventType && e.message === eventMessage
        )
      }
      
      if (existingEvent) {
        // Update existing event with new data (e.g., updated attempt count)
        eventsToUpdate.push(existingEvent.id)
        // Also update the message and data for failed_auth to reflect new count
        // But PRESERVE the status if user manually marked it as resolved or ack
        if (eventType === 'failed_auth') {
          // Only reopen if status was 'open' - respect user's decision to resolve/ack
          const shouldReopen = existingEvent.status === 'open'
          await prisma.securityEvent.update({
            where: { id: existingEvent.id },
            data: {
              message: eventMessage,
              data: JSON.stringify(event.data || event),
              severity: event.severity || 'medium',
              // Preserve resolved/ack status - don't reopen manually closed events
              status: shouldReopen ? 'open' : existingEvent.status,
              updatedAt: new Date()
            }
          })
        }
      } else {
        eventsToCreate.push({
          machineId,
          policyId: event.policyId || null,
          type: eventType,
          severity: event.severity || 'medium',
          message: eventMessage,
          data: JSON.stringify(event.data || event),
        })
      }
    }

    if (criticalVulns + highVulns > 0) {
      const eventSeverity = criticalVulns > 0 ? 'critical' : 'high'
      const vulnMessage = `Detected ${criticalVulns} critical and ${highVulns} high vulnerabilities`
      const existingVulnerabilityEvent = existingOpenEvents.find(
        (e) => e.type === 'vulnerability'
      )
      const vulnerabilityData = JSON.stringify({
        matches: vulnerabilityResult.matches.slice(0, 20),
        critical: criticalVulns,
        high: highVulns
      })

      if (existingVulnerabilityEvent) {
        await prisma.securityEvent.update({
          where: { id: existingVulnerabilityEvent.id },
          data: {
            severity: eventSeverity,
            message: vulnMessage,
            data: vulnerabilityData,
            updatedAt: new Date()
          }
        })
        eventsToUpdate.push(existingVulnerabilityEvent.id)
      } else {
        eventsToCreate.push({
          machineId,
          policyId: null,
          type: 'vulnerability',
          severity: eventSeverity,
          message: vulnMessage,
          data: vulnerabilityData
        })
      }
    }

    // Update timestamps of existing events that were re-detected
    if (eventsToUpdate.length > 0) {
      await prisma.securityEvent.updateMany({
        where: { id: { in: eventsToUpdate } },
        data: { updatedAt: new Date() }
      })
    }

    if (eventsToCreate.length > 0) {
      // Batch create events in a transaction, then emit real-time updates
      const createdEvents = await prisma.$transaction(
        eventsToCreate.map(evtData => prisma.securityEvent.create({ data: evtData }))
      )
      
      for (const newEvent of createdEvents) {
        realtimeEvents.emitSecurityEvent(machineId, {
          id: newEvent.id,
          type: newEvent.type,
          severity: newEvent.severity,
          message: newEvent.message,
          status: 'open',
          createdAt: newEvent.createdAt.toISOString()
        })
      }
    }

    // Refresh in-memory cache so dashboard cards show current event counts
    await refreshSecurityCacheForMachine(prisma, machineId)

    // Emit scan completed event for real-time update
    realtimeEvents.emitScanCompleted(machineId, scan.id, actualSummary)
    clearScanProgress(machineId)
    await prisma.scanProgressState.deleteMany({ where: { machineId } })

    return NextResponse.json({
      scanId: scan.id,
      packagesProcessed: packages.length,
      packagesInDatabase: actualSummary.total,
      eventsRecorded: eventsToCreate.length,
      vulnerabilitiesDetected: vulnerabilityResult.matches.length,
      criticalVulnerabilities: criticalVulns,
      highVulnerabilities: highVulns,
      summary: actualSummary
    })
  } catch (error) {
    console.error('Error handling agent scan:', error)
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return NextResponse.json(
        { error: 'Database error', code: error.code, message: error.message },
        { status: 500 }
      )
    }
    return NextResponse.json(
      { error: 'Failed to process scan payload' },
      { status: 500 }
    )
  }
}
