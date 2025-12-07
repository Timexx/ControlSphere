import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

function normalizeUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed
  }
  return `https://${trimmed}`
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json()
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    const url = typeof body.url === 'string' ? body.url : ''
    const description = typeof body.description === 'string'
      ? body.description.trim() || null
      : null

    if (!title || !url) {
      return NextResponse.json(
        { error: 'Titel und URL sind erforderlich' },
        { status: 400 }
      )
    }

    const machine = await prisma.machine.findUnique({
      where: { id: params.id },
      select: { id: true }
    })

    if (!machine) {
      return NextResponse.json(
        { error: 'Machine not found' },
        { status: 404 }
      )
    }

    const normalizedUrl = normalizeUrl(url)
    try {
      new URL(normalizedUrl)
    } catch (error) {
      return NextResponse.json(
        { error: 'Ungültige URL' },
        { status: 400 }
      )
    }

    const link = await prisma.machineLink.create({
      data: {
        machineId: machine.id,
        title,
        url: normalizedUrl,
        description,
      }
    })

    return NextResponse.json({ link })
  } catch (error) {
    console.error('Error creating machine link:', error)
    return NextResponse.json(
      { error: 'Failed to create link' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json()
    const linkId = typeof body.linkId === 'string' ? body.linkId : ''

    if (!linkId) {
      return NextResponse.json(
        { error: 'Link ID is required' },
        { status: 400 }
      )
    }

    const link = await prisma.machineLink.findFirst({
      where: {
        id: linkId,
        machineId: params.id
      },
      select: { id: true }
    })

    if (!link) {
      return NextResponse.json(
        { error: 'Link not found' },
        { status: 404 }
      )
    }

    await prisma.machineLink.delete({
      where: { id: link.id }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting machine link:', error)
    return NextResponse.json(
      { error: 'Failed to delete link' },
      { status: 500 }
    )
  }
}
