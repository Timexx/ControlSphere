import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import { ILogger } from '../../types/logger'

export interface ISecretKeyManager {
  ensureJWTSecret(): Promise<string>
  getOrGenerateSecret(): Promise<string>
  rotateSecret(): Promise<string>
}

export class SecretKeyManager implements ISecretKeyManager {
  private readonly insecurePatterns = [
    'change-me',
    'secret',
    'password',
    'test',
    'demo',
    '123456',
    'admin',
    'root',
    'default'
  ]
  private readonly minLength = 32
  private readonly secretByteSize = 64

  constructor(private readonly envPath: string, private readonly logger: ILogger) {}

  async ensureJWTSecret(): Promise<string> {
    const existing = process.env.JWT_SECRET ?? (await this.readSecretFromEnv())
    if (!existing || this.isWeak(existing)) {
      return this.generateAndPersist()
    }
    return existing
  }

  async getOrGenerateSecret(): Promise<string> {
    return this.ensureJWTSecret()
  }

  async rotateSecret(): Promise<string> {
    return this.generateAndPersist()
  }

  private async readSecretFromEnv(): Promise<string | null> {
    try {
      const content = await fs.readFile(this.envPath, 'utf8')
      const match = content.match(/^JWT_SECRET\s*=\s*(.+)$/m)
      return match ? match[1].trim() : null
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }
      this.logger.warn('SecretEnvReadFailed', { error })
      return null
    }
  }

  private async generateAndPersist(): Promise<string> {
    const secret = crypto.randomBytes(this.secretByteSize).toString('base64')
    await this.writeSecret(secret)
    process.env.JWT_SECRET = secret
    this.logger.info('JwtSecretGenerated', { length: secret.length })
    return secret
  }

  private async writeSecret(secret: string): Promise<void> {
    const dir = path.dirname(this.envPath)
    await fs.mkdir(dir, { recursive: true })

    let content = ''
    try {
      content = await fs.readFile(this.envPath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn('SecretEnvReadBeforeWriteFailed', { error })
      }
    }

    const lines = content.split(/\r?\n/).filter((line) => !line.startsWith('JWT_SECRET='))
    lines.push(`JWT_SECRET=${secret}`)
    await fs.writeFile(this.envPath, lines.join('\n'), 'utf8')
  }

  private isWeak(secret: string): boolean {
    if (!secret || secret.length < this.minLength) return true
    const lower = secret.toLowerCase()
    return this.insecurePatterns.some((pattern) => lower.includes(pattern))
  }
}
