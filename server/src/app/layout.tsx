import type { Metadata } from 'next'
import { cookies, headers } from 'next/headers'
import { NextIntlClientProvider } from 'next-intl'
import './globals.css'
import { decrypt } from '@/lib/auth'
import { resolveLocale, defaultLocale } from '@/i18n'

// Use local fonts to avoid network issues
const inter = {
  className: '',
  variable: '--font-inter',
  style: {
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
  }
}

const orbitron = {
  className: '',
  variable: '--font-orbitron',
  style: {
    fontFamily: 'Orbitron, system-ui, -apple-system, sans-serif'
  }
}

const jetbrainsMono = {
  className: '',
  variable: '--font-jetbrains',
  style: {
    fontFamily: 'JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace'
  }
}

export const metadata: Metadata = {
  title: 'ControlSphere',
  description: 'Modern VM management and monitoring system',
  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
    shortcut: '/favicon.ico',
  },
  manifest: '/site.webmanifest',
}

async function resolveRequestLocale() {
  const cookieStore = cookies()
  const sessionToken = cookieStore.get('session')?.value
  const localeCookie = cookieStore.get('NEXT_LOCALE')?.value
  const acceptLanguage = headers().get('accept-language')

  console.log('🔍 Resolving locale...')
  console.log('  NEXT_LOCALE cookie:', localeCookie)
  console.log('  Accept-Language:', acceptLanguage)

  let sessionLanguage: string | null = null
  if (sessionToken) {
    try {
      const payload = await decrypt(sessionToken)
      sessionLanguage = (payload as any)?.user?.language || null
      console.log('  Session language:', sessionLanguage)
    } catch (error) {
      console.error('Failed to resolve session language', error)
    }
  }

  const resolved = resolveLocale(sessionLanguage ?? localeCookie, acceptLanguage)
  console.log('✓ Resolved locale:', resolved)
  
  return resolved
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const locale = await resolveRequestLocale()
  
  // Safely load messages, fallback to default if not found
  let messages: any = {}
  try {
    messages = (await import(`@/messages/${locale}`)).default
  } catch {
    messages = (await import(`@/messages/${defaultLocale}`)).default
  }

  return (
    <html lang={locale}>
      <body className={`${inter.variable} ${orbitron.variable} ${jetbrainsMono.variable}`}>
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
