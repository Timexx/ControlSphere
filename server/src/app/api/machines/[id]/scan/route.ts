import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

// This endpoint triggers a security scan on the specified machine
// ISO 27001 A.12.6.1: Technical vulnerability management
// ISO 27001 A.18.2.2: Compliance with security policies and standards

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const machineId = params.id
    
    // Get authenticated session
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Verify machine exists
    const machine = await prisma.machine.findUnique({
      where: { id: machineId },
      select: { id: true, status: true, hostname: true }
    })

    if (!machine) {
      return NextResponse.json(
        { error: 'Machine not found' },
        { status: 404 }
      )
    }

    if (machine.status !== 'online') {
      return NextResponse.json(
        { error: 'Machine is offline', status: machine.status },
        { status: 400 }
      )
    }

    // Audit log for scan trigger
    // ISO 27001 A.12.4.1: Event logging
    const ip = request.ip || request.headers.get('x-forwarded-for') || 'unknown'
    const userAgent = request.headers.get('user-agent') || 'unknown'

    try {
      await prisma.auditLog.create({
        data: {
          action: 'SECURITY_SCAN_TRIGGERED',
          eventType: 'security_scan',
          userId: session.user.id,
          machineId: machine.id,
          severity: 'info',
          details: JSON.stringify({
            hostname: machine.hostname,
            triggeredBy: session.user.username || session.user.id,
            ip,
            userAgent,
            timestamp: new Date().toISOString()
          })
        } as any
      })
    } catch (auditError) {
      console.error('Audit log failed for security scan trigger:', auditError)
      // Continue even if audit fails - scan should still execute
    }

    // Return success - frontend will trigger scan via authenticated WebSocket
    return NextResponse.json({
      success: true,
      action: 'trigger_scan',
      machineId: machine.id,
      hostname: machine.hostname,
      message: 'Scan request received. Trigger via WebSocket connection.'
    })
  } catch (error) {
    console.error('Error requesting scan:', error)
    return NextResponse.json(
      { error: 'Failed to request scan' },
      { status: 500 }
    )
  }
}
