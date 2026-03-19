import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { updateChecker } from '@/lib/update-checker'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const force = request.nextUrl.searchParams.get('force') === 'true'
    const info = await updateChecker.checkForUpdates(force)

    // Check if current update was dismissed (gracefully handle missing columns)
    let dismissed = false
    let autoCheckEnabled = true
    try {
      const config = await prisma.serverConfig.findUnique({ where: { id: 'global' } })
      if (config) {
        dismissed = (config as Record<string, unknown>).updateDismissedSha === info.latestSha
        autoCheckEnabled = ((config as Record<string, unknown>).autoCheckUpdates as boolean) ?? true
      }
    } catch {
      // Migration not yet applied — ignore
    }

    return NextResponse.json({
      ...info,
      dismissed,
      autoCheckEnabled,
    })
  } catch (error) {
    console.error('[server-update/check] Error:', error)
    return NextResponse.json(
      { error: 'Failed to check for updates' },
      { status: 500 }
    )
  }
}
