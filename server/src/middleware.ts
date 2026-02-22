import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { decrypt } from '@/lib/auth-edge'
import { resolveLocale, defaultLocale } from '@/i18n'

const LANGUAGE_SETUP_PATH = '/language-setup'
const LOCALE_COOKIE = 'NEXT_LOCALE'

const PUBLIC_PATHS = new Set([
  '/login',
  '/api/auth/login',
  '/api/auth/setup',
  '/api/auth/status',
  '/api/auth/session-time',
  '/api/auth/change-language',
  '/install-agent.sh',
  '/favicon.ico',
  '/favicon.svg',
  '/apple-touch-icon.png',
  '/site.webmanifest',
  '/android-chrome-192x192.png',
  '/android-chrome-512x512.png',
])

// Paths that require admin role
const ADMIN_PATHS_EXACT = new Set([
  '/settings/users',
])

// Paths that are blocked for viewer role
const VIEWER_BLOCKED_PATHS_PREFIX = ['/bulk-management', '/api/jobs']

function isViewerBlockedPath(pathname: string) {
  return VIEWER_BLOCKED_PATHS_PREFIX.some((p) => pathname === p || pathname.startsWith(p + '/'))
}

function isAdminPath(pathname: string) {
  return (
    ADMIN_PATHS_EXACT.has(pathname) ||
    pathname.startsWith('/api/admin/') ||
    pathname === '/settings' || pathname.startsWith('/settings/') ||
    pathname === '/audit-logs' || pathname.startsWith('/audit-logs/') ||
    pathname === '/api/audit-logs' || pathname.startsWith('/api/audit-logs/')
  )
}

function isBypassedPath(pathname: string) {
  return (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api/register') ||
    pathname.startsWith('/api/agent') ||
    pathname.startsWith('/ws/')
  )
}

function withLocaleCookie(response: NextResponse, locale: string) {
  response.cookies.set(LOCALE_COOKIE, locale, {
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  })
  return response
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const sessionToken = request.cookies.get('session')?.value
  const acceptLanguage = request.headers.get('accept-language')
  const currentLocaleCookie = request.cookies.get(LOCALE_COOKIE)?.value

  // Verbose logging removed — was causing I/O overhead on every request

  if (isBypassedPath(pathname)) {
    return NextResponse.next()
  }

  const session = sessionToken ? await decrypt(sessionToken) : null
  const preferredLocale = resolveLocale(
    (session as any)?.user?.language ?? currentLocaleCookie,
    acceptLanguage
  )

  const response = NextResponse.next()
  response.headers.set('x-locale', preferredLocale)
  response.headers.set('x-next-intl-locale', preferredLocale)
  
  // Only set the cookie if it's different from the current one
  if (currentLocaleCookie !== preferredLocale) {
    withLocaleCookie(response, preferredLocale)
  }

  // Public routes are always allowed
  if (PUBLIC_PATHS.has(pathname)) {
    // If a logged-in user hits /login, route them home or to language setup
    if (pathname === '/login' && session) {
      const target = (session as any)?.user?.language ? '/' : LANGUAGE_SETUP_PATH
      return withLocaleCookie(NextResponse.redirect(new URL(target, request.url)), preferredLocale)
    }
    return response
  }

  if (!session) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return withLocaleCookie(NextResponse.redirect(new URL('/login', request.url)), preferredLocale)
  }

  // Enforce admin-only routes
  if (isAdminPath(pathname)) {
    const role = (session as any)?.user?.role
    if (role !== 'admin') {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 })
      }
      return withLocaleCookie(NextResponse.redirect(new URL('/', request.url)), preferredLocale)
    }
  }

  // Enforce viewer-blocked routes
  if (isViewerBlockedPath(pathname)) {
    const role = (session as any)?.user?.role
    if (role === 'viewer') {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Forbidden: Viewers cannot access bulk management' }, { status: 403 })
      }
      return withLocaleCookie(NextResponse.redirect(new URL('/', request.url)), preferredLocale)
    }
  }

  // Enforce language onboarding
  const missingLanguage = !(session as any)?.user?.language
  if (missingLanguage && !pathname.startsWith('/api/') && pathname !== LANGUAGE_SETUP_PATH) {
    return withLocaleCookie(NextResponse.redirect(new URL(LANGUAGE_SETUP_PATH, request.url)), preferredLocale)
  }
  if (!missingLanguage && pathname === LANGUAGE_SETUP_PATH) {
    return withLocaleCookie(NextResponse.redirect(new URL('/', request.url)), preferredLocale)
  }

  // Redirect authenticated users away from /login
  if (pathname === '/login') {
    const target = missingLanguage ? LANGUAGE_SETUP_PATH : '/'
    return withLocaleCookie(NextResponse.redirect(new URL(target, request.url)), preferredLocale)
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon and other icon/manifest assets
     * - ws/ (WebSocket connections)
     */
    '/((?!_next/static)(?!_next/image)(?!favicon\\.ico)(?!favicon\\.svg)(?!apple-touch-icon\\.png)(?!android-chrome-192x192\\.png)(?!android-chrome-512x512\\.png)(?!site\\.webmanifest)(?!ws/).*)',
  ],
}
