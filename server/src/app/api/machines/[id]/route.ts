import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { stateCache } from '@/lib/state-cache'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Fast path: serve base data from cache, enrich with commands/links from DB
    const cached = stateCache.ready ? stateCache.getMachine(params.id) : null
    if (cached) {
      const [commands, links] = await Promise.all([
        prisma.command.findMany({
          where: { machineId: params.id },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
        prisma.machineLink.findMany({
          where: { machineId: params.id },
          orderBy: { createdAt: 'desc' },
        }),
      ])
      return NextResponse.json({
        machine: {
          id: cached.id,
          hostname: cached.hostname,
          ip: cached.ip,
          osInfo: cached.osInfo,
          status: cached.status,
          lastSeen: cached.lastSeen,
          notes: cached.notes,
          createdAt: cached.createdAt,
          updatedAt: cached.updatedAt,
          metrics: cached.latestMetric ? [cached.latestMetric] : [],
          commands,
          ports: cached.ports,
          links,
        },
      })
    }

    // Fallback: full DB query
    const machine = await prisma.machine.findUnique({
      where: { id: params.id },
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
        },
        commands: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
        ports: {
          orderBy: [
            { port: 'asc' },
            { proto: 'asc' }
          ],
          select: {
            port: true,
            proto: true,
            service: true,
            state: true
          }
        },
        links: {
          orderBy: { createdAt: 'desc' }
        }
      },
    })

    if (!machine) {
      return NextResponse.json(
        { error: 'Machine not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ machine })
  } catch (error) {
    console.error('Error fetching machine:', error)
    return NextResponse.json(
      { error: 'Failed to fetch machine' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json()
    const notes = typeof body.notes === 'string' ? body.notes : ''

    const machine = await prisma.machine.findUnique({
      where: { id: params.id },
      select: { id: true }
    })

    if (!machine) {
      return NextResponse.json(
        { error: 'Machine not found' },
        { status: 404 }
      )
    }

    const updated = await prisma.machine.update({
      where: { id: params.id },
      data: { notes },
      select: {
        id: true,
        notes: true,
        updatedAt: true
      }
    })

    // Write-through: update cache so subsequent reads are fresh
    const cached = stateCache.getMachine(params.id)
    if (cached) {
      cached.notes = updated.notes
      cached.updatedAt = updated.updatedAt
    }

    return NextResponse.json({
      id: updated.id,
      notes: updated.notes,
      updatedAt: updated.updatedAt
    })
  } catch (error) {
    console.error('Error updating machine notes:', error)
    return NextResponse.json(
      { error: 'Failed to update notes' },
      { status: 500 }
    )
  }
}
