import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import { SignJWT } from 'jose'

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  machineFindUnique: vi.fn(),
  auditCreate: vi.fn(),
  canAccessMachine: vi.fn(),
  getAccessibleMachineIds: vi.fn(),
  getAgentBinary: vi.fn(),
}))

vi.mock('../../lib/prisma', () => ({
  prisma: { user: { findUnique: mocks.userFindUnique } },
}))
vi.mock('../../lib/authorization', () => ({
  canAccessMachine: mocks.canAccessMachine,
  getAccessibleMachineIds: mocks.getAccessibleMachineIds,
}))
vi.mock('../../lib/agent-manifest', () => ({
  getAgentBinary: mocks.getAgentBinary,
}))

import { WebClientConnectionManager, agentOsFromOsInfo } from '../WebClientConnectionManager'
import { ConnectionRegistry } from '../ConnectionRegistry'
import { SecretEncryptionService } from '../../infrastructure/crypto/SecretEncryptionService'

const JWT_SECRET = 'unit-test-jwt-secret-unit-test-jwt-secret'
const MACHINE_SECRET = 'machine-plain-secret'
const SHA = 'a'.repeat(64)
const TIMEOUT_MS = 6 * 60_000

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
    .sign(new TextEncoder().encode(JWT_SECRET))
}

function msgs(ws: any): any[] {
  return ws.send.mock.calls.map((c: any[]) => JSON.parse(c[0]))
}

describe('WebClientConnectionManager update_agent', () => {
  let registry: ConnectionRegistry
  let manager: WebClientConnectionManager
  let agentWs: any
  let broadcast: ReturnType<typeof vi.fn>
  let terminalService: any
  const logger: any = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }

  function machineRow(overrides: Record<string, unknown> = {}) {
    return {
      secretKey: new SecretEncryptionService(JWT_SECRET).encrypt(MACHINE_SECRET),
      agentVersion: 'v1',
      agentArch: 'amd64',
      osInfo: JSON.stringify({ distro: 'Debian GNU/Linux 12' }),
      ...overrides,
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.JWT_ISSUER
    delete process.env.JWT_AUDIENCE
    mocks.userFindUnique.mockResolvedValue({ role: 'admin', active: true, username: 'root' })
    mocks.getAccessibleMachineIds.mockResolvedValue('all')
    mocks.canAccessMachine.mockResolvedValue(true)
    mocks.auditCreate.mockResolvedValue({})
    mocks.machineFindUnique.mockResolvedValue(machineRow())
    mocks.getAgentBinary.mockResolvedValue({
      manifest: { version: 'v2' },
      key: 'linux-amd64',
      binary: { file: 'maintainer-agent-linux-amd64', sha256: SHA, size: 1234 },
    })

    terminalService = {
      issueSessionToken: vi.fn(async (userId: string, machineId: string) => ({
        sessionId: 'sess-1', userId, machineId,
      })),
      createSecureMessage: vi.fn(async (token: any, type: string, payload: any) => ({
        data: {
          sessionId: token.sessionId,
          machineId: token.machineId,
          payload: JSON.stringify({
            commandId: payload.commandId, version: payload.version, sha256: payload.sha256, size: payload.size,
          }),
          nonce: 'nonce-1',
          timestamp: '2026-01-01T00:00:00.000Z',
          hmac: 'hmac-1',
        },
      })),
    }

    registry = new ConnectionRegistry()
    agentWs = fakeSocket()
    registry.setMachine('m1', agentWs)
    broadcast = vi.fn()
    const prismaMock: any = {
      user: { findUnique: mocks.userFindUnique },
      machine: { findUnique: mocks.machineFindUnique },
      auditLog: { create: mocks.auditCreate },
    }
    manager = new WebClientConnectionManager(
      prismaMock, registry, broadcast as any, async () => JWT_SECRET, logger, terminalService
    )
  })

  afterEach(() => {
    manager.dispose()
    vi.useRealTimers()
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

  async function expectCompleted(ws: any, exitCode: number) {
    await vi.waitFor(() => {
      expect(msgs(ws).some((m) => m.type === 'command_completed')).toBe(true)
    })
    const out = msgs(ws).filter((m) => m.type === 'command_output')
    const done = msgs(ws).filter((m) => m.type === 'command_completed')
    expect(out).toHaveLength(1)
    expect(done).toHaveLength(1)
    expect(done[0].exitCode).toBe(exitCode)
    expect(done[0].machineId).toBe('m1')
  }

  describe('successful update', () => {
    it('sends exactly one signed update_agent message without serverUrl and writes an audit entry', async () => {
      const ws = await connect()
      send(ws, { type: 'update_agent', machineId: 'm1', commandId: 'upd-test1', serverUrl: 'http://evil.example' })
      await vi.waitFor(() => expect(agentWs.send).toHaveBeenCalledTimes(1))

      const raw: string = agentWs.send.mock.calls[0][0]
      expect(raw).not.toContain('serverUrl')
      expect(raw).not.toContain('evil.example')

      const message = JSON.parse(raw)
      expect(message.type).toBe('update_agent')
      expect(Object.keys(message.data).sort()).toEqual(['hmac', 'machineId', 'nonce', 'payload', 'sessionId', 'timestamp'])
      expect(message.data.sessionId).toBe('sess-1')
      expect(message.data.machineId).toBe('m1')
      expect(JSON.parse(message.data.payload)).toEqual({ commandId: 'upd-test1', version: 'v2', sha256: SHA, size: 1234 })
      expect(Object.keys(JSON.parse(message.data.payload))).toEqual(['commandId', 'version', 'sha256', 'size'])

      expect(terminalService.issueSessionToken).toHaveBeenCalledWith('u1', 'm1', ['update_agent'])
      expect(terminalService.createSecureMessage).toHaveBeenCalledTimes(1)
      const args = terminalService.createSecureMessage.mock.calls[0]
      expect(args[1]).toBe('update_agent')
      expect(args[2]).toEqual({ commandId: 'upd-test1', version: 'v2', sha256: SHA, size: 1234 })
      expect(args[2]).not.toHaveProperty('serverUrl')
      expect(args[3]).toBe(MACHINE_SECRET)

      expect(mocks.getAgentBinary).toHaveBeenCalledWith('linux', 'amd64')
      expect(registry.hasPendingAgentUpdate('m1')).toBe(true)

      expect(mocks.auditCreate).toHaveBeenCalledTimes(1)
      expect(mocks.auditCreate.mock.calls[0][0].data).toMatchObject({
        action: 'AGENT_UPDATE', userId: 'u1', machineId: 'm1', severity: 'info',
      })
      // browser gets no synthetic result while the update is pending
      expect(msgs(ws).filter((m) => m.type === 'command_completed')).toHaveLength(0)
      registry.finishAgentUpdate('upd-test1')
    })

    it('uses the windows manifest entry for a Windows osInfo', async () => {
      mocks.machineFindUnique.mockResolvedValue(
        machineRow({ osInfo: JSON.stringify({ distro: 'Microsoft Windows 11 Pro' }), agentArch: 'arm64' })
      )
      const ws = await connect()
      send(ws, { type: 'update_agent', machineId: 'm1', commandId: 'upd-win' })
      await vi.waitFor(() => expect(agentWs.send).toHaveBeenCalledTimes(1))
      expect(mocks.getAgentBinary).toHaveBeenCalledWith('windows', 'arm64')
      registry.finishAgentUpdate('upd-win')
    })
  })

  describe('rejections', () => {
    it('agent without agentVersion (old agent): nothing to the agent, exitCode 1 to the browser', async () => {
      mocks.machineFindUnique.mockResolvedValue(machineRow({ agentVersion: null }))
      const ws = await connect()
      send(ws, { type: 'update_agent', machineId: 'm1' })
      await expectCompleted(ws, 1)
      expect(agentWs.send).not.toHaveBeenCalled()
      expect(registry.hasPendingAgentUpdate('m1')).toBe(false)
    })

    it('agent already on the manifest version: nothing to the agent, exitCode 0', async () => {
      mocks.machineFindUnique.mockResolvedValue(machineRow({ agentVersion: 'v2' }))
      const ws = await connect()
      send(ws, { type: 'update_agent', machineId: 'm1' })
      await expectCompleted(ws, 0)
      expect(agentWs.send).not.toHaveBeenCalled()
      expect(registry.hasPendingAgentUpdate('m1')).toBe(false)
    })

    it('no manifest entry: nothing to the agent, exitCode 1', async () => {
      mocks.getAgentBinary.mockResolvedValue(null)
      const ws = await connect()
      send(ws, { type: 'update_agent', machineId: 'm1' })
      await expectCompleted(ws, 1)
      expect(agentWs.send).not.toHaveBeenCalled()
      expect(registry.hasPendingAgentUpdate('m1')).toBe(false)
    })

    it('second request while the first is pending is rejected', async () => {
      const ws = await connect()
      send(ws, { type: 'update_agent', machineId: 'm1', commandId: 'upd-first' })
      await vi.waitFor(() => expect(agentWs.send).toHaveBeenCalledTimes(1))

      send(ws, { type: 'update_agent', machineId: 'm1', commandId: 'upd-second' })
      await expectCompleted(ws, 1)
      expect(agentWs.send).toHaveBeenCalledTimes(1)
      expect(terminalService.createSecureMessage).toHaveBeenCalledTimes(1)
      expect(mocks.auditCreate).toHaveBeenCalledTimes(1)
      expect(registry.hasPendingAgentUpdate('m1')).toBe(true)
      registry.finishAgentUpdate('upd-first')
    })

    it.each(['user', 'viewer'])('role %s is rejected by the message policy', async (role) => {
      mocks.userFindUnique.mockResolvedValue({ role, active: true, username: 'alice' })
      mocks.getAccessibleMachineIds.mockResolvedValue(['m1'])
      const ws = await connect()
      send(ws, { type: 'update_agent', machineId: 'm1' })
      await vi.waitFor(() => {
        expect(msgs(ws).some((m) => m.type === 'error' && m.message === 'Forbidden')).toBe(true)
      })
      expect(agentWs.send).not.toHaveBeenCalled()
      expect(mocks.machineFindUnique).not.toHaveBeenCalled()
      expect(registry.hasPendingAgentUpdate('m1')).toBe(false)
    })
  })

  describe('agentOsFromOsInfo', () => {
    it('detects windows', () => {
      expect(agentOsFromOsInfo('{"distro":"Microsoft Windows 11 Pro"}')).toBe('windows')
    })
    it('detects linux', () => {
      expect(agentOsFromOsInfo('{"distro":"Debian GNU/Linux 12 (bookworm)"}')).toBe('linux')
    })
    it('defaults to linux for null/undefined/empty', () => {
      expect(agentOsFromOsInfo(null)).toBe('linux')
      expect(agentOsFromOsInfo(undefined)).toBe('linux')
      expect(agentOsFromOsInfo('')).toBe('linux')
    })
  })

  describe('timeout', () => {
    // The handler is invoked directly (the router/WS path is covered above) so that
    // only setTimeout is faked and the WS/JWT machinery runs on real timers.
    async function startUpdate(commandId: string) {
      const clientWs = fakeSocket()
      await (manager as any).handleUpdateAgent({ machineId: 'm1', userId: 'u1', commandId, clientWs })
      return clientWs
    }

    it('broadcasts command_completed with exitCode 1 after 6 minutes without a result', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      await startUpdate('upd-timeout')
      expect(agentWs.send).toHaveBeenCalledTimes(1)
      expect(registry.hasPendingAgentUpdate('m1')).toBe(true)

      vi.advanceTimersByTime(TIMEOUT_MS - 1)
      expect(broadcast).not.toHaveBeenCalled()

      vi.advanceTimersByTime(1)
      const completed = broadcast.mock.calls.map((c) => c[0]).filter((m: any) => m.type === 'command_completed')
      expect(completed).toHaveLength(1)
      expect(completed[0]).toMatchObject({ machineId: 'm1', commandId: 'upd-timeout', exitCode: 1 })
      expect(broadcast.mock.calls.some((c) => c[0].type === 'command_output')).toBe(true)
      expect(registry.hasPendingAgentUpdate('m1')).toBe(false)
    })

    it('does not broadcast when the update is finished before the timeout', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      await startUpdate('upd-ok')
      expect(registry.finishAgentUpdate('upd-ok')).toBe(true)
      expect(registry.hasPendingAgentUpdate('m1')).toBe(false)

      vi.advanceTimersByTime(TIMEOUT_MS * 2)
      expect(broadcast).not.toHaveBeenCalled()
    })
  })
})
