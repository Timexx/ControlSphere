import { SignJWT, jwtVerify } from 'jose'
import { JwtConfig } from '../../types/config'
import { AuthContext, TokenPayload } from '../../types/auth'
import { ILogger } from '../../types/logger'

export interface IJwtAuthService {
  sign(payload: TokenPayload): Promise<string>
  verify(token: string): Promise<AuthContext>
}

export type SecretProvider = () => Promise<string>

export class JwtAuthService implements IJwtAuthService {
  private cachedKey: Uint8Array | null = null

  constructor(
    private readonly secretProvider: SecretProvider,
    private readonly config: JwtConfig,
    private readonly logger: ILogger
  ) {}

  async sign(payload: TokenPayload): Promise<string> {
    const key = await this.getKey()
    const now = Math.floor(Date.now() / 1000)
    const token = await new SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt(now)
      .setIssuer(this.config.issuer)
      .setAudience(this.config.audience)
      .setExpirationTime(this.config.expiresIn)
      .sign(key)

    this.logger.debug('JwtTokenSigned', { sub: payload.sub, exp: this.config.expiresIn })
    return token
  }

  async verify(token: string): Promise<AuthContext> {
    const key = await this.getKey()
    const result = await jwtVerify(token, key, {
      issuer: this.config.issuer,
      audience: this.config.audience
    })

    const payload = result.payload as unknown as TokenPayload
    this.logger.debug('JwtTokenVerified', { sub: payload.sub, role: payload.role })
    return { token, payload }
  }

  private async getKey(): Promise<Uint8Array> {
    if (this.cachedKey) return this.cachedKey

    const secret = await this.secretProvider()
    if (!secret || secret.length < 32) {
      this.logger.warn('JwtSecretWeak', { length: secret?.length ?? 0 })
    }

    const key = new TextEncoder().encode(secret)
    this.cachedKey = key
    return key
  }
}
