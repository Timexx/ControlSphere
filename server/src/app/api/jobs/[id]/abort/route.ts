import { NextRequest, NextResponse } from 'next/server'
import { orchestrator } from '@/lib/orchestrator'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await orchestrator.abortJob(params.id)

    // Audit log for job abort
    try {
      const session = await getSession()
      const ip = request.ip || request.headers.get('x-forwarded-for') || 'unknown'
      const userAgent = request.headers.get('user-agent') || 'unknown'

      await prisma.auditLog.create({
        data: {
          action: 'BULK_JOB_ABORTED',
          eventType: 'bulk_operation',
          userId: session?.user?.id || null,
          severity: 'warning',
          details: JSON.stringify({
            jobId: params.id,
            ip,
            userAgent
          })
        } as any
      })
    } catch (err) {
      console.error('Audit log failed for job abort:', err)
    }

    return NextResponse.json({ status: 'ABORTED' })
  } catch (error) {
    console.error('Error aborting job:', error)
    return NextResponse.json({ error: 'Failed to abort job' }, { status: 500 })
  }
}
