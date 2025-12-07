import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyPassword, encrypt } from '@/lib/auth'
import { cookies } from 'next/headers'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { username, password } = body

    console.log('🔐 Login attempt for user:', username)

    if (!username || !password) {
      console.log('❌ Missing username or password')
      return NextResponse.json(
        { error: 'Username and password are required' },
        { status: 400 }
      )
    }

    const user = await prisma.user.findUnique({
      where: { username },
    })

    if (!user) {
      console.log('❌ User not found:', username)
      return NextResponse.json(
        { error: 'Invalid credentials' },
        { status: 401 }
      )
    }

    console.log('✓ User found:', user.username, '(id:', user.id + ')')
    console.log('  Password hash length:', user.password?.length || 0)

    const isValid = await verifyPassword(password, user.password)

    console.log('  Password valid:', isValid)

    if (!isValid) {
      console.log('❌ Invalid password for user:', username)
      return NextResponse.json(
        { error: 'Invalid credentials' },
        { status: 401 }
      )
    }

    // Login success
    console.log('✅ Login successful for user:', username)
    const expires = new Date(Date.now() + 30 * 60 * 1000) // 30 minutes
    const session = await encrypt({
      user: { id: user.id, username: user.username, language: user.language ?? null },
      expires,
    })

    const isSecure = new URL(request.url).protocol === 'https:'

    cookies().set('session', session, {
      expires,
      httpOnly: true,
      sameSite: 'lax',
      secure: isSecure,
      path: '/',
    })

    return NextResponse.json({ success: true, language: user.language })
  } catch (error) {
    console.error('❌ Login error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
