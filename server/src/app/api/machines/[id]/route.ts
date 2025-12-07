import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
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
          take: 50,
        },
        commands: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
        ports: {
          orderBy: [
            { port: 'asc' },
            { proto: 'asc' }
          ]
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
