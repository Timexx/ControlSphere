import { NextResponse } from 'next/server'
import { getSession, encrypt } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { cookies } from 'next/headers'

export async function POST() {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'No active session' }, { status: 401 })
    }

    // Re-fetch role from DB so role changes take effect without re-login
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, username: true, language: true, role: true, active: true },
    })

    if (!user || !user.active) {
      return NextResponse.json({ error: 'Account deactivated' }, { status: 403 })
    }

    // Create new session with fresh expiration and up-to-date role
    const expires = new Date(Date.now() + 30 * 60 * 1000) // 30 minutes
    const newSession = await encrypt({
      user: {
        id: user.id,
        username: user.username,
        language: user.language ?? null,
        role: user.role,
      },
      expires,
    })

    cookies().set('session', newSession, { expires, httpOnly: true })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Session refresh error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}