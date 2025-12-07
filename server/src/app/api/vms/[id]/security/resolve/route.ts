import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { realtimeEvents } from '@/lib/realtime-events'

// POST: Mark all open security events as resolved for a machine
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const machineId = params.id
    
    // Check if machine exists
    const machine = await prisma.machine.findUnique({
      where: { id: machineId },
      select: { id: true }
    })

    if (!machine) {
      return NextResponse.json({ error: 'Machine not found' }, { status: 404 })
    }

    // Update all open events to resolved
    const result = await prisma.securityEvent.updateMany({
      where: {
        machineId,
        status: { in: ['open', 'ack'] }
      },
      data: {
        status: 'resolved',
        resolvedAt: new Date()
      }
    })

    // Emit realtime event to notify clients
    if (result.count > 0) {
      realtimeEvents.emitSecurityEventsResolved(machineId, result.count)
    }

    return NextResponse.json({
      success: true,
      resolvedCount: result.count,
      message: `${result.count} Events als gelesen markiert`
    })
  } catch (error) {
    console.error('Error resolving security events:', error)
    return NextResponse.json(
      { error: 'Failed to resolve security events' },
      { status: 500 }
    )
  }
}

// PATCH: Mark a single event or batch of events as resolved
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const machineId = params.id
    const body = await request.json()
    const eventIds = body.eventIds as string[] | undefined
    const status = body.status as string || 'resolved'

    if (!['resolved', 'ack', 'open'].includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    let result
    if (eventIds && eventIds.length > 0) {
      // Update specific events
      result = await prisma.securityEvent.updateMany({
        where: {
          machineId,
          id: { in: eventIds }
        },
        data: {
          status,
          ...(status === 'resolved' ? { resolvedAt: new Date() } : {})
        }
      })
    } else {
      // Update all open events
      result = await prisma.securityEvent.updateMany({
        where: {
          machineId,
          status: { in: ['open', 'ack'] }
        },
        data: {
          status,
          ...(status === 'resolved' ? { resolvedAt: new Date() } : {})
        }
      })
    }

    // Emit realtime event if events were resolved
    if (result.count > 0 && status === 'resolved') {
      realtimeEvents.emitSecurityEventsResolved(machineId, result.count)
    }

    return NextResponse.json({
      success: true,
      updatedCount: result.count
    })
  } catch (error) {
    console.error('Error updating security events:', error)
    return NextResponse.json(
      { error: 'Failed to update security events' },
      { status: 500 }
    )
  }
}
