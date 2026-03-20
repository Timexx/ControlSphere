import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { requireAdmin } from '@/lib/authorization'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

const PRIMARY_LOGS_DIR = path.resolve(process.cwd(), '..', 'logs')
const FALLBACK_LOGS_DIR = path.join('/tmp', 'controlsphere-logs')

/**
 * GET /api/admin/logs/[filename] — Read a log file (admin only)
 *
 * Returns the raw log content as plain text.
 * Path traversal is blocked: only bare .log filenames are accepted.
 * Checks primary logs dir first, then /tmp fallback.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const session = await getSession()
    requireAdmin(session)

    const { filename } = await params
    // Only allow bare .log filenames — no slashes, no dots in path components
    if (!filename.endsWith('.log') || filename.includes('/') || filename.includes('..')) {
      return NextResponse.json({ error: 'Invalid filename' }, { status: 400 })
    }

    // Try primary location, then fallback
    let filePath: string | null = null
    for (const dir of [PRIMARY_LOGS_DIR, FALLBACK_LOGS_DIR]) {
      const candidate = path.join(dir, filename)
      // Ensure resolved path stays inside the expected directory
      if (!candidate.startsWith(dir + path.sep) && candidate !== dir) continue
      if (fs.existsSync(candidate)) {
        filePath = candidate
        break
      }
    }

    if (!filePath) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    const content = fs.readFileSync(filePath, 'utf-8')
    return new NextResponse(content, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  } catch (error: any) {
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('[admin/logs/file] Error reading log:', error)
    return NextResponse.json({ error: 'Failed to read log file' }, { status: 500 })
  }
}
