import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyPassword, decrypt, encrypt } from '@/lib/auth'
import { cookies } from 'next/headers'

/**
 * Renew Session Endpoint
 * 
 * Verifies user password and issues a new JWT token with extended expiry.
 * Used for re-authentication when accessing sensitive pages (e.g., Bulk Management).
 * 
 * This provides better UX than logging out and back in - it seamlessly extends
 * the session while ensuring the current user is still authenticated.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { password } = body

    if (!password) {
      return NextResponse.json(
        { error: 'Passwort erforderlich' },
        { status: 400 }
      )
    }

    // Get current session from cookies
    const cookieStore = await cookies()
    const session = cookieStore.get('session')?.value

    console.log('🔄 renew-session: Session cookie present:', !!session)

    if (!session) {
      console.log('❌ renew-session: No session cookie found')
      return NextResponse.json(
        { error: 'Keine aktive Session' },
        { status: 401 }
      )
    }

    // Decrypt and verify current session
    const payload = await decrypt(session)
    console.log('🔄 renew-session: Payload:', payload ? 'valid' : 'invalid', payload?.user ? 'has user' : 'no user')
    
    if (!payload || !payload.user?.id) {
      console.log('❌ renew-session: Invalid session payload')
      return NextResponse.json(
        { error: 'Ungültige Session' },
        { status: 401 }
      )
    }

    // Get user from database
    const user = await prisma.user.findUnique({
      where: { id: payload.user.id as string },
      select: { id: true, username: true, password: true, language: true }
    })

    if (!user) {
      console.log('❌ renew-session: User not found for id:', payload.user.id)
      return NextResponse.json(
        { error: 'Benutzer nicht gefunden' },
        { status: 401 }
      )
    }

    console.log('🔄 renew-session: Verifying password for user:', user.username)

    // Verify password
    const isValid = await verifyPassword(password, user.password)

    if (!isValid) {
      console.log('❌ renew-session: Invalid password')
      return NextResponse.json(
        { error: 'Falsches Passwort' },
        { status: 401 }
      )
    }

    console.log('✅ renew-session: Password verified, renewing session...')

    // Create new session with extended expiry (30 minutes)
    const expires = new Date(Date.now() + 30 * 60 * 1000)
    const newSession = await encrypt({
      user: {
        id: user.id,
        username: user.username,
        language: user.language
      },
      expires: expires.toISOString()
    })

    // Build response first so we can attach Set-Cookie reliably
    const response = NextResponse.json({
      success: true,
      message: 'Session erfolgreich erneuert',
      expires: expires.toISOString()
    })

    // Set new session cookie on the response (most reliable way in route handlers)
    response.cookies.set({
      name: 'session',
      value: newSession,
      expires,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/'
    })

    console.log('✅ renew-session: Session renewed successfully for user:', user.username)
    console.log('⏱️  New expiry:', expires.toISOString())

    // Audit log: bulk page access via password re-authentication
    try {
      const ip = request.ip || request.headers.get('x-forwarded-for') || 'unknown'
      const userAgent = request.headers.get('user-agent') || 'unknown'
      const referer = request.headers.get('referer') || 'unknown'

      await prisma.auditLog.create({
        // Cast to any to accommodate current generated Prisma types while keeping eventType for analytics
        data: {
          action: 'BULK_PAGE_ACCESS',
          eventType: 'bulk_auth',
          userId: user.id,
          severity: 'info',
          details: JSON.stringify({
            route: request.nextUrl.pathname,
            referer,
            ip,
            userAgent,
            expires: expires.toISOString(),
            method: 'password_reauth',
            context: 'bulk_management_entry'
          })
        } as any
      })
    } catch (err) {
      console.error('Audit log failed for bulk page access:', err)
    }

    return response

  } catch (error) {
    console.error('Session renewal error:', error)
    return NextResponse.json(
      { error: 'Interner Serverfehler' },
      { status: 500 }
    )
  }
}
