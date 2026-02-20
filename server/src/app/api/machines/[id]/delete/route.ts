import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { stateCache } from '@/lib/state-cache'

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params

    // Delete all metrics first (foreign key constraint)
    await prisma.metric.deleteMany({
      where: { machineId: id }
    })

    // Delete the machine
    await prisma.machine.delete({
      where: { id }
    })

    // Remove from cache
    stateCache.deleteMachine(id)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting machine:', error)
    return NextResponse.json(
      { error: 'Failed to delete machine' },
      { status: 500 }
    )
  }
}
