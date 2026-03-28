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

    // Prepare log path — log-helper.sh handles the actual file creation.
    // We pass the desired path via CS_UPDATE_LOG env var so both the
    // execute route and the script agree on the same file.
    const logFileName = `update-${Date.now()}.log`
    const primaryLogsDir = path.join(installDir, 'logs')
    const fallbackLogsDir = path.join('/tmp', 'controlsphere-logs')

    // Clean old logs and runner scripts (non-critical)
    try { updateChecker.cleanOldLogs() } catch (_e) { /* non-critical */ }
    try {
      const logsFiles = fs.existsSync(primaryLogsDir) ? fs.readdirSync(primaryLogsDir) : []
      for (const f of logsFiles) {
        if (f.startsWith('.update-runner-') && f.endsWith('.sh')) {
          fs.unlinkSync(path.join(primaryLogsDir, f))
        }
      }
    } catch { /* non-critical */ }

    // Ensure the logs directory exists
    let logsDir = primaryLogsDir
    try {
      if (!fs.existsSync(primaryLogsDir)) fs.mkdirSync(primaryLogsDir, { recursive: true })
      // Test writability
      fs.accessSync(primaryLogsDir, fs.constants.W_OK)
    } catch {
      try {
        if (!fs.existsSync(fallbackLogsDir)) fs.mkdirSync(fallbackLogsDir, { recursive: true })
        logsDir = fallbackLogsDir
      } catch {
        return NextResponse.json(
          { error: 'Cannot create log directory (tried installDir/logs and /tmp/controlsphere-logs)' },
          { status: 500 }
        )
      }
    }

    const logPath = path.join(logsDir, logFileName)

    // Audit log
    await createAuditEntry({
      action: 'SERVER_UPDATE_STARTED',
      userId: user.id,
      severity: 'critical',
      details: { logPath, triggeredBy: user.username },
    })

    // Copy script to logs/ before spawning — prevents the self-modification
    // problem where git reset --hard replaces the running script on disk.
    const runnerName = `.update-runner-${Date.now()}.sh`
    const runnerPath = path.join(logsDir, runnerName)
    try {
      fs.copyFileSync(scriptPath, runnerPath)
      fs.chmodSync(runnerPath, 0o755)
    } catch (copyErr: any) {
      return NextResponse.json(
        { error: `Cannot prepare update runner: ${copyErr.message}` },
        { status: 500 }
      )
    }

    // Spawn detached update process from the copied script.
    // log-helper.sh handles file logging via the CS_UPDATE_LOG env var.
    let child
    try {
      child = spawn('bash', [runnerPath], {
        detached: true,
        stdio: 'ignore',
        cwd: installDir,
        env: { ...process.env, CS_UPDATE_LOG: logPath },
      })
    } catch (spawnErr: any) {
      return NextResponse.json(
        { error: `Cannot spawn update process: ${spawnErr.message}` },
        { status: 500 }
      )
    }

    child.on('error', (err) => {
      console.error('[server-update/execute] child process error:', err)
    })
    child.unref()

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
