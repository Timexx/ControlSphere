import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createAuditEntry } from '@/lib/audit'
import { decrypt } from '@/lib/auth'
import { cookies } from 'next/headers'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { sha } = body

    if (!sha || typeof sha !== 'string' || !/^[a-f0-9]{4,40}$/.test(sha)) {
      return NextResponse.json({ error: 'Invalid SHA' }, { status: 400 })
    }

    await prisma.serverConfig.upsert({
      where: { id: 'global' },
      update: { updateDismissedSha: sha },
      create: { id: 'global', updateDismissedSha: sha },
    })

    // Audit log
    const cookieStore = await cookies()
    const session = cookieStore.get('session')?.value
    const payload = session ? await decrypt(session) : null
    const userId = (payload?.user?.id as string) ?? null

    await createAuditEntry({
      action: 'SERVER_UPDATE_DISMISSED',
      userId,
      severity: 'info',
      details: { dismissedSha: sha },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[server-update/dismiss] Error:', error)
    return NextResponse.json({ error: 'Failed to dismiss update' }, { status: 500 })
  }
}
