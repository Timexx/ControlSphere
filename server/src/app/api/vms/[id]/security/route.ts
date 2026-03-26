import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getScanProgress } from '@/lib/scan-progress-store'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const machine = await prisma.machine.findUnique({
      where: { id },
      select: { id: true, hostname: true, osInfo: true }
    })

    if (!machine) {
      return NextResponse.json({ error: 'Machine not found' }, { status: 404 })
    }

    const [events, openEventCount, auditLogs, lastScan, ports, vulnerabilities] = await Promise.all([
      prisma.securityEvent.findMany({
        where: { machineId: id },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.securityEvent.count({
        where: { machineId: id, status: { in: ['open', 'ack'] } },
      }),
      prisma.auditLog.findMany({
        where: { machineId: id },
        orderBy: { createdAt: 'desc' },
        take: 50
      }),
      prisma.packageScan.findFirst({
        where: { machineId: id },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.port.findMany({
        where: { machineId: id },
        orderBy: { port: 'asc' }
      }),
      prisma.vulnerabilityMatch.findMany({
        where: { machineId: id },
        orderBy: { createdAt: 'desc' },
        include: {
          cve: true,
          package: true
        }
      })
    ])

    let scanProgress = getScanProgress(id)
    if (!scanProgress) {
      const dbProgress = await prisma.scanProgressState.findUnique({
        where: { machineId: id }
      })
      if (dbProgress) {
        scanProgress = {
          progress: dbProgress.progress,
          phase: dbProgress.phase,
          etaSeconds: dbProgress.etaSeconds,
          startedAt: dbProgress.startedAt.toISOString(),
          updatedAt: dbProgress.updatedAt.toISOString()
        }
      }
    }

    return NextResponse.json({
      machine,
      openEvents: openEventCount,
      events,
      auditLogs,
      lastScan,
      ports,
      vulnerabilities,
      scanProgress
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return NextResponse.json({
        machine: { id, hostname: null },
        openEvents: 0,
        events: [],
        auditLogs: [],
        lastScan: null,
        vulnerabilities: [],
        scanProgress: null,
        warning: `Database error (${error.code})`
      }, { status: 500 })
    }
    console.error('Error fetching VM security data:', error)
    return NextResponse.json(
      { error: 'Failed to fetch security data' },
      { status: 500 }
    )
  }
}
