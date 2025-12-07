import { WebSocket } from 'ws'

export interface MachineConnectionInfo {
  socket: WebSocket
}

export interface CommandSessionInfo {
  machineId: string
  timestamp: number
}

export interface WebClientSessionInfo {
  userId: string
  username?: string
}

export class ConnectionRegistry {
  private machineConnections = new Map<string, MachineConnectionInfo>()
  private terminalSessions = new Map<string, string>()
  private commandSessions = new Map<string, CommandSessionInfo>()
  private webClientSessions = new Map<WebSocket, WebClientSessionInfo>()

  setMachine(machineId: string, socket: WebSocket): void {
    this.machineConnections.set(machineId, { socket })
  }

  getMachine(machineId: string): WebSocket | null {
    return this.machineConnections.get(machineId)?.socket ?? null
  }

  deleteMachine(machineId: string): void {
    this.machineConnections.delete(machineId)
    for (const [commandId, info] of this.commandSessions.entries()) {
      if (info.machineId === machineId) {
        this.commandSessions.delete(commandId)
      }
    }
    for (const [sessionId, mid] of this.terminalSessions.entries()) {
      if (mid === machineId) {
        this.terminalSessions.delete(sessionId)
      }
    }
  }

  setTerminalSession(sessionId: string, machineId: string): void {
    this.terminalSessions.set(sessionId, machineId)
  }

  getTerminalSession(sessionId: string): string | undefined {
    return this.terminalSessions.get(sessionId)
  }

  findTerminalSessionByMachine(machineId: string): string | undefined {
    for (const [sid, mid] of this.terminalSessions.entries()) {
      if (mid === machineId) return sid
    }
    return undefined
  }

  setCommandSession(commandId: string, machineId: string): void {
    this.commandSessions.set(commandId, { machineId, timestamp: Date.now() })
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

  getWebClientByUserId(userId: string): WebSocket | undefined {
    for (const [ws, info] of this.webClientSessions.entries()) {
      if (info.userId === userId) {
        return ws
      }
    }
    return undefined
  }

  deleteWebClient(ws: WebSocket): void {
    this.webClientSessions.delete(ws)
  }

  listWebClients(): Iterable<WebSocket> {
    return this.webClientSessions.keys()
  }
}
