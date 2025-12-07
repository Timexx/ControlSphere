import { createServer, IncomingMessage, Server, ServerResponse } from 'http'
import type { ServerConfig } from '../../types/config'
import type { ILogger } from '../../types/logger'

export type HttpHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void> | void

export class HttpServer {
  private server: Server | null = null

  constructor(
    private readonly config: ServerConfig,
    private readonly handler: HttpHandler,
    private readonly logger: ILogger
  ) {}

  async start(): Promise<void> {
    if (this.server) return

    this.server = createServer(async (req, res) => {
      if (req.headers.upgrade === 'websocket') {
        // WebSocket upgrades handled separately by WebSocketUpgradeHandler
        this.logger.debug('HttpServerUpgradeSkipped', { url: req.url })
        return
      }

      try {
        await this.handler(req, res)
      } catch (error) {
        this.logger.error('HttpServerRequestFailed', {
          url: req.url,
          method: req.method,
          error: error instanceof Error ? error.message : String(error)
        })

        if (!res.headersSent) {
          res.statusCode = 500
          res.end('Internal Server Error')
        }
      }
    })

    await new Promise<void>((resolve, reject) => {
      this.server!.listen(this.config.port, this.config.hostname ?? '0.0.0.0', () => {
        this.logger.info('HttpServerStarted', {
          port: this.config.port,
          hostname: this.config.hostname ?? '0.0.0.0'
        })
        resolve()
      })
      this.server!.on('error', reject)
    })
  }

  async stop(): Promise<void> {
    if (!this.server) return

    await new Promise<void>((resolve, reject) => {
      this.server!.close((err) => {
        if (err) {
          reject(err)
          return
        }
        this.logger.info('HttpServerStopped', {})
        resolve()
      })
    })

    this.server = null
  }

  get instance(): Server | null {
    return this.server
  }
}
