import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import { SignJWT } from 'jose'

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  canAccessMachine: vi.fn(),
  getAccessibleMachineIds: vi.fn(),
  auditCreate: vi.fn(),
}))

vi.mock('../../lib/prisma', () => ({
  prisma: { user: { findUnique: mocks.findUnique } },
}))
vi.mock('../../lib/authorization', () => ({
  canAccessMachine: mocks.canAccessMachine,
  getAccessibleMachineIds: mocks.getAccessibleMachineIds,
}))

import { WebClientConnectionManager } from '../WebClientConnectionManager'
import { ConnectionRegistry } from '../ConnectionRegistry'

const SECRET = 'unit-test-jwt-secret-unit-test-jwt-secret'

function fakeSocket(readyState = 1): any {
  const s: any = new EventEmitter()
  s.readyState = readyState
  s.send = vi.fn()
  s.close = vi.fn()
  return s
}

async function makeToken(): Promise<string> {
  return new SignJWT({ user: { id: 'u1', username: 'alice' } })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('maintainer.local')
    .setAudience('maintainer.clients')
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRET))
}

function clientMessages(ws: any): any[] {
  return ws.send.mock.calls.map((c: any[]) => JSON.parse(c[0]))
}

describe('WebClientConnectionManager security', () => {
  let registry: ConnectionRegistry
  let manager: WebClientConnectionManager
  let agentWs: any
  const logger: any = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.JWT_ISSUER
    delete process.env.JWT_AUDIENCE
    mocks.findUnique.mockResolvedValue({ role: 'user', active: true, username: 'alice' })
    mocks.canAccessMachine.mockResolvedValue(true)
    mocks.getAccessibleMachineIds.mockResolvedValue(['m1'])
    mocks.auditCreate.mockResolvedValue({})
    registry = new ConnectionRegistry()
    agentWs = fakeSocket()
    registry.setMachine('m1', agentWs)
    const prismaMock: any = {
      user: { findUnique: mocks.findUnique },
      auditLog: { create: mocks.auditCreate },
    }
    manager = new WebClientConnectionManager(
      prismaMock, registry, vi.fn(), async () => SECRET, logger, {} as any
    )
  })

  afterEach(() => {
    manager.dispose()
  })

  async function connect(): Promise<any> {
    const ws = fakeSocket()
    const token = await makeToken()
    await manager.handleConnection(ws, { url: '/ws/web', headers: { authorization: `Bearer ${token}` } } as any)
    return ws
  }

  function send(ws: any, msg: any) {
    ws.emit('message', Buffer.from(JSON.stringify(msg)))
  }

  async function expectForbidden(ws: any) {
    await vi.waitFor(() => {
      expect(clientMessages(ws).some((m) => m.type === 'error' && m.message === 'Forbidden')).toBe(true)
    })
  }

  const privileged: Array<[string, any]> = [
    ['spawn_terminal', { type: 'spawn_terminal', machineId: 'm1' }],
    ['execute_command', { type: 'execute_command', machineId: 'm1', commandId: 'c1', command: 'ls' }],
    ['trigger_scan', { type: 'trigger_scan', machineId: 'm1' }],
    ['update_agent', { type: 'update_agent', machineId: 'm1', serverUrl: 'http://x' }],
  ]

  describe('(a) viewer', () => {
    it.each(privileged)('is forbidden from %s', async (_name, msg) => {
      mocks.findUnique.mockResolvedValue({ role: 'viewer', active: true, username: 'alice' })
      const ws = await connect()
      send(ws, msg)
      await expectForbidden(ws)
      expect(agentWs.send).not.toHaveBeenCalled()
    })
  })

  describe('(b) user without machine access', () => {
    it('is forbidden from spawn_terminal', async () => {
      mocks.canAccessMachine.mockResolvedValue(false)
      const ws = await connect()
      send(ws, { type: 'spawn_terminal', machineId: 'm1' })
      await expectForbidden(ws)
      expect(agentWs.send).not.toHaveBeenCalled()
      expect(registry.getTerminalSession('anything')).toBeUndefined()
    })

    it('is forbidden from execute_command and trigger_scan', async () => {
      mocks.canAccessMachine.mockResolvedValue(false)
      const ws = await connect()
      send(ws, { type: 'execute_command', machineId: 'm1', command: 'ls' })
      send(ws, { type: 'trigger_scan', machineId: 'm1' })
      await vi.waitFor(() => {
        expect(clientMessages(ws).filter((m) => m.message === 'Forbidden')).toHaveLength(2)
      })
      expect(agentWs.send).not.toHaveBeenCalled()
      expect(mocks.auditCreate).toHaveBeenCalledTimes(2)
      expect(mocks.auditCreate.mock.calls[0][0].data).toMatchObject({
        action: 'MACHINE_ACCESS_DENIED', userId: 'u1', machineId: 'm1', severity: 'warn',
      })
    })
  })

  describe('(c) allowed actions', () => {
    it('user with access can trigger_scan and it reaches the agent', async () => {
      const ws = await connect()
      send(ws, { type: 'trigger_scan', machineId: 'm1' })
      await vi.waitFor(() => expect(agentWs.send).toHaveBeenCalledTimes(1))
      expect(JSON.parse(agentWs.send.mock.calls[0][0]).type).toBe('trigger_scan')
      expect(mocks.canAccessMachine).toHaveBeenCalledWith('u1', 'user', 'm1')
    })

    it('user cannot update_agent', async () => {
      const ws = await connect()
      send(ws, { type: 'update_agent', machineId: 'm1', serverUrl: 'http://x' })
      await expectForbidden(ws)
      expect(agentWs.send).not.toHaveBeenCalled()
    })

    it('admin passes the policy for update_agent (signed path: see updateAgent tests)', async () => {
      mocks.findUnique.mockResolvedValue({ role: 'admin', active: true, username: 'root' })
      mocks.getAccessibleMachineIds.mockResolvedValue('all')
      const handler = vi.spyOn(manager as any, 'handleUpdateAgent').mockResolvedValue(undefined)
      const ws = await connect()
      send(ws, { type: 'update_agent', machineId: 'm1', serverUrl: 'http://x' })
      await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1))
      expect(clientMessages(ws).some((m) => m.message === 'Forbidden')).toBe(false)
    })

    it('registers the client with its resolved role and machine access', async () => {
      const ws = await connect()
      const info = registry.getWebClient(ws)!
      expect(info.userId).toBe('u1')
      expect(info.role).toBe('user')
      expect(info.machineAccess).toEqual(new Set(['m1']))
    })
  })

  describe('(d) terminal_input session ownership', () => {
    it('is forbidden for a session owned by another socket', async () => {
      const ws = await connect()
      const otherOwner = fakeSocket()
      registry.setTerminalSession('s1', 'm1', otherOwner)
      send(ws, { type: 'terminal_input', machineId: 'm1', sessionId: 's1', data: 'rm -rf /' })
      await expectForbidden(ws)
      expect(agentWs.send).not.toHaveBeenCalled()
    })

    it('is forbidden for a session that belongs to a different machine', async () => {
      const ws = await connect()
      registry.setTerminalSession('s1', 'm2', ws)
      send(ws, { type: 'terminal_input', machineId: 'm1', sessionId: 's1', data: 'x' })
      await expectForbidden(ws)
      expect(agentWs.send).not.toHaveBeenCalled()
    })

    it('is forbidden for an unknown session', async () => {
      const ws = await connect()
      send(ws, { type: 'terminal_input', machineId: 'm1', sessionId: 'nope', data: 'x' })
      await expectForbidden(ws)
      expect(agentWs.send).not.toHaveBeenCalled()
    })

    it('terminal_resize on a foreign session is forbidden too', async () => {
      const ws = await connect()
      registry.setTerminalSession('s1', 'm1', fakeSocket())
      send(ws, { type: 'terminal_resize', machineId: 'm1', sessionId: 's1', cols: 80, rows: 24 })
      await expectForbidden(ws)
      expect(agentWs.send).not.toHaveBeenCalled()
    })

    it('is forbidden when cached access does not include the machine', async () => {
      mocks.getAccessibleMachineIds.mockResolvedValue(['other'])
      const ws = await connect()
      registry.setTerminalSession('s1', 'm1', ws)
      send(ws, { type: 'terminal_input', machineId: 'm1', sessionId: 's1', data: 'x' })
      await expectForbidden(ws)
      expect(agentWs.send).not.toHaveBeenCalled()
    })
  })

  describe('(e) inactive / unknown users', () => {
    it('closes the socket with 1008 for an inactive user', async () => {
      mocks.findUnique.mockResolvedValue({ role: 'admin', active: false, username: 'alice' })
      const ws = await connect()
      expect(ws.close).toHaveBeenCalledWith(1008, expect.any(String))
      expect(registry.getWebClient(ws)).toBeUndefined()
    })

    it('closes the socket with 1008 for an unknown user', async () => {
      mocks.findUnique.mockResolvedValue(null)
      const ws = await connect()
      expect(ws.close).toHaveBeenCalledWith(1008, expect.any(String))
      expect(registry.getWebClient(ws)).toBeUndefined()
    })

    it('closes the socket with 1008 without a token', async () => {
      const ws = fakeSocket()
      await manager.handleConnection(ws, { url: '/ws/web', headers: {} } as any)
      expect(ws.close).toHaveBeenCalledWith(1008, expect.any(String))
    })
  })

  describe('(f) unknown message types', () => {
    it('does not forward an unknown type to the agent', async () => {
      const ws = await connect()
      send(ws, { type: 'format_disk', machineId: 'm1' })
      await vi.waitFor(() => {
        expect(clientMessages(ws).some((m) => m.type === 'error')).toBe(true)
      })
      expect(agentWs.send).not.toHaveBeenCalled()
    })

    it('does not forward agent-only message types (e.g. heartbeat) either', async () => {
      const ws = await connect()
      send(ws, { type: 'heartbeat', machineId: 'm1', metrics: {} })
      await vi.waitFor(() => {
        expect(clientMessages(ws).some((m) => m.type === 'error')).toBe(true)
      })
      expect(agentWs.send).not.toHaveBeenCalled()
    })
  })
})
