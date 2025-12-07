import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { orchestrator } from '@/lib/orchestrator'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const group = await prisma.group.findUnique({
      where: { id: params.id },
      include: {
        members: {
          include: {
            machine: {
              select: {
                id: true,
                hostname: true,
                ip: true,
                status: true
              }
            }
          }
        }
      }
    })

    if (!group) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 })
    }

    let resolvedMachines = group.members.map((m) => m.machine)
    if (group.type === 'dynamic') {
      resolvedMachines = await orchestrator.resolveTargets({
        targetType: 'dynamic',
        groupId: group.id,
        dynamicQuery: orchestrator.parseJsonMaybe(group.query),
        machineIds: []
      })
    }

    return NextResponse.json({
      group: {
        id: group.id,
        name: group.name,
        description: group.description,
        type: group.type,
        query: orchestrator.parseJsonMaybe(group.query),
        createdAt: group.createdAt,
        updatedAt: group.updatedAt,
        members: group.type === 'static' ? group.members : [],
        resolvedMachines
      }
    })
  } catch (error) {
    console.error('Error fetching group:', error)
    return NextResponse.json({ error: 'Failed to fetch group' }, { status: 500 })
  }
}
