import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const machineId = params.id
    const searchParams = request.nextUrl.searchParams
    const status = searchParams.get('status') || undefined
    const all = searchParams.get('all') === 'true'
    const page = parseInt(searchParams.get('page') || '1', 10)
    const pageSize = all ? 10000 : parseInt(searchParams.get('pageSize') || '10000', 10)
    const skip = all ? 0 : (page - 1) * pageSize

    const where: any = { machineId }
    if (status) {
      where.status = status
    }

    const [packages, total, updateCount, securityCount] = await Promise.all([
      prisma.vMPackage.findMany({
        where,
        orderBy: [{ status: 'desc' }, { name: 'asc' }],
        skip,
        take: pageSize
      }),
      prisma.vMPackage.count({ where }),
      prisma.vMPackage.count({ where: { machineId, status: 'update_available' } }),
      prisma.vMPackage.count({ where: { machineId, status: 'security_update' } })
    ])

    return NextResponse.json({
      packages,
      pagination: {
        page,
        pageSize,
        total
      },
      counts: {
        total,
        updateAvailable: updateCount,
        securityUpdates: securityCount
      }
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return NextResponse.json({
        packages: [],
        pagination: { page: 1, pageSize: 0, total: 0 },
        counts: { total: 0, updateAvailable: 0, securityUpdates: 0 },
        warning: `Database error (${error.code})`
      }, { status: 500 })
    }
    console.error('Error fetching VM packages:', error)
    return NextResponse.json(
      { error: 'Failed to fetch packages' },
      { status: 500 }
    )
  }
}
