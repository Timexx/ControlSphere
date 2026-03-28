import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
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

    // Read update status file if it exists (written by update-system.sh)
    let updateStatus = null
    try {
      const installDir = path.resolve(process.cwd(), '..')
      const statusPath = path.join(installDir, 'logs', 'update-status.json')
      if (fs.existsSync(statusPath)) {
        const raw = fs.readFileSync(statusPath, 'utf-8')
        const parsed = JSON.parse(raw)
        // Only include if recent (within last 10 minutes)
        const age = Date.now() - new Date(parsed.timestamp).getTime()
        if (age < 600_000) {
          updateStatus = parsed
        }
      }
    } catch { /* non-critical */ }

    return NextResponse.json({
      ...info,
      dismissed,
      autoCheckEnabled,
      updateStatus,
    })
  } catch (error) {
    console.error('[server-update/check] Error:', error)
    return NextResponse.json(
      { error: 'Failed to check for updates' },
      { status: 500 }
    )
  }
}
