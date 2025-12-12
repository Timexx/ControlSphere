import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { realtimeEvents } from '@/lib/realtime-events'
import { setScanProgress } from '@/lib/scan-progress-store'

function hashSecretKey(secret: string) {
  return crypto.createHash('sha256').update(secret).digest('hex')
}

async function verifyAgent(machineId: string, providedSecret: string | undefined) {
  if (!providedSecret) {
    return { ok: false, status: 401, message: 'Missing agent secret' as const }
  }

  const machine = await prisma.machine.findUnique({
    where: { id: machineId },
    select: { id: true, secretKey: true, secretKeyHash: true }
  })

  if (!machine) {
    return { ok: false, status: 404, message: 'Machine not found' as const }
  }

  const hashed = hashSecretKey(providedSecret)
  const valid =
    (machine.secretKeyHash && machine.secretKeyHash === hashed) ||
    (machine.secretKey && machine.secretKey === providedSecret)

  if (!valid) {
    return { ok: false, status: 401, message: 'Invalid agent secret' as const }
  }

  return { ok: true, machine }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const machineId = body.machineId as string
    const progress = typeof body.progress === 'number' ? Math.max(0, Math.min(100, Math.round(body.progress))) : 0
    const phase = typeof body.phase === 'string' ? body.phase : 'unknown'
    const etaSeconds = typeof body.etaSeconds === 'number' ? Math.max(0, Math.round(body.etaSeconds)) : null
    const startedAt = typeof body.startedAt === 'string' ? body.startedAt : null

    const providedSecret =
      request.headers.get('x-agent-secret') ||
      (typeof body.secretKey === 'string' ? body.secretKey : undefined)

    if (!machineId) {
      return NextResponse.json({ error: 'machineId required' }, { status: 400 })
    }

    const auth = await verifyAgent(machineId, providedSecret)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.message }, { status: auth.status })
    }

    realtimeEvents.emitScanProgress(machineId, {
      progress,
      phase,
      etaSeconds,
      startedAt: startedAt || new Date().toISOString()
    })

    setScanProgress(machineId, {
      progress,
      phase,
      etaSeconds,
      startedAt: startedAt || new Date().toISOString()
    })

    await prisma.scanProgressState.upsert({
      where: { machineId },
      update: {
        progress,
        phase,
        etaSeconds: etaSeconds ?? null,
        startedAt: startedAt ? new Date(startedAt) : new Date()
      },
      create: {
        machineId,
        progress,
        phase,
        etaSeconds: etaSeconds ?? null,
        startedAt: startedAt ? new Date(startedAt) : new Date()
      }
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Error handling scan progress:', error)
    return NextResponse.json({ error: 'Failed to handle scan progress' }, { status: 500 })
  }
}
