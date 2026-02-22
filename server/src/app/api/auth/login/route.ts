import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyPassword, encrypt } from '@/lib/auth'
import { cookies } from 'next/headers'
import { createAuditEntry, AuditActions } from '@/lib/audit'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { username, password } = body

    console.log('🔐 Login attempt for user:', username)

    if (!username || !password) {
      console.log('❌ Missing username or password')
      return NextResponse.json(
        { error: 'Username and password are required' },
        { status: 400 }
      )
    }

    const user = await prisma.user.findUnique({
      where: { username },
    })

    if (!user) {
      console.log('❌ User not found:', username)
      return NextResponse.json(
        { error: 'Invalid credentials' },
        { status: 401 }
      )
    }

    // Block deactivated users
    if (!user.active) {
      console.log('❌ User deactivated:', username)
      await createAuditEntry({
        action: AuditActions.USER_LOGIN_BLOCKED,
        userId: user.id,
        severity: 'warn',
        details: { reason: 'Account deactivated', username },
      })
      return NextResponse.json(
        { error: 'Account is deactivated' },
        { status: 403 }
      )
    }

    console.log('✓ User found:', user.username, '(id:', user.id + ')')
    console.log('  Password hash length:', user.password?.length || 0)

    const isValid = await verifyPassword(password, user.password)

    console.log('  Password valid:', isValid)

    if (!isValid) {
      console.log('❌ Invalid password for user:', username)
      return NextResponse.json(
        { error: 'Invalid credentials' },
        { status: 401 }
      )
    }

    // Update last login timestamp
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    })

    // Login success — include role in session
    console.log('✅ Login successful for user:', username, 'role:', user.role)
    const expires = new Date(Date.now() + 30 * 60 * 1000) // 30 minutes
    const session = await encrypt({
      user: {
        id: user.id,
        username: user.username,
        language: user.language ?? null,
        role: user.role,
      },
      expires,
    })

    const isSecure = new URL(request.url).protocol === 'https:'

    cookies().set('session', session, {
      expires,
      httpOnly: true,
      sameSite: 'lax',
      secure: isSecure,
      path: '/',
    })

    return NextResponse.json({ success: true, language: user.language })
  } catch (error) {
    console.error('❌ Login error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
