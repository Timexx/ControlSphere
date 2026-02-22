import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession, hashPassword } from '@/lib/auth'
import { requireAdmin } from '@/lib/authorization'
import { generateSecurePassword } from '@/lib/crypto'
import { createAuditEntry, AuditActions } from '@/lib/audit'

/**
 * POST /api/admin/users/[id]/reset-password
 * Generate a new password, overwrite the old one.
 * Returns the new password in plaintext (shown once to admin).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession()
    const admin = requireAdmin(session)

    const targetUser = await prisma.user.findUnique({
      where: { id: params.id },
      select: { id: true, username: true },
    })

    if (!targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const newPassword = generateSecurePassword(16)
    const hashedPassword = await hashPassword(newPassword)

    await prisma.user.update({
      where: { id: params.id },
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
      },
    })

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
