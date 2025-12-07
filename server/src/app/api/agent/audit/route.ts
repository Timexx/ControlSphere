import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { realtimeEvents } from '@/lib/realtime-events'

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
    const events = Array.isArray(body.events) ? body.events : []
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

    if (events.length === 0) {
      return NextResponse.json({ inserted: 0 })
    }

    const now = new Date()
    const rows = events.map((evt: any) => {
      const action = typeof evt.action === 'string' ? evt.action : evt.type || 'AGENT_EVENT'
      const severity = typeof evt.severity === 'string' ? evt.severity : 'info'
      const createdAt = evt.timestamp ? new Date(evt.timestamp) : now
      let details: string | undefined

      if (typeof evt.details === 'string') {
        details = evt.details
      } else {
        try {
          details = JSON.stringify(evt.details ?? evt)
        } catch {
          details = undefined
        }
      }

      return {
        machineId,
        action,
        severity,
        details,
        createdAt
      }
    })

    const result = await prisma.auditLog.createMany({
      data: rows
    })

    // Emit real-time events for each audit log
    for (const row of rows) {
      realtimeEvents.emitAuditLog(machineId, {
        id: `temp-${Date.now()}-${Math.random()}`, // Temporary ID for real-time display
        action: row.action,
        severity: row.severity,
        details: row.details || null,
        createdAt: row.createdAt.toISOString()
      })
    }

    return NextResponse.json({ inserted: result.count })
  } catch (error) {
    console.error('Error handling agent audit:', error)
    return NextResponse.json(
      { error: 'Failed to process audit events' },
      { status: 500 }
    )
  }
}
