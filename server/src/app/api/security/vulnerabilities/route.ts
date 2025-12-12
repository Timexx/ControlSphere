import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const matches = await prisma.vulnerabilityMatch.findMany({
      select: {
        machineId: true,
        cve: {
          select: { severity: true }
        }
      }
    })

    let critical = 0
    let high = 0
    const affectedMachines = new Set<string>()

    for (const match of matches) {
      const severity = (match.cve?.severity || '').toLowerCase()
      if (severity === 'critical') {
        critical += 1
        affectedMachines.add(match.machineId)
      } else if (severity === 'high') {
        high += 1
      }
    }

    return NextResponse.json({
      critical,
      high,
      affectedMachines: affectedMachines.size
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
