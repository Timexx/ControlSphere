import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

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
        lastSeen: true,
        notes: true,
        createdAt: true,
        updatedAt: true,
        // Explicitly exclude secretKey and secretKeyHash
        metrics: {
          orderBy: { timestamp: 'desc' },
          take: 1,
        },
        securityEvents: {
          where: { status: { in: ['open', 'ack'] } },
          select: { id: true, severity: true }
        }
      },
    })

    // Transform to include security summary
    const machinesWithSecurity = machines.map(m => {
      const openEvents = m.securityEvents.length
      const severityOrder = ['info', 'low', 'medium', 'high', 'critical']
      let highestSeverity = 'info'
      for (const evt of m.securityEvents) {
        if (severityOrder.indexOf(evt.severity) > severityOrder.indexOf(highestSeverity)) {
          highestSeverity = evt.severity
        }
      }
      const { securityEvents, ...rest } = m
      return {
        ...rest,
        openSecurityEvents: openEvents,
        highestSeverity: openEvents > 0 ? highestSeverity : null
      }
    })

    return NextResponse.json({ machines: machinesWithSecurity })
  } catch (error) {
    console.error('Error fetching machines:', error)
    return NextResponse.json(
      { error: 'Failed to fetch machines' },
      { status: 500 }
    )
  }
}
