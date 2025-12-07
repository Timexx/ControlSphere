import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { describe, expect, it, beforeEach } from 'vitest'
import { ConsoleLogger } from '../../../types/logger'
import { SecretKeyManager } from '../SecretKeyManager'

const logger = new ConsoleLogger()

describe('SecretKeyManager', () => {
  let tmpDir: string
  let envPath: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skm-'))
    envPath = path.join(tmpDir, '.env')
  })

  it('generates a new secret when none exists', async () => {
    const manager = new SecretKeyManager(envPath, logger)
    const secret = await manager.ensureJWTSecret()
    const fileContent = await fs.readFile(envPath, 'utf8')

    expect(secret.length).toBeGreaterThanOrEqual(32)
    expect(fileContent).toContain('JWT_SECRET=')
  })

  it('rotates weak secrets', async () => {
    await fs.writeFile(envPath, 'JWT_SECRET=secret')
    const manager = new SecretKeyManager(envPath, logger)
    const rotated = await manager.ensureJWTSecret()
    expect(rotated).not.toBe('secret')
  })

  it('supports explicit rotation', async () => {
    const manager = new SecretKeyManager(envPath, logger)
    const first = await manager.ensureJWTSecret()
    const rotated = await manager.rotateSecret()
    expect(rotated).not.toBe(first)
  })
})
