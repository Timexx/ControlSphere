import http from 'http'
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { HttpServer } from '../HttpServer'
import { ConsoleLogger } from '../../../types/logger'
import type { ServerConfig } from '../../../types/config'

const logger = new ConsoleLogger()

function get(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => resolve({ status: res.statusCode || 0, body: data }))
    }).on('error', reject)
  })
}

describe('HttpServer', () => {
  let server: HttpServer
  let config: ServerConfig

  beforeEach(() => {
    config = { port: 0, hostname: '127.0.0.1' }
  })

  afterEach(async () => {
    await server?.stop()
  })

  it('responds with handler output', async () => {
    server = new HttpServer(
      config,
      async (_req, res) => {
        res.statusCode = 200
        res.end('ok')
      },
      logger
    )

    await server.start()
    const address = server.instance?.address()
    const port = typeof address === 'object' && address ? address.port : 0
    const result = await get(`http://127.0.0.1:${port}`)
    expect(result.status).toBe(200)
    expect(result.body).toBe('ok')
  })

  it('returns 500 when handler throws', async () => {
    server = new HttpServer(
      config,
      async () => {
        throw new Error('boom')
      },
      logger
    )

    await server.start()
    const address = server.instance?.address()
    const port = typeof address === 'object' && address ? address.port : 0
    const result = await get(`http://127.0.0.1:${port}`)
    expect(result.status).toBe(500)
  })
})
