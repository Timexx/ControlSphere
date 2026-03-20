import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { requireAdmin } from '@/lib/authorization'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

const LOGS_DIR = path.resolve(process.cwd(), '..', 'logs')

/**
 * GET /api/admin/logs/[filename] — Read a log file (admin only)
 *
 * Returns the raw log content as plain text.
 * Path traversal is blocked by validating the resolved path stays within LOGS_DIR.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const session = await getSession()
    requireAdmin(session)

    const { filename } = await params
    // Only allow .log files and block any path traversal
    if (!filename.endsWith('.log') || filename.includes('/') || filename.includes('..')) {
      return NextResponse.json({ error: 'Invalid filename' }, { status: 400 })
    }

    const filePath = path.join(LOGS_DIR, filename)
    // Double-check resolved path is still inside LOGS_DIR
    if (!filePath.startsWith(LOGS_DIR + path.sep) && filePath !== LOGS_DIR) {
      return NextResponse.json({ error: 'Invalid filename' }, { status: 400 })
    }

    if (!fs.existsSync(filePath)) {
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
