import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword, encrypt } from '@/lib/auth'
import { cookies } from 'next/headers'

export async function POST(request: Request) {
  try {
    const userCount = await prisma.user.count()
    
    if (userCount > 0) {
      return NextResponse.json(
        { error: 'Setup already completed' },
        { status: 400 }
      )
    }

    const body = await request.json()
    const { username, password } = body

    if (!username || !password) {
      return NextResponse.json(
        { error: 'Username and password are required' },
        { status: 400 }
      )
    }

    const hashedPassword = await hashPassword(password)

    const user = await prisma.user.create({
      data: {
        username,
        password: hashedPassword,
        role: 'admin', // First user is always admin
      },
    })

    // Auto login after setup
    const expires = new Date(Date.now() + 30 * 60 * 1000) // 30 minutes
    const session = await encrypt({
      user: {
        id: user.id,
        username: user.username,
        language: user.language ?? null,
        role: user.role,
      },
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
    console.error('Setup error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
