import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { requireAdmin } from '@/lib/authorization'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

// Primary location (bare-metal / writable Docker volume)
const PRIMARY_LOGS_DIR = path.resolve(process.cwd(), '..', 'logs')
// Fallback used when primary is read-only (e.g. EROFS in some Docker setups)
const FALLBACK_LOGS_DIR = path.join('/tmp', 'controlsphere-logs')

function readDir(dir: string): { name: string; size: number; modifiedAt: string }[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.log'))
    .map((e) => {
      const stat = fs.statSync(path.join(dir, e.name))
      return { name: e.name, size: stat.size, modifiedAt: stat.mtime.toISOString() }
    })
}

/**
 * GET /api/admin/logs — List all log files (admin only)
 * Merges files from primary logs dir and /tmp fallback (deduplicates by name).
 */
export async function GET() {
  try {
    const session = await getSession()
    requireAdmin(session)

    const seen = new Set<string>()
    const files: { name: string; size: number; modifiedAt: string }[] = []

    for (const entry of [...readDir(PRIMARY_LOGS_DIR), ...readDir(FALLBACK_LOGS_DIR)]) {
      if (!seen.has(entry.name)) {
        seen.add(entry.name)
        files.push(entry)
      }
    }

    files.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime())

    return NextResponse.json({ files })
  } catch (error: any) {
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('[admin/logs] Error listing logs:', error)
    return NextResponse.json({ error: 'Failed to list log files' }, { status: 500 })
  }
}
