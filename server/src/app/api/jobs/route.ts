import { NextRequest, NextResponse } from 'next/server'
import { orchestrator } from '@/lib/orchestrator'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const role = (session.user as any).role || 'user'
    if (role === 'viewer') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    // Admins see all jobs; users see only their own
    const jobs = await orchestrator.listJobs(50, role === 'admin' ? null : session.user.id)
    return NextResponse.json({ jobs })
  } catch (error) {
    console.error('Error fetching jobs:', error)
    return NextResponse.json({ error: 'Failed to fetch jobs' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const role = (session.user as any).role || 'user'
    if (role === 'viewer') {
      return NextResponse.json({ error: 'Forbidden: Viewers cannot create jobs' }, { status: 403 })
    }

    const command = (body.command || '').trim()
    const targetType = body.targetType || 'adhoc'
    const machineIds: string[] = Array.isArray(body.machineIds) ? body.machineIds : []

    if (!command) {
      return NextResponse.json({ error: 'Command is required' }, { status: 400 })
    }

    if (targetType === 'adhoc' && machineIds.length === 0 && !body.dryRun) {
      return NextResponse.json({ error: 'Select at least one machine' }, { status: 400 })
    }

    const payload = {
      name: body.name,
      description: body.description,
      command,
      mode: body.mode,
      targetType,
      groupId: body.groupId,
      machineIds,
      dynamicQuery: body.dynamicQuery || body.query,
      strategy: body.strategy || {},
      dryRun: Boolean(body.dryRun),
      createdByUserId: session.user.id,
    }

    const result = await orchestrator.createJob(payload)

    // Audit log for bulk job creation (skip dry-run)
    if (!body.dryRun) {
      try {
        const session = await getSession()
        const ip = request.ip || request.headers.get('x-forwarded-for') || 'unknown'
        const userAgent = request.headers.get('user-agent') || 'unknown'

        await prisma.auditLog.create({
          data: {
            action: 'BULK_JOB_CREATED',
            eventType: 'bulk_operation',
            userId: session?.user?.id || null,
            severity: 'info',
            details: JSON.stringify({
              jobId: result.id,
              command: payload.command,
              mode: payload.mode,
              targetType: payload.targetType,
              targetCount: result.totalTargets || machineIds.length,
              strategy: payload.strategy,
              ip,
              userAgent
            })
          } as any
        })
      } catch (err) {
        console.error('Audit log failed for bulk job creation:', err)
      }
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('Error creating job:', error)
    const message = error instanceof Error ? error.message : 'Failed to create job'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
