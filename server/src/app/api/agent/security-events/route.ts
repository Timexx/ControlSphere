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

interface SecurityEventInput {
  type: string
  severity: string
  message: string
  fingerprint?: string
  data?: Record<string, unknown>
}

const INTEGRITY_IGNORE_PATTERNS = [
  /^\/var\/log\/.*/i,
  /^\/var\/log\/journal\/.*/i,
  /^\/var\/lib\/docker\/containers\/.*/i,
  /^\/var\/cache\/apt\/.*/i,
  /^\/var\/lib\/apt\/.*/i,
  /^\/var\/lib\/dpkg\/.*/i,
  /^\/var\/tmp\/.*/i
]

const INTEGRITY_COOLDOWN_MS = 30 * 60 * 1000 // 30 minutes to avoid log churn during scans

function extractPathFromMessage(message: string | undefined) {
  if (!message) return undefined
  const match = message.match(/File (?:modified|changed):\s*(\S+)/i)
  return match?.[1]
}

function shouldIgnoreIntegrityEvent(path?: string) {
  if (!path) return false
  return INTEGRITY_IGNORE_PATTERNS.some((re) => re.test(path))
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const machineId = body.machineId as string
    const events = Array.isArray(body.events) ? body.events as SecurityEventInput[] : []
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
      return NextResponse.json({ success: true, created: 0, updated: 0 })
    }

    let created = 0
    let updated = 0
    let suppressed = 0

    for (const event of events) {
      const derivedPath = event.data?.path as string | undefined || extractPathFromMessage(event.message)
      const fingerprint = event.fingerprint || (derivedPath ? `${event.type}:${derivedPath}` : `${event.type}:${event.message}`)

      if (event.type === 'integrity' && shouldIgnoreIntegrityEvent(derivedPath)) {
        suppressed++
        continue
      }
      
      // Find existing event by source_ip for failed_auth events (including resolved)
      let existingEvent = null
      
      // Get ALL events of this type for this machine (including resolved)
      const allEvents = await prisma.securityEvent.findMany({
        where: {
          machineId,
          type: event.type
        },
        orderBy: { createdAt: 'desc' }
      })

      // Search for matching event by source_ip or fingerprint
      for (const evt of allEvents) {
        try {
          const data = typeof evt.data === 'string' ? JSON.parse(evt.data) : evt.data
          
          // For failed_auth, match by source_ip
          if (event.type === 'failed_auth' && event.data?.source_ip) {
            if (data?.source_ip === event.data.source_ip) {
              existingEvent = evt
              break
            }
          }
          
          // Also check fingerprint match
          if (data?.fingerprint === fingerprint) {
            existingEvent = evt
            break
          }
        } catch {
          // Ignore parse errors
        }
      }

      if (existingEvent) {
        const cooldownActive =
          event.type === 'integrity' &&
          existingEvent.updatedAt &&
          Date.now() - new Date(existingEvent.updatedAt).getTime() < INTEGRITY_COOLDOWN_MS

        if (cooldownActive && existingEvent.status === 'open') {
          suppressed++
          continue
        }

        // Check if event was manually acknowledged (ack) or resolved
        // If so, don't reopen it - respect the user's decision
        const shouldStayClosed = existingEvent.status === 'resolved' || existingEvent.status === 'ack'
        const newStatus = shouldStayClosed ? existingEvent.status : 'open'
        
        // Update existing event with new data but preserve user's read status
        await prisma.securityEvent.update({
          where: { id: existingEvent.id },
          data: {
            message: event.message,
            severity: event.severity,
            data: JSON.stringify({ ...event.data, path: derivedPath, fingerprint }),
            status: newStatus,
            updatedAt: new Date()
          }
        })
        updated++
        
        // Don't emit WebSocket event for updates - the event already exists in the UI
        // and emitting would cause duplicate counting
      } else {
        // Create new event (no need to resolve old ones since we search all events now)
        const newEvent = await prisma.securityEvent.create({
          data: {
            machineId,
            type: event.type,
            severity: event.severity,
            message: event.message,
            data: JSON.stringify({ ...event.data, path: derivedPath, fingerprint }),
            status: 'open'
          }
        })
        created++

        // Emit new event
        realtimeEvents.emitSecurityEvent(machineId, {
          id: newEvent.id,
          type: newEvent.type,
          severity: newEvent.severity,
          message: newEvent.message,
          status: 'open',
          createdAt: newEvent.createdAt.toISOString()
        })
      }
    }

    console.log(`Security events processed for ${machineId}: ${created} created, ${updated} updated`)

    return NextResponse.json({
      success: true,
      created,
      updated,
      suppressed
    })
  } catch (error) {
    console.error('Error handling security events:', error)
    return NextResponse.json(
      { error: 'Failed to process security events' },
      { status: 500 }
    )
  }
}
