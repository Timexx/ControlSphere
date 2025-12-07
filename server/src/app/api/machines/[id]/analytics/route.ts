import { NextRequest, NextResponse } from 'next/server'
import type { Metric } from '@prisma/client'
import { prisma } from '@/lib/prisma'

const RANGE_TO_HOURS: Record<string, number> = {
  '24h': 24,
  '7d': 24 * 7,
  '30d': 24 * 30,
  '90d': 24 * 90,
}

function parseRange(rangeParam: string | null) {
  if (!rangeParam) return { rangeKey: '7d', hours: RANGE_TO_HOURS['7d'] }
  if (RANGE_TO_HOURS[rangeParam]) {
    return { rangeKey: rangeParam, hours: RANGE_TO_HOURS[rangeParam] }
  }
  return { rangeKey: '7d', hours: RANGE_TO_HOURS['7d'] }
}

function bucketAverage(points: Metric[], bucketSize: number) {
  if (bucketSize <= 1) {
    return { points, bucketSize }
  }

  const averaged: Metric[] = []

  for (let i = 0; i < points.length; i += bucketSize) {
    const slice = points.slice(i, i + bucketSize)
    const base = slice[slice.length - 1]

    const avg = {
      ...base,
      cpuUsage: average(slice, 'cpuUsage'),
      ramUsage: average(slice, 'ramUsage'),
      ramTotal: average(slice, 'ramTotal'),
      ramUsed: average(slice, 'ramUsed'),
      diskUsage: average(slice, 'diskUsage'),
      diskTotal: average(slice, 'diskTotal'),
      diskUsed: average(slice, 'diskUsed'),
      uptime: Math.round(average(slice, 'uptime')),
    }

    averaged.push(avg)
  }

  return { points: averaged, bucketSize }
}

function average(points: Metric[], key: keyof Metric) {
  if (points.length === 0) return 0
  const total = points.reduce((sum, point) => {
    const value = point[key]
    return typeof value === 'number' ? sum + value : sum
  }, 0)
  return total / points.length
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { searchParams } = new URL(request.url)
    const rangeData = parseRange(searchParams.get('range'))
    const maxPoints = Math.min(
      2000,
      Math.max(parseInt(searchParams.get('maxPoints') || '720', 10) || 720, 120)
    )

    const startTime = new Date(Date.now() - rangeData.hours * 60 * 60 * 1000)
    const fetchCap = Math.min(maxPoints * 8, 5000)

    const metrics = await prisma.metric.findMany({
      where: {
        machineId: params.id,
        timestamp: { gte: startTime },
      },
      orderBy: { timestamp: 'desc' },
      take: fetchCap,
    })

    // No metrics recorded for the window
    if (!metrics.length) {
      return NextResponse.json({
        points: [],
        rawCount: 0,
        bucketSize: 1,
        rangeKey: rangeData.rangeKey,
        rangeHours: rangeData.hours,
      })
    }

    // Sort ascending for the chart
    const ordered = metrics.reverse()
    const bucketSize = Math.max(1, Math.ceil(ordered.length / maxPoints))
    const { points, bucketSize: appliedBucket } = bucketAverage(ordered, bucketSize)

    const serialized = points.map((point) => ({
      id: point.id,
      machineId: point.machineId,
      cpuUsage: point.cpuUsage,
      ramUsage: point.ramUsage,
      ramTotal: point.ramTotal,
      ramUsed: point.ramUsed,
      diskUsage: point.diskUsage,
      diskTotal: point.diskTotal,
      diskUsed: point.diskUsed,
      uptime: point.uptime,
      timestamp: point.timestamp instanceof Date ? point.timestamp.toISOString() : new Date(point.timestamp).toISOString(),
    }))

    return NextResponse.json({
      points: serialized,
      rawCount: metrics.length,
      bucketSize: appliedBucket,
      rangeKey: rangeData.rangeKey,
      rangeHours: rangeData.hours,
    })
  } catch (error) {
    console.error('Error fetching historical analytics:', error)
    return NextResponse.json(
      { error: 'Failed to fetch analytics' },
      { status: 500 }
    )
  }
}
