import { describe, expect, it } from 'vitest'
import { JwtAuthService } from '../JwtAuthService'
import { ConsoleLogger } from '../../../types/logger'
import type { JwtConfig } from '../../../types/config'

const logger = new ConsoleLogger()
const config: JwtConfig = {
  issuer: 'maintainer.local',
  audience: 'maintainer.clients',
  expiresIn: '1h'
}

const strongSecret = async () => 'this_is_a_strong_secret_with_min_length_32'

describe('JwtAuthService', () => {
  it('signs and verifies a token', async () => {
    const service = new JwtAuthService(strongSecret, config, logger)
    const token = await service.sign({ sub: 'user-1', role: 'admin' })
    const context = await service.verify(token)
    expect(context.payload.sub).toBe('user-1')
    expect(context.payload.role).toBe('admin')
  })

  it('fails verification when audience is wrong', async () => {
    const service = new JwtAuthService(strongSecret, config, logger)
    const token = await service.sign({ sub: 'user-2' })
    const wrongAudienceConfig: JwtConfig = { ...config, audience: 'other' }
    const verifier = new JwtAuthService(strongSecret, wrongAudienceConfig, logger)
    await expect(verifier.verify(token)).rejects.toThrow()
  })
})
