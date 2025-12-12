import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const items = await prisma.cve.findMany({
      orderBy: { publishedAt: 'desc' },
      take: 200
    })

    return NextResponse.json({
      items
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return NextResponse.json(
        { items: [], error: `Database error (${error.code})` },
        { status: 500 }
      )
    }
    console.error('Failed to fetch CVE list:', error)
    return NextResponse.json(
      { items: [], error: 'Failed to fetch CVEs' },
      { status: 500 }
    )
  }
}
