import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { requireAdmin } from '@/lib/authorization'

export const dynamic = 'force-dynamic'

/**
 * GET /api/notification-logs — Return last 50 notification log entries (admin only)
 */
export async function GET() {
  try {
    const session = await getSession()
    requireAdmin(session)

    const logs = await prisma.notificationLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    })

    return NextResponse.json({ logs })
  } catch (error: any) {
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('[notification-logs] error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
