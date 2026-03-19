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

    // Prepare log file
    const logsDir = path.join(installDir, 'logs')
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true })
    }

    // Clean old logs
    updateChecker.cleanOldLogs()

    const logFileName = `update-${Date.now()}.log`
    const logPath = path.join(logsDir, logFileName)
    const logStream = fs.createWriteStream(logPath)

    // Write header to log
    logStream.write(`ControlSphere Server Update Log\n`)
    logStream.write(`Started: ${new Date().toISOString()}\n`)
    logStream.write(`Triggered by: ${user.username}\n`)
    logStream.write(`${'='.repeat(60)}\n\n`)

    // Audit log
    await createAuditEntry({
      action: 'SERVER_UPDATE_STARTED',
      userId: user.id,
      severity: 'critical',
      details: { logPath, triggeredBy: user.username },
    })

    // Spawn detached update process
    const child = spawn('bash', [scriptPath], {
      detached: true,
      stdio: ['ignore', logStream, logStream],
      cwd: installDir,
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
  } catch (error) {
    console.error('[server-update/execute] Error:', error)
    return NextResponse.json({ error: 'Failed to start update' }, { status: 500 })
  }
}
