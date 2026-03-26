import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { requireAdmin } from '@/lib/authorization'
import { encryptPassword } from '@/lib/email'
import { notificationService } from '@/lib/notification-service'

export const dynamic = 'force-dynamic'

/**
 * GET /api/notification-config — Load notification settings (admin only)
 * SMTP password is masked in the response.
 */
export async function GET() {
  try {
    const session = await getSession()
    requireAdmin(session)

    const cfg = await prisma.notificationConfig.findUnique({ where: { id: 'global' } })

    if (!cfg) {
      return NextResponse.json({ config: null })
    }

    // Mask password
    return NextResponse.json({
      config: {
        ...cfg,
        smtpPassword: cfg.smtpPassword ? '***' : null,
      },
      diagnostics: notificationService.getDiagnostics(),
    })
  } catch (error: any) {
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('[notification-config] GET error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

/**
 * POST /api/notification-config — Save notification settings (admin only)
 * If smtpPassword is '***', the stored password is kept as-is.
 */
export async function POST(request: Request) {
  try {
    const session = await getSession()
    requireAdmin(session)

    const body = await request.json()
    const {
      smtpHost,
      smtpPort,
      smtpUsername,
      smtpPassword,
      smtpFromEmail,
      smtpFromName,
      smtpTls,
      smtpVerifyCert,
      recipientEmails,
      eventSettings,
      digestEnabled,
      digestHour,
      digestMinute,
      digestDays,
      enabled,
    } = body

    // Validate required fields if enabling
    if (enabled) {
      if (!smtpHost) return NextResponse.json({ error: 'SMTP host is required' }, { status: 400 })
      if (!smtpFromEmail) return NextResponse.json({ error: 'From email is required' }, { status: 400 })
      if (!recipientEmails) return NextResponse.json({ error: 'At least one recipient is required' }, { status: 400 })
    }

    // Determine final password: keep existing if masked, encrypt new one otherwise
    let finalPassword: string | null | undefined = undefined
    if (smtpPassword === '***' || smtpPassword === null || smtpPassword === undefined) {
      // Keep existing — don't touch the field
      finalPassword = undefined
    } else if (smtpPassword === '') {
      finalPassword = null
    } else {
      finalPassword = encryptPassword(smtpPassword)
    }

    const updateData: Record<string, unknown> = {
      smtpHost:       smtpHost   ?? null,
      smtpPort:       Number(smtpPort ?? 587),
      smtpUsername:   smtpUsername ?? null,
      smtpFromEmail:  smtpFromEmail ?? null,
      smtpFromName:   smtpFromName ?? 'ControlSphere',
      smtpTls:        smtpTls   ?? true,
      smtpVerifyCert: smtpVerifyCert ?? true,
      recipientEmails: recipientEmails ?? '',
      eventSettings:  typeof eventSettings === 'object'
        ? JSON.stringify(eventSettings)
        : (eventSettings ?? '{}'),
      digestEnabled:  digestEnabled ?? false,
      digestHour:     Number(digestHour ?? 8),
      digestMinute:   Math.min(59, Math.max(0, Number(digestMinute ?? 0))),
      digestDays:     digestDays ?? '1,2,3,4,5',
      enabled:        enabled ?? false,
    }

    if (finalPassword !== undefined) {
      updateData.smtpPassword = finalPassword
    }

    const cfg = await prisma.notificationConfig.upsert({
      where:  { id: 'global' },
      create: { id: 'global', ...updateData } as any,
      update: updateData,
    })

    // Re-schedule digest timer with new settings
    notificationService.rescheduleDigest()

    return NextResponse.json({
      config: {
        ...cfg,
        smtpPassword: cfg.smtpPassword ? '***' : null,
      },
    })
  } catch (error: any) {
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('[notification-config] POST error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
