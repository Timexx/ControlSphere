# JwtAuthService (Infrastructure Layer)

**Pfad:** `server/src/infrastructure/auth/JwtAuthService.ts`
**Zweck:** Signierung/Verifikation von JWTs mit Secret-Versionierung via SecretKeyManager.
**ISO-Fokus:** A.14.2 Secure Development, A.14.2.5 Secure Authentication, A.12.4 Logging.

## Kernverhalten
- HS256 Signierung mit `issuer`, `audience`, `expiresIn` aus `JwtConfig`.
- Secret via `secretProvider` (z. B. `SecretKeyManager.ensureJWTSecret`).
- Warnung bei schwachen Secrets (<32 Zeichen), Caching des Schlüsselmaterials.

## Code (aus produktivem Modul)
```typescript
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
```

## Test-Hinweise
- Sign/Verify mit gültigem Secret → Payload unverändert.
- Schwaches Secret → Warn-Log, aber Token dennoch nutzbar (nur für Dev; in Prod rotieren).
- Token mit falscher Audience/Issuer → Verifikation schlägt fehl.

## Compliance-Notizen
- **A.14.2.5 Secure Authentication:** Standardisierte JWT-Claims, Ablaufzeit erzwingt Re-Auth.
- **A.12.4 Logging:** Auditierbare Events bei Sign/Verify.
- **Key Hygiene:** Secret aus SecretKeyManager; Rotation über `rotateSecret()` dokumentiert.
