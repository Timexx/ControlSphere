import { NextRequest, NextResponse } from 'next/server'
import { orchestrator } from '@/lib/orchestrator'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const job = await orchestrator.getJob(params.id)

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    return NextResponse.json({ job })
  } catch (error) {
    console.error('Error fetching job:', error)
    return NextResponse.json({ error: 'Failed to fetch job' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const job = await prisma.job.findUnique({
      where: { id: params.id },
      select: { id: true, status: true, command: true }
    })

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    // Abort running job to clean in-memory state
    if (job.status === 'RUNNING') {
      await orchestrator.abortJob(job.id)
    }

    await prisma.jobExecution.deleteMany({ where: { jobId: job.id } })
    await prisma.job.delete({ where: { id: job.id } })

    // Audit log for job deletion
    try {
      const session = await getSession()
      const ip = request.ip || request.headers.get('x-forwarded-for') || 'unknown'
      const userAgent = request.headers.get('user-agent') || 'unknown'

      await prisma.auditLog.create({
        data: {
          action: 'BULK_JOB_DELETED',
          eventType: 'bulk_operation',
          userId: session?.user?.id || null,
          severity: 'info',
          details: JSON.stringify({
            jobId: job.id,
            command: job.command,
            wasRunning: job.status === 'RUNNING',
            ip,
            userAgent
          })
        } as any
      })
    } catch (err) {
      console.error('Audit log failed for job deletion:', err)
    }

    return NextResponse.json({ deleted: true })
  } catch (error) {
    console.error('Error deleting job:', error)
    return NextResponse.json({ error: 'Failed to delete job' }, { status: 500 })
  }
}
