import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { stateCache } from '@/lib/state-cache'
import { getSession } from '@/lib/auth'
import { canAccessMachine } from '@/lib/authorization'
import { createAuditEntry } from '@/lib/audit'

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params

    // Only admin or machine creator can delete
    const session = await getSession()
    const userId = session?.user?.id
    const role = session?.user?.role || 'viewer'

    if (role === 'viewer') {
      return NextResponse.json({ error: 'Forbidden: Viewers cannot delete machines' }, { status: 403 })
    }

    if (role !== 'admin') {
      // Non-admin users can only delete their own machines
      const machine = await prisma.machine.findUnique({
        where: { id },
        select: { createdBy: true },
      })
      if (!machine || machine.createdBy !== userId) {
        return NextResponse.json({ error: 'Forbidden: Can only delete machines you created' }, { status: 403 })
      }
    }

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
