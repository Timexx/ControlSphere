import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

export const dynamic = 'force-dynamic'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400'
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: CORS_HEADERS })
}

export async function GET() {
  try {
    // Get the session cookie
    const cookieStore = await cookies()
    const sessionCookie = cookieStore.get('session')?.value

    if (!sessionCookie) {
      return NextResponse.json(
        { remainingTime: null },
        { status: 401, headers: CORS_HEADERS }
      )
    }

    // Decode JWT to get exp time and role (without verification - just reading payload)
    try {
      const payload = sessionCookie.split('.')[1]
      const decoded = JSON.parse(Buffer.from(payload, 'base64').toString())

      if (!decoded.exp) {
        return NextResponse.json({ remainingTime: null, role: null }, { headers: CORS_HEADERS })
      }

      const now = Math.floor(Date.now() / 1000)
      const remaining = decoded.exp - now
      const role = decoded.user?.role || 'user'
      const userId = decoded.user?.id || null

      return NextResponse.json(
        { remainingTime: remaining > 0 ? remaining : 0, role, userId },
        { headers: CORS_HEADERS }
      )
    } catch {
      return NextResponse.json(
        { remainingTime: null },
        { headers: CORS_HEADERS }
      )
    }
  } catch (error) {
    console.error('Session time error:', error)
    return NextResponse.json(
      { remainingTime: null },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}