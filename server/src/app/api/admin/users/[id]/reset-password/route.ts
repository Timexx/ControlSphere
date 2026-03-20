import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession, hashPassword } from '@/lib/auth'
import { requireAdmin } from '@/lib/authorization'
import { generateSecurePassword } from '@/lib/crypto'
import { createAuditEntry, AuditActions } from '@/lib/audit'

/**
 * POST /api/admin/users/[id]/reset-password
 * Reset a user's password. If a `password` field is supplied in the body
 * (admin resetting their own account), it is used directly. Otherwise a
 * secure random password is generated and returned in the response.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const session = await getSession()
    const admin = requireAdmin(session)

    const targetUser = await prisma.user.findUnique({
      where: { id },
      select: { id: true, username: true },
    })

    if (!targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Try to read an optional custom password from the request body
    let customPassword: string | undefined
    try {
      const body = await request.json()
      if (typeof body.password === 'string') {
        customPassword = body.password
      }
    } catch {
      // No body or non-JSON — use generated password
    }

    if (customPassword !== undefined) {
      // Custom password path: only allowed when resetting own account
      if (id !== admin.id) {
        return NextResponse.json(
          { error: 'Custom password can only be set for your own account' },
          { status: 403 }
        )
      }
      if (customPassword.length < 8 || customPassword.length > 128) {
        return NextResponse.json(
          { error: 'Password must be between 8 and 128 characters' },
          { status: 400 }
        )
      }
    }

    const newPassword = customPassword ?? generateSecurePassword(16)
    const hashedPassword = await hashPassword(newPassword)

    await prisma.user.update({
      where: { id },
      data: { password: hashedPassword },
    })

    await createAuditEntry({
      action: AuditActions.USER_PASSWORD_RESET,
      userId: admin.id,
      severity: 'warn',
      details: {
        targetUserId: targetUser.id,
        targetUsername: targetUser.username,
        resetBy: admin.username,
        selfReset: id === admin.id,
      },
    })

    // For self-resets the admin already knows the password — no need to expose it
    if (customPassword !== undefined) {
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({
      generatedPassword: newPassword, // Shown once, never stored in plaintext
    })
  } catch (error: any) {
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('Error resetting password:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
