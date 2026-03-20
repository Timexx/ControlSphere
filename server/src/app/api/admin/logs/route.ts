import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { requireAdmin } from '@/lib/authorization'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

const LOGS_DIR = path.resolve(process.cwd(), '..', 'logs')

/**
 * GET /api/admin/logs — List all log files (admin only)
 */
export async function GET() {
  try {
    const session = await getSession()
    requireAdmin(session)

    if (!fs.existsSync(LOGS_DIR)) {
      return NextResponse.json({ files: [] })
    }

    const entries = fs.readdirSync(LOGS_DIR, { withFileTypes: true })
    const files = entries
      .filter((e) => e.isFile() && e.name.endsWith('.log'))
      .map((e) => {
        const stat = fs.statSync(path.join(LOGS_DIR, e.name))
        return {
          name: e.name,
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        }
      })
      .sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime())

    return NextResponse.json({ files })
  } catch (error: any) {
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('[admin/logs] Error listing logs:', error)
    return NextResponse.json({ error: 'Failed to list log files' }, { status: 500 })
  }
}
