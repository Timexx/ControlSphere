import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { orchestrator } from '@/lib/orchestrator'

export async function GET() {
  try {
    const groups = await prisma.group.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { members: true } }
      }
    })

    const enriched = await Promise.all(
      groups.map(async (group) => {
        let resolvedCount = group._count.members
        if (group.type === 'dynamic') {
          const targets = await orchestrator.resolveTargets({
            targetType: 'dynamic',
            groupId: group.id,
            machineIds: [],
            dynamicQuery: orchestrator.parseJsonMaybe(group.query)
          })
          resolvedCount = targets.length
        }
        return {
          ...group,
          membersCount: group._count.members,
          resolvedCount,
          query: orchestrator.parseJsonMaybe(group.query)
        }
      })
    )

    return NextResponse.json({ groups: enriched })
  } catch (error) {
    console.error('Error fetching groups:', error)
    return NextResponse.json({ error: 'Failed to fetch groups' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const name = (body.name || '').trim()
    const description = (body.description || '').trim() || null
    const type = body.type === 'dynamic' ? 'dynamic' : 'static'
    const machineIds: string[] = Array.isArray(body.machineIds) ? body.machineIds : []
    const query = body.query || body.dynamicQuery || null

    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    if (type === 'dynamic' && !query) {
      return NextResponse.json({ error: 'Dynamic groups require a query' }, { status: 400 })
    }

    const group = await prisma.group.create({
      data: {
        name,
        description,
        type,
        query: type === 'dynamic' ? JSON.stringify(query || {}) : undefined,
        members: type === 'static' && machineIds.length > 0
          ? {
              createMany: {
                data: machineIds.map((id) => ({ machineId: id }))
              }
            }
          : undefined
      },
      include: {
        _count: { select: { members: true } }
      }
    })

    return NextResponse.json({
      group: {
        ...group,
        membersCount: group._count.members,
        query: orchestrator.parseJsonMaybe(group.query)
      }
    })
  } catch (error) {
    console.error('Error creating group:', error)
    return NextResponse.json({ error: 'Failed to create group' }, { status: 500 })
  }
}
