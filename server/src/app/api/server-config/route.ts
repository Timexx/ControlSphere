import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const config = await prisma.serverConfig.findUnique({ where: { id: 'global' } })
    return NextResponse.json({ serverUrl: config?.serverUrl ?? null })
  } catch (error) {
    console.error('Failed to get server config:', error)
    return NextResponse.json({ serverUrl: null }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { serverUrl } = body

    if (!serverUrl || typeof serverUrl !== 'string') {
      return NextResponse.json({ error: 'serverUrl is required' }, { status: 400 })
    }

    // Normalize: strip trailing slash, ensure it starts with http:// or https://
    const normalized = serverUrl.replace(/\/+$/, '')
    if (!/^https?:\/\/.+/.test(normalized)) {
      return NextResponse.json(
        { error: 'serverUrl must start with http:// or https://' },
        { status: 400 }
      )
    }

    const config = await prisma.serverConfig.upsert({
      where: { id: 'global' },
      update: { serverUrl: normalized },
      create: { id: 'global', serverUrl: normalized },
    })

    return NextResponse.json({ serverUrl: config.serverUrl })
  } catch (error) {
    console.error('Failed to save server config:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
