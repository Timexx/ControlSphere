import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { prisma } from '@/lib/prisma'
import { verifyPassword, decrypt } from '@/lib/auth'
import { createAuditEntry } from '@/lib/audit'
import { cookies } from 'next/headers'
import { updateChecker } from '@/lib/update-checker'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { password } = body

    if (!password) {
      return NextResponse.json({ error: 'Password is required' }, { status: 400 })
    }

    // Verify session
    const cookieStore = await cookies()
    const session = cookieStore.get('session')?.value
    if (!session) {
      return NextResponse.json({ error: 'No active session' }, { status: 401 })
    }

    const payload = await decrypt(session)
    if (!payload || !payload.user?.id) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
    }

    // Verify admin role
    const user = await prisma.user.findUnique({
      where: { id: payload.user.id as string },
      select: { id: true, username: true, password: true, role: true },
    })

    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Verify password
    const isValid = await verifyPassword(password, user.password)
    if (!isValid) {
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
    }

    // Resolve paths
    const installDir = path.resolve(process.cwd(), '..')
    const scriptPath = path.join(installDir, 'update-system.sh')

    if (!fs.existsSync(scriptPath)) {
      return NextResponse.json(
        { error: 'update-system.sh not found. Is this a bare-metal installation?' },
        { status: 404 }
      )
    }

    // Prepare log file — try installDir/logs first, fall back to /tmp
    const logFileName = `update-${Date.now()}.log`
    const primaryLogsDir = path.join(installDir, 'logs')
    const fallbackLogsDir = path.join('/tmp', 'controlsphere-logs')

    // Clean old logs (non-critical)
    try { updateChecker.cleanOldLogs() } catch (_e) { /* non-critical */ }

    let logPath: string
    let logFd: number

    const tryOpenLog = (dir: string): number | null => {
      try {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
        const p = path.join(dir, logFileName)
        const fd = fs.openSync(p, 'w')
        logPath = p
        return fd
      } catch {
        return null
      }
    }

    logPath = path.join(primaryLogsDir, logFileName) // set default so TS is happy
    const fd = tryOpenLog(primaryLogsDir) ?? tryOpenLog(fallbackLogsDir)
    if (fd === null) {
      return NextResponse.json(
        { error: 'Cannot create log file: logs directory is not writable (tried installDir/logs and /tmp/controlsphere-logs)' },
        { status: 500 }
      )
    }
    logFd = fd

    // Write header to log
    fs.writeSync(logFd, `ControlSphere Server Update Log\n`)
    fs.writeSync(logFd, `Started: ${new Date().toISOString()}\n`)
    fs.writeSync(logFd, `Triggered by: ${user.username}\n`)
    fs.writeSync(logFd, `${'='.repeat(60)}\n\n`)

    // Audit log
    await createAuditEntry({
      action: 'SERVER_UPDATE_STARTED',
      userId: user.id,
      severity: 'critical',
      details: { logPath, triggeredBy: user.username },
    })

    // Spawn detached update process
    let child
    try {
      child = spawn('bash', [scriptPath], {
        detached: true,
        stdio: ['ignore', logFd, logFd],
        cwd: installDir,
      })
    } catch (spawnErr: any) {
      try { fs.closeSync(logFd) } catch (_e) { /* ignore */ }
      return NextResponse.json(
        { error: `Cannot spawn update process: ${spawnErr.message}` },
        { status: 500 }
      )
    }

    child.on('error', (err) => {
      console.error('[server-update/execute] child process error:', err)
    })
    child.unref()

    // Close parent's copy of the fd — the child process keeps its own inherited copy
    try { fs.closeSync(logFd) } catch (_e) { /* ignore */ }

    return NextResponse.json(
      {
        status: 'started',
        message: 'Update process started. Server will restart shortly.',
        logPath,
      },
      { status: 202 }
    )
  } catch (error: any) {
    console.error('[server-update/execute] Error:', error)
    return NextResponse.json(
      { error: `Failed to start update: ${error?.message || String(error)}` },
      { status: 500 }
    )
  }
}
