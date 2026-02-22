import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { requireAdmin } from '@/lib/authorization'
import { createAuditEntry, AuditActions } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/users/[id]/machines — Get assigned machines for a user
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession()
    requireAdmin(session)

    const user = await prisma.user.findUnique({
      where: { id: params.id },
      select: { id: true, role: true },
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Admins always have access to all machines — no assignment needed
    if (user.role === 'admin') {
      return NextResponse.json({ machineIds: [], machines: [] })
    }

    const access = await prisma.userMachineAccess.findMany({
      where: { userId: params.id },
      select: {
        machineId: true,
        assignedAt: true,
        machine: {
          select: {
            id: true,
            hostname: true,
            ip: true,
            status: true,
            osInfo: true,
          },
        },
      },
    })

    return NextResponse.json({
      machineIds: access.map((a: { machineId: string; machine: Record<string, unknown>; assignedAt: Date }) => a.machineId),
      machines: access.map((a: { machineId: string; machine: Record<string, unknown>; assignedAt: Date }) => ({
        ...a.machine,
        assignedAt: a.assignedAt,
      })),
    })
  } catch (error: any) {
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('Error fetching user machines:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

/**
 * PUT /api/admin/users/[id]/machines — Set machine assignments (full replace)
 * Body: { machineIds: string[] }
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession()
    const admin = requireAdmin(session)

    const user = await prisma.user.findUnique({
      where: { id: params.id },
      select: { id: true, username: true, role: true },
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Admins always have access to all machines — assignment is not applicable
    if (user.role === 'admin') {
      return NextResponse.json(
        { error: 'Admin users have access to all machines and cannot have individual assignments' },
        { status: 400 }
      )
    }

    const body = await request.json()
    const { machineIds } = body

    if (!Array.isArray(machineIds)) {
      return NextResponse.json(
        { error: 'machineIds must be an array' },
        { status: 400 }
      )
    }

    // Validate that all machine IDs exist
    if (machineIds.length > 0) {
      const existingMachines = await prisma.machine.findMany({
        where: { id: { in: machineIds } },
        select: { id: true },
      })
      const existingIds = new Set(existingMachines.map((m: { id: string }) => m.id))
      const invalid = machineIds.filter((id: string) => !existingIds.has(id))
      if (invalid.length > 0) {
        return NextResponse.json(
          { error: `Invalid machine IDs: ${invalid.join(', ')}` },
          { status: 400 }
        )
      }
    }

    // Get current assignments for audit diff
    const currentAccess = await prisma.userMachineAccess.findMany({
      where: { userId: params.id },
      select: { machineId: true },
    })
    const currentIdArr: string[] = currentAccess.map((a: { machineId: string }) => a.machineId)
    const currentIds = new Set<string>(currentIdArr)
    const newIds = new Set<string>(machineIds as string[])

    const added = machineIds.filter((id: string) => !currentIds.has(id))
    const removed = currentIdArr.filter((id: string) => !newIds.has(id))

    // Transactional replace: delete all current, insert new
    await prisma.$transaction([
      prisma.userMachineAccess.deleteMany({
        where: { userId: params.id },
      }),
      ...(machineIds.length > 0
        ? [
            prisma.userMachineAccess.createMany({
              data: machineIds.map((machineId: string) => ({
                userId: params.id,
                machineId,
                assignedBy: admin.id,
              })),
            }),
          ]
        : []),
    ])

    // Audit log with diff
    await createAuditEntry({
      action: AuditActions.USER_MACHINE_ACCESS_UPDATED,
      userId: admin.id,
      severity: 'info',
      details: {
        targetUserId: user.id,
        targetUsername: user.username,
        machinesAdded: added,
        machinesRemoved: removed,
        totalAssigned: machineIds.length,
        changedBy: admin.username,
      },
    })

    return NextResponse.json({
      success: true,
      machineIds,
      added: added.length,
      removed: removed.length,
    })
  } catch (error: any) {
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('Error updating user machines:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
