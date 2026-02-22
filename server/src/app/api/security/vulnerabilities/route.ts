import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { getAccessibleMachineIds } from '@/lib/authorization'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accessibleIds = await getAccessibleMachineIds(session.user.id, (session.user as any).role || 'user')
    const machineFilter = accessibleIds !== 'all' ? { machineId: { in: accessibleIds } } : {}

    const criticalFilter = {
      ...machineFilter,
      cve: { severity: { equals: 'critical' } }
    }
    const highFilter = {
      ...machineFilter,
      cve: { severity: { equals: 'high' } }
    }

    // Count DISTINCT CVEs (not match rows) to avoid inflated numbers
    // One CVE affecting multiple packages on one machine should count as 1
    const [criticalCves, highCves, affectedMachineRows, criticalEvents] = await Promise.all([
      prisma.vulnerabilityMatch.groupBy({
        by: ['cveId'],
        where: criticalFilter
      }),
      prisma.vulnerabilityMatch.groupBy({
        by: ['cveId'],
        where: highFilter
      }),
      prisma.vulnerabilityMatch.groupBy({
        by: ['machineId'],
        where: criticalFilter
      }),
      // Open security events (drift, integrity, etc.) – shown separately from CVEs
      prisma.securityEvent.count({
        where: {
          ...machineFilter,
          status: { in: ['open', 'ack'] },
          severity: { in: ['critical', 'high'] }
        }
      }).catch(() => 0)
    ])

    return NextResponse.json({
      critical: criticalCves.length,
      high: highCves.length,
      affectedMachines: affectedMachineRows.length,
      criticalEvents
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return NextResponse.json(
        { critical: 0, high: 0, affectedMachines: 0, criticalEvents: 0, warning: `Database error (${error.code})` },
        { status: 500 }
      )
    }
    console.error('Failed to load vulnerability summary:', error)
    return NextResponse.json(
      { error: 'Failed to load vulnerability summary' },
      { status: 500 }
    )
  }
}
