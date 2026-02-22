import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { requireAdmin } from '@/lib/authorization'
import { createAuditEntry, AuditActions } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/users/[id] — Get user details with assigned machines
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
      select: {
        id: true,
        username: true,
        role: true,
        active: true,
        language: true,
        lastLoginAt: true,
        createdBy: true,
        createdAt: true,
        updatedAt: true,
        machineAccess: {
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
        },
      },
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    return NextResponse.json({ user })
  } catch (error: any) {
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('Error fetching user:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

/**
 * PATCH /api/admin/users/[id] — Update user (role, active status)
 * Body: { role?: string, active?: boolean }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession()
    const admin = requireAdmin(session)

    const targetUser = await prisma.user.findUnique({
      where: { id: params.id },
      select: { id: true, username: true, role: true, active: true },
    })

    if (!targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const body = await request.json()
    const updates: Record<string, unknown> = {}
    const auditDetails: Record<string, unknown> = {
      targetUserId: targetUser.id,
      targetUsername: targetUser.username,
      changedBy: admin.username,
    }

    // Role change
    if (body.role !== undefined) {
      const validRoles = ['admin', 'user', 'viewer']
      if (!validRoles.includes(body.role)) {
        return NextResponse.json(
          { error: `Role must be one of: ${validRoles.join(', ')}` },
          { status: 400 }
        )
      }
      // Prevent demoting yourself (last admin protection)
      if (targetUser.id === admin.id && body.role !== 'admin') {
        return NextResponse.json(
          { error: 'Cannot change your own role' },
          { status: 400 }
        )
      }
      if (body.role !== targetUser.role) {
        auditDetails.previousRole = targetUser.role
        auditDetails.newRole = body.role
        updates.role = body.role

        await createAuditEntry({
          action: AuditActions.USER_ROLE_CHANGED,
          userId: admin.id,
          severity: 'warn',
          details: auditDetails,
        })
      }
    }

    // Active toggle
    if (body.active !== undefined && typeof body.active === 'boolean') {
      // Prevent deactivating yourself
      if (targetUser.id === admin.id && !body.active) {
        return NextResponse.json(
          { error: 'Cannot deactivate your own account' },
          { status: 400 }
        )
      }
      if (body.active !== targetUser.active) {
        updates.active = body.active
        await createAuditEntry({
          action: body.active ? AuditActions.USER_ACTIVATED : AuditActions.USER_DEACTIVATED,
          userId: admin.id,
          severity: body.active ? 'info' : 'warn',
          details: {
            targetUserId: targetUser.id,
            targetUsername: targetUser.username,
            changedBy: admin.username,
          },
        })
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No changes provided' }, { status: 400 })
    }

    const updated = await prisma.user.update({
      where: { id: params.id },
      data: updates,
      select: {
        id: true,
        username: true,
        role: true,
        active: true,
        updatedAt: true,
      },
    })

    return NextResponse.json({ user: updated })
  } catch (error: any) {
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('Error updating user:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

/**
 * DELETE /api/admin/users/[id] — Delete a user
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession()
    const admin = requireAdmin(session)

    if (params.id === admin.id) {
      return NextResponse.json(
        { error: 'Cannot delete your own account' },
        { status: 400 }
      )
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: params.id },
      select: { id: true, username: true, role: true },
    })

    if (!targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Delete user (cascades to UserMachineAccess, AuditLog.userId set to null)
    await prisma.user.delete({ where: { id: params.id } })

    await createAuditEntry({
      action: AuditActions.USER_DELETED,
      userId: admin.id,
      severity: 'critical',
      details: {
        deletedUserId: targetUser.id,
        deletedUsername: targetUser.username,
        deletedRole: targetUser.role,
        deletedBy: admin.username,
      },
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('Error deleting user:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
