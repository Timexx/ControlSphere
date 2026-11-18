import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { guardMachineAccess } from '@/lib/route-guards'

// This endpoint triggers a security scan on the specified machine
// ISO 27001 A.12.6.1: Technical vulnerability management
// ISO 27001 A.18.2.2: Compliance with security policies and standards

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: machineId } = await params
  const guard = await guardMachineAccess(machineId, 'write')
  if (!guard.ok) return guard.response
  const sessionUser = guard.user
  try {
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
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    const userAgent = request.headers.get('user-agent') || 'unknown'

    try {
      await prisma.auditLog.create({
        data: {
          action: 'SECURITY_SCAN_TRIGGERED',
          eventType: 'security_scan',
          userId: sessionUser.id,
          machineId: machine.id,
          severity: 'info',
          details: JSON.stringify({
            hostname: machine.hostname,
            triggeredBy: sessionUser.username || sessionUser.id,
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
