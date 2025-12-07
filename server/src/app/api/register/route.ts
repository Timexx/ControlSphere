import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generateSecretKey, hashSecretKey } from '@/lib/crypto'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { hostname, ip, osInfo } = body

    if (!hostname || !ip) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Generate a secret key for this machine
    const secretKey = generateSecretKey()
    const secretKeyHash = hashSecretKey(secretKey)

    const machine = await prisma.machine.create({
      data: {
        hostname,
        ip,
        osInfo: osInfo ? JSON.stringify(osInfo) : null,
        secretKeyHash,
        status: 'offline',
      },
      select: {
        id: true,
        hostname: true,
        ip: true,
        osInfo: true,
        status: true,
        lastSeen: true,
        notes: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    return NextResponse.json({
      machine,
      secretKey, // Only returned once during registration
      message: 'Machine registered successfully. Save the secretKey - it will not be shown again.',
    })
  } catch (error) {
    console.error('Error registering machine:', error)
    return NextResponse.json(
      { error: 'Failed to register machine' },
      { status: 500 }
    )
  }
}
