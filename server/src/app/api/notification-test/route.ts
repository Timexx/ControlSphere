import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { requireAdmin } from '@/lib/authorization'
import { sendEmail, testSmtpConnection, type SmtpConfig } from '@/lib/email'
import { renderTestEmail } from '@/lib/email-templates'

export const dynamic = 'force-dynamic'

/**
 * POST /api/notification-test — Send a test email (admin only)
 *
 * Optionally accepts a partial config in the body (for "test before save").
 * Falls back to the stored DB config if no body config is provided.
 */
export async function POST(request: Request) {
  try {
    const session = await getSession()
    requireAdmin(session)

    const body = await request.json().catch(() => ({}))

    // Load stored config
    const stored = await prisma.notificationConfig.findUnique({ where: { id: 'global' } })

    // Merge body overrides with stored config
    const smtpHost       = body.smtpHost      ?? stored?.smtpHost      ?? null
    const smtpPort       = Number(body.smtpPort ?? stored?.smtpPort ?? 587)
    const smtpUsername   = body.smtpUsername   ?? stored?.smtpUsername  ?? null
    const smtpFromEmail  = body.smtpFromEmail  ?? stored?.smtpFromEmail ?? null
    const smtpFromName   = body.smtpFromName   ?? stored?.smtpFromName  ?? 'ControlSphere'
    const smtpTls        = body.smtpTls        ?? stored?.smtpTls       ?? true
    const smtpVerifyCert = body.smtpVerifyCert ?? stored?.smtpVerifyCert ?? true
    const recipientEmails: string = body.recipientEmails ?? stored?.recipientEmails ?? ''

    // Password: use body value (plain), or fall back to stored (may be encrypted)
    let smtpPassword: string | null = null
    if (body.smtpPassword && body.smtpPassword !== '***') {
      smtpPassword = body.smtpPassword
    } else if (stored?.smtpPassword) {
      smtpPassword = stored.smtpPassword // encrypted — email.ts handles decryption
    }

    if (!smtpHost)      return NextResponse.json({ error: 'SMTP host not configured' },      { status: 400 })
    if (!smtpFromEmail) return NextResponse.json({ error: 'From email not configured' },      { status: 400 })
    if (!recipientEmails) return NextResponse.json({ error: 'No recipients configured' },     { status: 400 })

    const config: SmtpConfig = {
      smtpHost, smtpPort, smtpUsername, smtpPassword,
      smtpFromEmail, smtpFromName, smtpTls, smtpVerifyCert,
    }

    // First verify connectivity
    const connError = await testSmtpConnection(config)
    if (connError) {
      return NextResponse.json({ error: `SMTP connection failed: ${connError}` }, { status: 422 })
    }

    // Load server URL for dashboard link and admin language
    const [serverConfig, adminUser] = await Promise.all([
      prisma.serverConfig.findUnique({ where: { id: 'global' } }),
      prisma.user.findFirst({ where: { role: 'admin', active: true }, select: { language: true }, orderBy: { createdAt: 'asc' } }),
    ])
    const serverUrl = serverConfig?.serverUrl ?? null
    const lang = adminUser?.language ?? 'en'

    const { subject, html, text } = renderTestEmail(serverUrl, lang)
    const recipients = recipientEmails.split(',').map((s: string) => s.trim()).filter(Boolean)

    await sendEmail(config, { to: recipients, subject, html, text, eventKey: 'test' })

    return NextResponse.json({ success: true, sentTo: recipients })
  } catch (error: any) {
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('[notification-test] error:', error)
    return NextResponse.json({ error: error.message || 'Failed to send test email' }, { status: 500 })
  }
}
