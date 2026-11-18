import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import crypto from 'crypto'

vi.mock('../../lib/orchestrator', () => ({
  orchestrator: {
    handleAgentDisconnect: vi.fn().mockResolvedValue(undefined),
    handleCommandOutput: vi.fn().mockResolvedValue(undefined),
  },
}))
vi.mock('../../lib/realtime-events', async () => {
  const { EventEmitter } = await import('events')
  return { realtimeEvents: new EventEmitter() }
})
vi.mock('../../lib/state-cache', () => ({
  stateCache: {
    setOffline: vi.fn(),
    upsertMachine: vi.fn(),
    updateMachineStatus: vi.fn(),
    updateMetric: vi.fn(),
    updatePorts: vi.fn(),
  },
}))

import { AgentConnectionManager } from '../AgentConnectionManager'
import { ConnectionRegistry } from '../ConnectionRegistry'
import { orchestrator } from '../../lib/orchestrator'

const SECRET = 'a'.repeat(64)
const SECRET_HASH = crypto.createHash('sha256').update(SECRET).digest('hex')
const OTHER_SECRET = 'b'.repeat(64)

function fakeSocket(readyState = 1): any {
  const s: any = new EventEmitter()
  s.readyState = readyState
  s.send = vi.fn()
  s.close = vi.fn()
  return s
}

const req: any = { socket: { remoteAddress: '10.0.0.5' } }

async function flush() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
}

function send(ws: any, msg: any) {
  ws.emit('message', Buffer.from(JSON.stringify(msg)))
}

function registerMsg(secret = SECRET) {
  return { type: 'register', secretKey: secret, hostname: 'host1', ip: '10.0.0.5', osInfo: { os: 'linux' } }
}

function machineRecord(over: any = {}) {
  return {
    id: 'm1', hostname: 'host1', ip: '10.0.0.5', osInfo: '{}', status: 'online',
    lastSeen: new Date(), notes: null, createdAt: new Date(), updatedAt: new Date(),
    secretKeyHash: SECRET_HASH, ...over,
  }
}

describe('AgentConnectionManager security', () => {
  let prisma: any
  let registry: ConnectionRegistry
  let broadcast: ReturnType<typeof vi.fn>
  let manager: AgentConnectionManager
  const logger: any = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval'] })
    vi.clearAllMocks()
    prisma = {
      machine: {
        findFirst: vi.fn().mockResolvedValue(machineRecord()),
        findUnique: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockImplementation(async ({ where }: any) => machineRecord({ id: where.id })),
        create: vi.fn().mockResolvedValue(machineRecord({ id: 'new1' })),
      },
      metric: { create: vi.fn().mockResolvedValue({}) },
      port: { upsert: vi.fn(), deleteMany: vi.fn() },
      $transaction: vi.fn().mockResolvedValue([]),
    }
    registry = new ConnectionRegistry()
    broadcast = vi.fn()
    manager = new AgentConnectionManager(prisma, registry, broadcast, logger, {} as any, 'test-jwt-secret')
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  function connect(): any {
    const ws = fakeSocket()
    manager.handleConnection(ws, req)
    return ws
  }

  it('(a) drops a heartbeat with an arbitrary machineId before register', async () => {
    const ws = connect()
    send(ws, { type: 'heartbeat', machineId: 'victim', metrics: { cpuUsage: 1 } })
    await flush()
    expect(prisma.machine.update).not.toHaveBeenCalled()
    expect(prisma.metric.create).not.toHaveBeenCalled()
    expect(registry.getMachine('victim')).toBeNull()
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('(a) drops other message types before register too', async () => {
    const ws = connect()
    send(ws, { type: 'terminal_output', sessionId: 's1', machineId: 'victim', output: 'x' })
    send(ws, { type: 'command_response', commandId: 'c1', machineId: 'victim', output: 'x', exitCode: 0, completed: true })
    await flush()
    expect(broadcast).not.toHaveBeenCalled()
    expect(orchestrator.handleCommandOutput).not.toHaveBeenCalled()
  })

  it('(b) binds the socket on register with matching secretKeyHash and replies registered', async () => {
    const ws = connect()
    send(ws, registerMsg())
    await flush()
    expect(prisma.machine.findFirst).toHaveBeenCalledWith({ where: { secretKeyHash: SECRET_HASH } })
    expect(registry.getMachine('m1')).toBe(ws)
    const sent = ws.send.mock.calls.map((c: any[]) => JSON.parse(c[0]))
    expect(sent).toContainEqual({ type: 'registered', machineId: 'm1' })
    expect(ws.close).not.toHaveBeenCalled()
  })

  it('(b) after register a heartbeat with a foreign machineId is processed for the bound id', async () => {
    const ws = connect()
    send(ws, registerMsg())
    await flush()
    prisma.machine.update.mockClear()

    send(ws, { type: 'heartbeat', machineId: 'victim', metrics: { cpuUsage: 5 } })
    await flush()

    expect(prisma.machine.update).toHaveBeenCalledTimes(1)
    expect(prisma.machine.update.mock.calls[0][0].where).toEqual({ id: 'm1' })
    expect(prisma.metric.create).toHaveBeenCalledTimes(1)
    expect(prisma.metric.create.mock.calls[0][0].data.machineId).toBe('m1')
    expect(registry.getMachine('victim')).toBeNull()
    const ids = [...prisma.machine.update.mock.calls, ...prisma.metric.create.mock.calls]
      .map((c: any[]) => JSON.stringify(c[0]))
    expect(ids.some((s) => s.includes('victim'))).toBe(false)
  })

  it('(c) rejects a wrong key when hostname+ip match a record that has a secretKeyHash', async () => {
    prisma.machine.findFirst.mockImplementation(async ({ where }: any) =>
      where.secretKeyHash ? null : machineRecord({ secretKeyHash: 'someotherhash' }))
    const ws = connect()
    send(ws, registerMsg(OTHER_SECRET))
    await flush()

    expect(ws.close).toHaveBeenCalledWith(1008, expect.any(String))
    expect(prisma.machine.update).not.toHaveBeenCalled()
    expect(prisma.machine.create).not.toHaveBeenCalled()
    expect(registry.getMachine('m1')).toBeNull()
    const sent = ws.send.mock.calls.map((c: any[]) => JSON.parse(c[0]))
    expect(sent.some((m: any) => m.type === 'registered')).toBe(false)
  })

  it('(c) a socket that failed registration stays unbound (heartbeat dropped)', async () => {
    prisma.machine.findFirst.mockImplementation(async ({ where }: any) =>
      where.secretKeyHash ? null : machineRecord({ secretKeyHash: 'someotherhash' }))
    const ws = connect()
    send(ws, registerMsg(OTHER_SECRET))
    await flush()
    send(ws, { type: 'heartbeat', machineId: 'm1', metrics: {} })
    await flush()
    expect(prisma.machine.update).not.toHaveBeenCalled()
  })

  it('(d) adopts a legacy record without secretKeyHash on hostname+ip match', async () => {
    prisma.machine.findFirst.mockImplementation(async ({ where }: any) =>
      where.secretKeyHash ? null : machineRecord({ secretKeyHash: null }))
    const ws = connect()
    send(ws, registerMsg(OTHER_SECRET))
    await flush()

    expect(prisma.machine.update).toHaveBeenCalledTimes(1)
    const call = prisma.machine.update.mock.calls[0][0]
    expect(call.where).toEqual({ id: 'm1' })
    expect(call.data.secretKeyHash).toBe(crypto.createHash('sha256').update(OTHER_SECRET).digest('hex'))
    expect(registry.getMachine('m1')).toBe(ws)
    expect(ws.close).not.toHaveBeenCalled()
  })

  it('(e) an old socket closing after re-register on a new socket does not mark the machine offline', async () => {
    const wsOld = connect()
    send(wsOld, registerMsg())
    await flush()
    const wsNew = connect()
    send(wsNew, registerMsg())
    await flush()
    expect(registry.getMachine('m1')).toBe(wsNew)

    prisma.machine.update.mockClear()
    broadcast.mockClear()
    wsOld.emit('close')
    await flush()

    const offlineCalls = prisma.machine.update.mock.calls.filter((c: any[]) => c[0].data?.status === 'offline')
    expect(offlineCalls).toHaveLength(0)
    expect(orchestrator.handleAgentDisconnect).not.toHaveBeenCalled()
    expect(registry.getMachine('m1')).toBe(wsNew)
    expect(broadcast).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'offline' }))
  })

  it('(e) the current socket closing does mark the machine offline', async () => {
    const ws = connect()
    send(ws, registerMsg())
    await flush()
    prisma.machine.update.mockClear()
    ws.emit('close')
    await flush()
    expect(prisma.machine.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'm1' }, data: { status: 'offline' },
    }))
    expect(registry.getMachine('m1')).toBeNull()
  })

  it('(f) terminal_output for a session owned by web socket W goes only to W', async () => {
    const ws = connect()
    send(ws, registerMsg())
    await flush()
    const W = fakeSocket()
    const other = fakeSocket()
    registry.setWebClient(W, { userId: 'u1', role: 'user', machineAccess: 'all', accessLoadedAt: 0 })
    registry.setWebClient(other, { userId: 'u2', role: 'admin', machineAccess: 'all', accessLoadedAt: 0 })
    registry.setTerminalSession('s1', 'm1', W)

    send(ws, { type: 'terminal_output', sessionId: 's1', output: 'hello' })
    await flush()

    expect(W.send).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(W.send.mock.calls[0][0])
    expect(payload).toMatchObject({ type: 'terminal_output', machineId: 'm1', sessionId: 's1', output: 'hello' })
    expect(other.send).not.toHaveBeenCalled()
    expect(broadcast).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'terminal_output' }))
  })

  it('(f) terminal_output for a session of another machine reaches nobody', async () => {
    const ws = connect()
    send(ws, registerMsg())
    await flush()
    const W = fakeSocket()
    const other = fakeSocket()
    registry.setWebClient(W, { userId: 'u1', role: 'user', machineAccess: 'all', accessLoadedAt: 0 })
    registry.setWebClient(other, { userId: 'u2', role: 'admin', machineAccess: 'all', accessLoadedAt: 0 })
    registry.setTerminalSession('s2', 'm2', W)

    send(ws, { type: 'terminal_output', sessionId: 's2', machineId: 'm2', output: 'steal' })
    await flush()

    expect(W.send).not.toHaveBeenCalled()
    expect(other.send).not.toHaveBeenCalled()
  })

  it('(g) command_response for a commandId registered to another machine is dropped', async () => {
    const ws = connect()
    send(ws, registerMsg())
    await flush()
    registry.setCommandSession('c1', 'm2')

    send(ws, { type: 'command_response', commandId: 'c1', output: 'pwned', exitCode: 0, completed: true })
    await flush()

    expect(broadcast).not.toHaveBeenCalledWith(expect.objectContaining({ commandId: 'c1' }))
    expect(orchestrator.handleCommandOutput).not.toHaveBeenCalled()
    expect(registry.getCommandMachine('c1')).toBe('m2')
  })

  it('(g) command_response for the agent\'s own command is processed', async () => {
    const ws = connect()
    send(ws, registerMsg())
    await flush()
    registry.setCommandSession('c2', 'm1')

    send(ws, { type: 'command_response', commandId: 'c2', output: 'ok', exitCode: 0, completed: true })
    await flush()

    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'command_output', machineId: 'm1', commandId: 'c2' }))
    expect(orchestrator.handleCommandOutput).toHaveBeenCalled()
    expect(registry.getCommandMachine('c2')).toBeUndefined()
  })
})
