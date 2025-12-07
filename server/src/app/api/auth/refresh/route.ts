import { NextResponse } from 'next/server'
import { getSession, encrypt } from '@/lib/auth'
import { cookies } from 'next/headers'

export async function POST() {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'No active session' }, { status: 401 })
    }

    // Create new session with fresh expiration
    const expires = new Date(Date.now() + 30 * 60 * 1000) // 30 minutes
    const newSession = await encrypt({ user: session.user, expires })

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