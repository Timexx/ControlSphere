import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { decrypt, encrypt } from '@/lib/auth'
import { locales } from '@/i18n'
import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest) {
  try {
    // Get the language from request body
    const body = await request.json()
    const { language } = body

    console.log('🌐 Language change request:', language)

    // Validate language
    if (!language || !locales.includes(language as any)) {
      console.log('❌ Invalid language:', language)
      return NextResponse.json(
        { error: 'Invalid language' },
        { status: 400 }
      )
    }

    // Get user from session
    const cookieStore = await cookies()
    const sessionToken = cookieStore.get('session')?.value

    if (!sessionToken) {
      console.log('❌ No session token')
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    let userId: string, username: string
    try {
      const payload = await decrypt(sessionToken)
      userId = (payload as any)?.user?.id
      username = (payload as any)?.user?.username
      if (!userId || !username) {
        console.log('❌ Invalid session payload')
        return NextResponse.json(
          { error: 'Unauthorized' },
          { status: 401 }
        )
      }
      console.log('✓ User from session:', username, '(id:', userId + ')')
    } catch (error) {
      console.error('Failed to decrypt session:', error)
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Update user's language in database
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { language },
    })
    console.log('✓ Database updated. User language:', updatedUser.language)

    // Create a new session JWT with the updated language (preserve role)
    const expires = new Date(Date.now() + 30 * 60 * 1000) // 30 minutes
    const newSession = await encrypt({
      user: { id: userId, username, language, role: updatedUser.role },
      expires,
    })
    console.log('✓ New session JWT created with language:', language)

    // Set both cookies in the response
    // Only use secure cookies over HTTPS
    const isSecure = request.url.startsWith('https://')
    const response = NextResponse.json({ success: true })
    
    // Set the new session cookie
    response.cookies.set('session', newSession, {
      expires,
      httpOnly: true,
      sameSite: 'lax',
      secure: isSecure,
      path: '/',
    })
    console.log('✓ Session cookie updated (httpOnly:true, sameSite:lax, secure:', isSecure, ')')
    
    // Set the locale cookie
    response.cookies.set('NEXT_LOCALE', language, {
      httpOnly: false,
      secure: isSecure,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365, // 1 year
      path: '/',
    })
    console.log('✓ NEXT_LOCALE cookie set to:', language, '(httpOnly:false, sameSite:lax, secure:', isSecure, ')')
    
    // Log all response cookies
    const responseCookies = response.cookies.getAll()
    console.log('📤 Response cookies:', responseCookies.map(c => `${c.name}=${c.value.substring(0, 20)}...`))
    console.log('✅ Language change complete')

    return response
  } catch (error) {
    console.error('Change language error:', error)
    return NextResponse.json(
      { error: 'Failed to change language' },
      { status: 500 }
    )
  }
}
