import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const criticalFilter = {
      cve: { severity: { equals: 'critical' } }
    }
    const highFilter = {
      cve: { severity: { equals: 'high' } }
    }

    const [critical, high, affectedMachineRows] = await Promise.all([
      prisma.vulnerabilityMatch.count({ where: criticalFilter }),
      prisma.vulnerabilityMatch.count({ where: highFilter }),
      prisma.vulnerabilityMatch.groupBy({
        by: ['machineId'],
        where: criticalFilter
      })
    ])

    return NextResponse.json({
      critical,
      high,
      affectedMachines: affectedMachineRows.length
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return NextResponse.json(
        { critical: 0, high: 0, affectedMachines: 0, warning: `Database error (${error.code})` },
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
