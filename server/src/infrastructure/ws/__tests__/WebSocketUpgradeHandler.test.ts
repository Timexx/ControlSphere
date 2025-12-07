import http from 'http'
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { WebSocket } from 'ws'
import { WebSocketUpgradeHandler } from '../WebSocketUpgradeHandler'
import { ConsoleLogger } from '../../../types/logger'
import { JwtAuthService } from '../../auth/JwtAuthService'
import type { JwtConfig } from '../../../types/config'

const logger = new ConsoleLogger()
const jwtConfig: JwtConfig = {
  issuer: 'maintainer.local',
  audience: 'maintainer.clients',
  expiresIn: '1h'
}
const secret = async () => 'this_is_a_strong_secret_with_min_length_32'

function startServer(): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(404)
      res.end()
    })
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

describe('WebSocketUpgradeHandler', () => {
  let server: http.Server

  beforeEach(async () => {
    server = await startServer()
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('accepts allowed path without auth', async () => {
    const jwt = new JwtAuthService(secret, jwtConfig, logger)
    const handler = new WebSocketUpgradeHandler(
      server,
      { allowedPaths: ['/ws/test'], requireAuth: false },
      jwt,
      logger,
      {
        '/ws/test': (socket) => {
          socket.send('ok')
        }
      }
    )
    handler.attach()

    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/test`)

    const result = await new Promise<string>((resolve, reject) => {
      ws.on('message', (data) => {
        resolve(data.toString())
        ws.close()
      })
      ws.on('error', reject)
    })

    expect(result).toBe('ok')
  })

  it('requires auth when configured', async () => {
    const jwt = new JwtAuthService(secret, jwtConfig, logger)
    const handler = new WebSocketUpgradeHandler(
      server,
      { allowedPaths: ['/ws/secure'], requireAuth: true },
      jwt,
      logger,
      {
        '/ws/secure': (socket) => {
          socket.send('secured')
        }
      }
    )
    handler.attach()

    const token = await jwt.sign({ sub: 'user-42' })
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/secure?token=${token}`)

    const result = await new Promise<string>((resolve, reject) => {
      ws.on('message', (data) => {
        resolve(data.toString())
        ws.close()
      })
      ws.on('error', reject)
    })

    expect(result).toBe('secured')
  })

  it('requires auth only on configured paths', async () => {
    const jwt = new JwtAuthService(secret, jwtConfig, logger)
    const handler = new WebSocketUpgradeHandler(
      server,
      { allowedPaths: ['/ws/open', '/ws/secure'], requireAuthPaths: ['/ws/secure'] },
      jwt,
      logger,
      {
        '/ws/open': (socket) => socket.send('open'),
        '/ws/secure': (socket) => socket.send('secure')
      }
    )
    handler.attach()

    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0

    // Open path should work without token
    const openWs = new WebSocket(`ws://127.0.0.1:${port}/ws/open`)
    const openResult = await new Promise<string>((resolve, reject) => {
      openWs.on('message', (data) => {
        resolve(data.toString())
        openWs.close()
      })
      openWs.on('error', reject)
    })
    expect(openResult).toBe('open')

    // Secure path should fail without token
    await expect(
      new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/secure`)
        ws.on('open', () => reject(new Error('should not open without token')))
        ws.on('close', () => resolve(true))
        ws.on('error', () => resolve(true))
      })
    ).resolves.toBeTruthy()

    // Secure path works with token
    const token = await jwt.sign({ sub: 'user-99' })
    const secureWs = new WebSocket(`ws://127.0.0.1:${port}/ws/secure?token=${token}`)
    const secureResult = await new Promise<string>((resolve, reject) => {
      secureWs.on('message', (data) => {
        resolve(data.toString())
        secureWs.close()
      })
      secureWs.on('error', reject)
    })
    expect(secureResult).toBe('secure')
  })

  it('rejects upgrade when token missing and auth required', async () => {
    const jwt = new JwtAuthService(secret, jwtConfig, logger)
    const handler = new WebSocketUpgradeHandler(
      server,
      { allowedPaths: ['/ws/secure'], requireAuth: true },
      jwt,
      logger,
      { '/ws/secure': () => {} }
    )
    handler.attach()

    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0

    await expect(
      new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/secure`)
        ws.on('open', () => reject(new Error('should not open without token')))
        ws.on('close', () => resolve(true))
        ws.on('error', () => resolve(true))
      })
    ).resolves.toBeTruthy()
  })

  it('rejects unknown path', async () => {
    const jwt = new JwtAuthService(secret, jwtConfig, logger)
    const handler = new WebSocketUpgradeHandler(
      server,
      { allowedPaths: ['/ws/test'], requireAuth: false },
      jwt,
      logger,
      {}
    )
    handler.attach()

    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0

    await expect(
      new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/forbidden`)
        ws.on('open', () => reject(new Error('should not open')))
        ws.on('close', () => resolve(true))
        ws.on('error', () => resolve(true))
      })
    ).resolves.toBeTruthy()
  })
})
