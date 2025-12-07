export interface TokenPayload {
  sub: string
  role?: string
  machineId?: string
  sessionId?: string
  exp?: number
  iat?: number
  [key: string]: unknown
}

export interface AuthContext {
  token: string
  payload: TokenPayload
}
