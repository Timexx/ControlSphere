import { WebSocket } from 'ws'
import type { UserRole } from '../lib/authorization'

export interface MachineConnectionInfo {
  socket: WebSocket
}

export interface CommandSessionInfo {
  machineId: string
  timestamp: number
}

export interface TerminalSessionInfo {
  machineId: string
  /** Browser socket that opened the session; output goes only there. */
  owner?: WebSocket
}

export type MachineAccess = 'all' | Set<string>

export interface WebClientSessionInfo {
  userId: string
  username?: string
  role: UserRole
  /** Machines this client may see; refreshed periodically by the web manager. */
  machineAccess: MachineAccess
  accessLoadedAt: number
}

/** Extract the machine a broadcast payload belongs to (null = not machine-scoped). */
export function machineIdOfEvent(data: any): string | null {
  if (!data || typeof data !== 'object') return null
  if (typeof data.machineId === 'string' && data.machineId) return data.machineId
  if (data.machine && typeof data.machine.id === 'string') return data.machine.id
  return null
}

export class ConnectionRegistry {
  private machineConnections = new Map<string, MachineConnectionInfo>()
  private terminalSessions = new Map<string, TerminalSessionInfo>()
  private commandSessions = new Map<string, CommandSessionInfo>()
  private webClientSessions = new Map<WebSocket, WebClientSessionInfo>()

  setMachine(machineId: string, socket: WebSocket): void {
    this.machineConnections.set(machineId, { socket })
  }

  getMachine(machineId: string): WebSocket | null {
    return this.machineConnections.get(machineId)?.socket ?? null
  }

  /** True if `socket` is the currently registered connection for `machineId`. */
  isCurrentMachineSocket(machineId: string, socket: WebSocket): boolean {
    return this.machineConnections.get(machineId)?.socket === socket
  }

  deleteMachine(machineId: string): void {
    this.machineConnections.delete(machineId)
    for (const [commandId, info] of this.commandSessions.entries()) {
      if (info.machineId === machineId) {
        this.commandSessions.delete(commandId)
      }
    }
    for (const [sessionId, info] of this.terminalSessions.entries()) {
      if (info.machineId === machineId) {
        this.terminalSessions.delete(sessionId)
      }
    }
  }

  setTerminalSession(sessionId: string, machineId: string, owner?: WebSocket): void {
    this.terminalSessions.set(sessionId, { machineId, owner })
  }

  getTerminalSession(sessionId: string): string | undefined {
    return this.terminalSessions.get(sessionId)?.machineId
  }

  getTerminalOwner(sessionId: string): WebSocket | undefined {
    return this.terminalSessions.get(sessionId)?.owner
  }

  deleteTerminalSession(sessionId: string): void {
    this.terminalSessions.delete(sessionId)
  }

  findTerminalSessionByMachine(machineId: string): string | undefined {
    for (const [sid, info] of this.terminalSessions.entries()) {
      if (info.machineId === machineId) return sid
    }
    return undefined
  }

  setCommandSession(commandId: string, machineId: string): void {
    this.commandSessions.set(commandId, { machineId, timestamp: Date.now() })
  }

  getCommandMachine(commandId: string): string | undefined {
    return this.commandSessions.get(commandId)?.machineId
  }

  getLastCommandForMachine(machineId: string): string | null {
    let latest: { commandId: string; timestamp: number } | null = null
    for (const [cmdId, info] of this.commandSessions.entries()) {
      if (info.machineId === machineId) {
        if (!latest || info.timestamp > latest.timestamp) {
          latest = { commandId: cmdId, timestamp: info.timestamp }
        }
      }
    }
    return latest?.commandId ?? null
  }

  clearCommand(commandId: string): void {
    this.commandSessions.delete(commandId)
  }

  setWebClient(ws: WebSocket, info: WebClientSessionInfo): void {
    this.webClientSessions.set(ws, info)
  }

  getWebClient(ws: WebSocket): WebClientSessionInfo | undefined {
    return this.webClientSessions.get(ws)
  }

  updateWebClient(ws: WebSocket, patch: Partial<WebClientSessionInfo>): void {
    const cur = this.webClientSessions.get(ws)
    if (cur) this.webClientSessions.set(ws, { ...cur, ...patch })
  }

  deleteWebClient(ws: WebSocket): void {
    this.webClientSessions.delete(ws)
    for (const [sessionId, info] of this.terminalSessions.entries()) {
      if (info.owner === ws) this.terminalSessions.delete(sessionId)
    }
  }

  listWebClients(): Iterable<WebSocket> {
    return this.webClientSessions.keys()
  }

  listWebClientEntries(): Iterable<[WebSocket, WebClientSessionInfo]> {
    return this.webClientSessions.entries()
  }

  /** Whether a web client may receive events for `machineId`. */
  canClientSeeMachine(ws: WebSocket, machineId: string): boolean {
    const info = this.webClientSessions.get(ws)
    if (!info) return false
    if (info.machineAccess === 'all') return true
    return info.machineAccess.has(machineId)
  }

  /**
   * Send an event to web clients. Machine-scoped events (payload has
   * `machineId` or `machine.id`) only reach clients with access to that
   * machine; everything else goes to all authenticated clients.
   */
  broadcastToWebClients(data: any): void {
    const machineId = machineIdOfEvent(data)
    const message = JSON.stringify(data)
    for (const [ws, info] of this.webClientSessions.entries()) {
      if (ws.readyState !== WebSocket.OPEN) continue
      if (machineId && info.machineAccess !== 'all' && !info.machineAccess.has(machineId)) continue
      try {
        ws.send(message)
      } catch {
        // socket closing; cleanup happens in the close handler
      }
    }
  }

  listAgentSockets(): WebSocket[] {
    return Array.from(this.machineConnections.values()).map(info => info.socket)
  }
}
