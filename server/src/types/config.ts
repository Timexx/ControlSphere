export interface ServerConfig {
  port: number
  hostname?: string
}

export interface JwtConfig {
  issuer: string
  audience: string
  expiresIn: string | number
}

export interface WebSocketUpgradeConfig {
  /** Allowed pathnames for WS upgrades, e.g. ['/api/agent', '/api/web'] */
  allowedPaths: string[]
  /** Optional flag to enforce JWT authentication on all upgrade requests */
  requireAuth?: boolean
  /** Optional list of paths that require auth (overrides requireAuth when set) */
  requireAuthPaths?: string[]
}
