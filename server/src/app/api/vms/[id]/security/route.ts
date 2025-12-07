import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

// Helper function to deduplicate events - keeps only the newest event per source_ip for failed_auth
function deduplicateEvents(events: any[]): any[] {
  const seenSourceIps = new Map<string, any>()
  const result: any[] = []
  
  for (const event of events) {
    // For failed_auth events, deduplicate by source_ip (regardless of status)
    if (event.type === 'failed_auth') {
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
        const sourceIp = data?.source_ip
        
        if (sourceIp) {
          // Keep only the first (newest) event for each source_ip
          if (!seenSourceIps.has(sourceIp)) {
            seenSourceIps.set(sourceIp, event)
            result.push(event)
          }
          continue
        }
      } catch {
        // If we can't parse, include the event
      }
    }
    
    // Include all other event types
    result.push(event)
  }
  
  return result
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const machine = await prisma.machine.findUnique({
      where: { id: params.id },
      select: { id: true, hostname: true }
    })

    if (!machine) {
      return NextResponse.json({ error: 'Machine not found' }, { status: 404 })
    }

    const [rawEvents, auditLogs, lastScan, ports] = await Promise.all([
      prisma.securityEvent.findMany({
        where: { machineId: params.id },
        orderBy: { createdAt: 'desc' },
        take: 100 // Fetch more to account for deduplication
      }),
      prisma.auditLog.findMany({
        where: { machineId: params.id },
        orderBy: { createdAt: 'desc' },
        take: 50
      }),
      prisma.packageScan.findFirst({
        where: { machineId: params.id },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.port.findMany({
        where: { machineId: params.id },
        orderBy: { port: 'asc' }
      })
    ])

    // Deduplicate events - keeps only newest event per source_ip for failed_auth
    const events = deduplicateEvents(rawEvents).slice(0, 50)
    const openEvents = events.filter((e) => e.status === 'open' || e.status === 'ack').length

    return NextResponse.json({
      machine,
      openEvents,
      events,
      auditLogs,
      lastScan,
      ports
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return NextResponse.json({
        machine: { id: params.id, hostname: null },
        openEvents: 0,
        events: [],
        auditLogs: [],
        lastScan: null,
        warning: `Database error (${error.code})`
      }, { status: 500 })
    }
    console.error('Error fetching VM security data:', error)
    return NextResponse.json(
      { error: 'Failed to fetch security data' },
      { status: 500 }
    )
  }
}
