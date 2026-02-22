import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { encrypt, getSession } from '@/lib/auth'
import { defaultLocale, locales } from '@/i18n'

const SUPPORTED_LANGUAGES = new Set(locales)

function normalizeLanguage(lang: unknown): string | null {
  if (!lang || typeof lang !== 'string') return null
  const short = lang.toLowerCase().split('-')[0]
  return SUPPORTED_LANGUAGES.has(short as (typeof locales)[number]) ? short : null
}

export async function POST(request: Request) {
  try {
    console.log('[API /api/user/language] Request received')
    const session = await getSession()
    console.log('[API /api/user/language] Session:', session)

    if (!session?.user?.id) {
      console.log('[API /api/user/language] No session/user')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    console.log('[API /api/user/language] Request body:', body)
    const requestedLanguage = normalizeLanguage(body.language)
    console.log('[API /api/user/language] Normalized language:', requestedLanguage)

    if (!requestedLanguage) {
      console.log('[API /api/user/language] Invalid language')
      return NextResponse.json({ error: 'Invalid language' }, { status: 400 })
    }

    // First check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { id: session.user.id as string },
    })

    if (!existingUser) {
      console.log('[API /api/user/language] User not found')
      const response = NextResponse.json({ error: 'User not found' }, { status: 404 })
      // Clear invalid session
      response.cookies.delete('session')
      response.cookies.delete('NEXT_LOCALE')
      return response
    }

    console.log('[API /api/user/language] Updating user language to:', requestedLanguage)
    const user = await prisma.user.update({
      where: { id: session.user.id as string },
      data: { language: requestedLanguage },
      select: { id: true, username: true, language: true, role: true },
    })
    console.log('[API /api/user/language] User updated:', user)

    // Check if server has already been configured
    const serverConfig = await prisma.serverConfig.findUnique({
      where: { id: 'global' },
      select: { serverUrl: true },
    })
    const needsServerSetup = user.role === 'admin' && !serverConfig?.serverUrl
    console.log('[API /api/user/language] Server config check:', { 
      hasServerUrl: !!serverConfig?.serverUrl, 
      needsServerSetup 
    })

    const expires = new Date(Date.now() + 30 * 60 * 1000)
    const newSession = await encrypt({
      user,
      expires,
    })
    console.log('[API /api/user/language] New session encrypted')

    const response = NextResponse.json({ 
      success: true, 
      language: user.language, 
      role: user.role,
      needsServerSetup 
    })

    // Only mark cookies as secure when the request is actually over HTTPS.
    // On local/LAN HTTP, a secure cookie would be dropped and the updated
    // session (with language) would never reach the browser, causing
    // middleware to think onboarding is incomplete.
    const isSecure = new URL(request.url).protocol === 'https:'

    response.cookies.set('session', newSession, {
      expires,
      httpOnly: true,
      sameSite: 'lax',
      secure: isSecure,
      path: '/',
    })

    response.cookies.set('NEXT_LOCALE', user.language || defaultLocale, {
      path: '/',
      sameSite: 'lax',
      secure: isSecure,
    })

    console.log('[API /api/user/language] Cookies set, returning success')
    return response
  } catch (error) {
    console.error('[API /api/user/language] Failed to update language', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
