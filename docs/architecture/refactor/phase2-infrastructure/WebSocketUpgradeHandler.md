# WebSocketUpgradeHandler (Infrastructure Layer)

**Pfad:** `server/src/infrastructure/ws/WebSocketUpgradeHandler.ts`
**Zweck:** Zentraler Upgrade-Pfad mit Pfad-Whitelisting, optionaler JWT-Auth und Handler-Dispatch.
**ISO-Fokus:** A.13.1 Network Security, A.14.2.5 Secure Authentication, A.12.4 Logging.

## Kernverhalten
- Whitelist der erlaubten Pfade (`allowedPaths`).
- Optionaler Pflicht-JWT (`requireAuth`) mit Token-Extraktion aus Header, Query oder Subprotocol.
- Delegiert an modulare Route-Handler (z. B. Agent-/Web-Client-Sockets).

## Code (aus produktivem Modul)
```typescript
import { IncomingMessage, Server as HttpServer } from 'http'
import { URL } from 'url'
import { WebSocket, WebSocketServer } from 'ws'
import { AuthContext } from '../../types/auth'
import { WebSocketUpgradeConfig } from '../../types/config'
import { ILogger } from '../../types/logger'
import { IJwtAuthService } from '../auth/JwtAuthService'

export type WebSocketRouteHandler = (
  socket: WebSocket,
  request: IncomingMessage,
  context?: AuthContext
) => void | Promise<void>

export class WebSocketUpgradeHandler {
  private readonly wss: WebSocketServer

  constructor(
    private readonly server: HttpServer,
    private readonly config: WebSocketUpgradeConfig,
    private readonly jwtAuthService: IJwtAuthService,
    private readonly logger: ILogger,
    private readonly routes: Record<string, WebSocketRouteHandler>
  ) {
    this.wss = new WebSocketServer({ noServer: true })
  }

  attach(): void {
    this.server.on('upgrade', (request, socket, head) => {
      this.handleUpgrade(request, socket, head).catch((error) => {
        this.logger.error('WebSocketUpgradeFailed', {
          url: request.url,
          error: error instanceof Error ? error.message : String(error)
        })
        socket.destroy()
      })
    })
  }

  private async handleUpgrade(
    request: IncomingMessage,
    socket: import('net').Socket,
    head: Buffer
  ): Promise<void> {
    const url = request.url ? new URL(request.url, 'http://localhost') : null
    const pathname = url?.pathname ?? ''

    if (!this.config.allowedPaths.includes(pathname)) {
      this.logger.warn('WebSocketUpgradeRejectedPath', { pathname })
      socket.destroy()
      return
    }

    const context = this.config.requireAuth ? await this.authenticate(request) : undefined
    const handler = this.routes[pathname]

    if (!handler) {
      this.logger.warn('WebSocketUpgradeNoHandler', { pathname })
      socket.destroy()
      return
    }

    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.wss.emit('connection', ws, request)
      Promise.resolve(handler(ws, request, context)).catch((error) => {
        this.logger.error('WebSocketRouteHandlerError', {
          pathname,
          error: error instanceof Error ? error.message : String(error)
        })
        ws.close(1011, 'Unexpected error')
      })
    })

    this.logger.info('WebSocketUpgradeAccepted', { pathname })
  }

  private async authenticate(request: IncomingMessage): Promise<AuthContext> {
    const token = this.extractToken(request)
    if (!token) {
      throw new Error('Missing token')
    }

    const context = await this.jwtAuthService.verify(token)
    return context
  }

  private extractToken(request: IncomingMessage): string | null {
    const authHeader = request.headers['authorization']
    if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
      return authHeader.slice(7)
    }

    const url = request.url ? new URL(request.url, 'http://localhost') : null
    const tokenFromQuery = url?.searchParams.get('token')
    if (tokenFromQuery) return tokenFromQuery

    const protocolHeader = request.headers['sec-websocket-protocol']
    if (typeof protocolHeader === 'string' && protocolHeader.startsWith('jwt.')) {
      return protocolHeader.replace(/^jwt\./, '')
    }

    return null
  }
}
```

## Test-Hinweise
- Pfad-Whitelist erzwingt Ablehnung unbekannter Pfade.
- Auth-Pfade: fehlendes Token → Fehler, gültiges Token → akzeptiert.
- Handler-Fehler schließen Socket mit 1011 und Log-Eintrag.

## Compliance-Notizen
- **A.13.1 Network Security:** Whitelist + kontrollierte Upgrades.
- **A.14.2.5 Secure Authentication:** Token-Pflicht bei `requireAuth=true`, mehrere Token-Quellen dokumentiert.
- **A.12.4 Logging:** Ereignisse `UpgradeAccepted/Rejected/Failed` + Handler-Fehler mit Context.
