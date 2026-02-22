import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession, hashPassword } from '@/lib/auth'
import { requireAdmin } from '@/lib/authorization'
import { generateSecurePassword } from '@/lib/crypto'
import { createAuditEntry, AuditActions } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/users — List all users (admin only)
 */
export async function GET() {
  try {
    const session = await getSession()
    const admin = requireAdmin(session)

    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'asc' },
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
        _count: {
          select: { machineAccess: true },
        },
      },
    })

    return NextResponse.json({ users })
  } catch (error: any) {
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('Error listing users:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

/**
 * POST /api/admin/users — Create a new user (admin only)
 * Body: { username: string, role: 'admin' | 'user' | 'viewer' }
 * Returns the created user and the generated password (shown once)
 */
export async function POST(request: Request) {
  try {
    const session = await getSession()
    const admin = requireAdmin(session)

    const body = await request.json()
    const { username, role } = body

    if (!username || typeof username !== 'string' || username.trim().length < 2) {
      return NextResponse.json(
        { error: 'Username must be at least 2 characters' },
        { status: 400 }
      )
    }

    const validRoles = ['admin', 'user', 'viewer']
    if (!role || !validRoles.includes(role)) {
      return NextResponse.json(
        { error: `Role must be one of: ${validRoles.join(', ')}` },
        { status: 400 }
      )
    }

    // Check uniqueness
    const existing = await prisma.user.findUnique({ where: { username: username.trim() } })
    if (existing) {
      return NextResponse.json(
        { error: 'Username already exists' },
        { status: 409 }
      )
    }

    // Generate secure password
    const generatedPassword = generateSecurePassword(16)
    const hashedPassword = await hashPassword(generatedPassword)

    const user = await prisma.user.create({
      data: {
        username: username.trim(),
        password: hashedPassword,
        role,
        createdBy: admin.id,
      },
      select: {
        id: true,
        username: true,
        role: true,
        active: true,
        createdAt: true,
      },
    })

    // Audit log
    await createAuditEntry({
      action: AuditActions.USER_CREATED,
      userId: admin.id,
      severity: 'info',
      details: {
        targetUserId: user.id,
        targetUsername: user.username,
        targetRole: user.role,
        createdBy: admin.username,
      },
    })

    return NextResponse.json({
      user,
      generatedPassword, // Shown once, never stored in plaintext
    })
  } catch (error: any) {
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('Error creating user:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
