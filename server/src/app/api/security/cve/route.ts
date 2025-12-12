import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { getCveMirrorState, triggerCveMirrorOnce } from '../../../../services/cve-mirror'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const state = await getCveMirrorState()
    const totalCves = await prisma.cve.count()
    return NextResponse.json({
      status: state?.status ?? 'idle',
      lastSync: state?.lastSync ?? null,
      error: state?.error ?? null,
      mode: state?.mode ?? 'full',
      ecosystems: state?.ecosystems ? JSON.parse(state.ecosystems) : [],
      totalCves: totalCves
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return NextResponse.json(
        { status: 'error', lastSync: null, error: `Database error (${error.code})` },
        { status: 500 }
      )
    }
    console.error('Failed to fetch CVE mirror state:', error)
    return NextResponse.json({ status: 'error', lastSync: null, error: 'Failed to fetch CVE mirror state' }, { status: 500 })
  }
}

export async function POST() {
  try {
    const result = await triggerCveMirrorOnce()
    const state = await getCveMirrorState()
    const totalCves = await prisma.cve.count()

    return NextResponse.json({
      accepted: result.accepted,
      status: state?.status ?? result.status,
      lastSync: state?.lastSync ?? null,
      error: state?.error ?? null,
      mode: state?.mode ?? 'full',
      ecosystems: state?.ecosystems ? JSON.parse(state.ecosystems) : [],
      totalCves
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return NextResponse.json(
        { accepted: false, status: 'error', error: `Database error (${error.code})` },
        { status: 500 }
      )
    }
    console.error('Failed to trigger CVE mirror:', error)
    return NextResponse.json({ accepted: false, status: 'error', error: 'Failed to trigger CVE mirror' }, { status: 500 })
  }
}
