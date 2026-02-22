import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { decrypt } from '@/lib/auth'
import { JwtAuthService } from '@/infrastructure/auth/JwtAuthService'
import { SecretKeyManager } from '@/infrastructure/auth/SecretKeyManager'
import { ConsoleLogger } from '@/types/logger'
import type { JwtConfig } from '@/types/config'
import path from 'path'

export const dynamic = 'force-dynamic'

/**
 * GET /api/auth/get-ws-token
 * Decrypts session cookie and returns a proper JWT token for WebSocket authentication
 * JWT includes required iss/aud claims for JwtAuthService.verify()
 */
export async function GET() {
  try {
    const cookieStore = await cookies()
    const sessionToken = cookieStore.get('session')?.value

    if (!sessionToken) {
      return NextResponse.json(
        { error: 'No session token found' },
        { status: 401 }
      )
    }

    // Decrypt session payload
    const sessionPayload = await decrypt(sessionToken)
    if (!sessionPayload?.user?.id || !sessionPayload?.user?.username) {
      return NextResponse.json(
        { error: 'Invalid session' },
        { status: 401 }
      )
    }

    // Generate proper JWT with required iss/aud claims
    const logger = new ConsoleLogger()
    const envPath = path.join(process.cwd(), '.env')
    const secretKeyManager = new SecretKeyManager(envPath, logger)
    
    const jwtConfig: JwtConfig = {
      issuer: process.env.JWT_ISSUER || 'maintainer.local',
      audience: process.env.JWT_AUDIENCE || 'maintainer.clients',
      expiresIn: '1h'
    }

    const secretProvider = async () => secretKeyManager.ensureJWTSecret()
    const jwtAuthService = new JwtAuthService(secretProvider, jwtConfig, logger)

    const jwtToken = await jwtAuthService.sign({
      sub: sessionPayload.user.id,
      role: sessionPayload.user.role || 'user'
    })

    return NextResponse.json({ token: jwtToken })
  } catch (error) {
    console.error('GetWsToken error:', error)
    return NextResponse.json(
      { error: 'Failed to get token' },
      { status: 500 }
    )
  }
}
