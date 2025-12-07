import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyPassword, decrypt } from '@/lib/auth'
import { cookies } from 'next/headers'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { password } = body

    if (!password) {
      return NextResponse.json(
        { error: 'Password is required' },
        { status: 400 }
      )
    }

    // Get session from cookies (await for Next.js 14+)
    const cookieStore = await cookies()
    const session = cookieStore.get('session')?.value

    console.log('🔐 verify-password: Session cookie present:', !!session)

    if (!session) {
      console.log('❌ verify-password: No session cookie found')
      return NextResponse.json(
        { error: 'No active session' },
        { status: 401 }
      )
    }

    // Decrypt and verify session
    const payload = await decrypt(session)
    console.log('🔐 verify-password: Payload:', payload ? 'valid' : 'invalid', payload?.user ? 'has user' : 'no user')
    
    if (!payload || !payload.user?.id) {
      console.log('❌ verify-password: Invalid session payload, user:', payload?.user)
      return NextResponse.json(
        { error: 'Invalid session' },
        { status: 401 }
      )
    }

    // Get user from database
    const user = await prisma.user.findUnique({
      where: { id: payload.user.id as string },
      select: { id: true, username: true, password: true }
    })

    if (!user) {
      console.log('❌ verify-password: User not found for id:', payload.user.id)
      return NextResponse.json(
        { error: 'User not found' },
        { status: 401 }
      )
    }

    console.log('🔐 verify-password: Verifying password for user:', user.username)

    // Verify password
    const isValid = await verifyPassword(password, user.password)

    if (!isValid) {
      console.log('❌ verify-password: Invalid password')
      return NextResponse.json(
        { error: 'Invalid password' },
        { status: 401 }
      )
    }

    console.log('✅ verify-password: Password verified successfully')
    return NextResponse.json({
      success: true,
      message: 'Password verified successfully'
    })

  } catch (error) {
    console.error('Password verification error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
