import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// Helper: Parse filters from query
function parseFilters(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  return {
    userId: searchParams.get('userId') || undefined,
    machineId: searchParams.get('machineId') || undefined,
    action: searchParams.get('action') || undefined,
    eventType: searchParams.get('eventType') || undefined,
    severity: searchParams.get('severity') || undefined,
    from: searchParams.get('from') ? new Date(searchParams.get('from')!) : undefined,
    to: searchParams.get('to') ? new Date(searchParams.get('to')!) : undefined,
    limit: searchParams.get('limit') ? Math.min(Number(searchParams.get('limit')), 100) : 50,
    offset: searchParams.get('offset') ? Number(searchParams.get('offset')) : 0,
  }
}

export async function GET(req: NextRequest) {
  // Secure: Only logged-in users (admins) can access
  const session = await getSession()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const filters = parseFilters(req)
  const where: any = {}
  if (filters.userId) where.userId = filters.userId
  if (filters.machineId) where.machineId = filters.machineId
  if (filters.action) where.action = filters.action
  if (filters.eventType) where.eventType = filters.eventType
  if (filters.severity) where.severity = filters.severity
  if (filters.from || filters.to) {
    where.createdAt = {}
    if (filters.from) where.createdAt.gte = filters.from
    if (filters.to) where.createdAt.lte = filters.to
  }

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: filters.limit,
      skip: filters.offset,
      include: {
        machine: {
          select: {
            hostname: true,
            ip: true,
          },
        },
        user: {
          select: {
            username: true,
          },
        },
      },
    }),
    prisma.auditLog.count({ where })
  ])

  return NextResponse.json({ logs, total, limit: filters.limit, offset: filters.offset })
}
