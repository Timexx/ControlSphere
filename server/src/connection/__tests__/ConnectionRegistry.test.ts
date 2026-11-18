import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import { ConnectionRegistry, machineIdOfEvent } from '../ConnectionRegistry'

function fakeSocket(readyState = 1): any {
  const s: any = new EventEmitter()
  s.readyState = readyState
  s.send = vi.fn()
  s.close = vi.fn()
  return s
}

function client(registry: ConnectionRegistry, ws: any, machineAccess: 'all' | Set<string>, role: any = 'user') {
  registry.setWebClient(ws, { userId: 'u', role, machineAccess, accessLoadedAt: Date.now() })
}

describe('ConnectionRegistry', () => {
  let registry: ConnectionRegistry

  beforeEach(() => {
    registry = new ConnectionRegistry()
  })

  describe('machineIdOfEvent', () => {
    it('extracts machineId, machine.id, or null', () => {
      expect(machineIdOfEvent({ machineId: 'm1' })).toBe('m1')
      expect(machineIdOfEvent({ machine: { id: 'm2' } })).toBe('m2')
      expect(machineIdOfEvent({ type: 'x' })).toBeNull()
      expect(machineIdOfEvent(null)).toBeNull()
      expect(machineIdOfEvent('str')).toBeNull()
    })
  })

  describe('broadcastToWebClients', () => {
    it('sends every event to an admin client with access "all"', () => {
      const admin = fakeSocket()
      client(registry, admin, 'all', 'admin')
      registry.broadcastToWebClients({ type: 'a', machineId: 'm1' })
      registry.broadcastToWebClients({ type: 'b', machine: { id: 'm9' } })
      registry.broadcastToWebClients({ type: 'c' })
      expect(admin.send).toHaveBeenCalledTimes(3)
    })

    it('restricts machine-scoped events (machineId shape) to clients with access', () => {
      const restricted = fakeSocket()
      client(registry, restricted, new Set(['m1']))
      registry.broadcastToWebClients({ type: 'a', machineId: 'm1' })
      registry.broadcastToWebClients({ type: 'a', machineId: 'm2' })
      expect(restricted.send).toHaveBeenCalledTimes(1)
      expect(JSON.parse(restricted.send.mock.calls[0][0]).machineId).toBe('m1')
    })

    it('restricts machine-scoped events (machine.id shape) to clients with access', () => {
      const restricted = fakeSocket()
      client(registry, restricted, new Set(['m1']))
      registry.broadcastToWebClients({ type: 'machine_registered', machine: { id: 'm2' } })
      expect(restricted.send).not.toHaveBeenCalled()
      registry.broadcastToWebClients({ type: 'machine_registered', machine: { id: 'm1' } })
      expect(restricted.send).toHaveBeenCalledTimes(1)
    })

    it('delivers non-machine events to restricted clients', () => {
      const restricted = fakeSocket()
      client(registry, restricted, new Set())
      registry.broadcastToWebClients({ type: 'server_notice' })
      expect(restricted.send).toHaveBeenCalledTimes(1)
    })

    it('gives a client with empty access no machine events', () => {
      const none = fakeSocket()
      client(registry, none, new Set())
      registry.broadcastToWebClients({ type: 'a', machineId: 'm1' })
      expect(none.send).not.toHaveBeenCalled()
    })

    it('skips sockets that are not open', () => {
      const closed = fakeSocket(3)
      const connecting = fakeSocket(0)
      const open = fakeSocket(1)
      client(registry, closed, 'all')
      client(registry, connecting, 'all')
      client(registry, open, 'all')
      registry.broadcastToWebClients({ type: 'x' })
      expect(closed.send).not.toHaveBeenCalled()
      expect(connecting.send).not.toHaveBeenCalled()
      expect(open.send).toHaveBeenCalledTimes(1)
    })

    it('does not let a throwing socket prevent delivery to others', () => {
      const bad = fakeSocket()
      bad.send.mockImplementation(() => { throw new Error('boom') })
      const good = fakeSocket()
      client(registry, bad, 'all')
      client(registry, good, 'all')
      expect(() => registry.broadcastToWebClients({ type: 'x' })).not.toThrow()
      expect(good.send).toHaveBeenCalledTimes(1)
    })
  })

  describe('terminal sessions', () => {
    it('returns machine and owner for a session', () => {
      const owner = fakeSocket()
      registry.setTerminalSession('s1', 'm1', owner)
      expect(registry.getTerminalSession('s1')).toBe('m1')
      expect(registry.getTerminalOwner('s1')).toBe(owner)
      expect(registry.getTerminalOwner('nope')).toBeUndefined()
    })

    it('deleteWebClient removes only the terminal sessions owned by that socket', () => {
      const a = fakeSocket()
      const b = fakeSocket()
      client(registry, a, 'all')
      client(registry, b, 'all')
      registry.setTerminalSession('sa', 'm1', a)
      registry.setTerminalSession('sb', 'm1', b)
      registry.deleteWebClient(a)
      expect(registry.getTerminalSession('sa')).toBeUndefined()
      expect(registry.getWebClient(a)).toBeUndefined()
      expect(registry.getTerminalSession('sb')).toBe('m1')
      expect(registry.getTerminalOwner('sb')).toBe(b)
    })

    it('deleteMachine drops that machine\'s sessions and commands', () => {
      registry.setTerminalSession('s1', 'm1', fakeSocket())
      registry.setCommandSession('c1', 'm1')
      registry.setCommandSession('c2', 'm2')
      registry.deleteMachine('m1')
      expect(registry.getTerminalSession('s1')).toBeUndefined()
      expect(registry.getCommandMachine('c1')).toBeUndefined()
      expect(registry.getCommandMachine('c2')).toBe('m2')
    })
  })

  describe('machine sockets', () => {
    it('isCurrentMachineSocket is true only for the registered socket', () => {
      const s1 = fakeSocket()
      const s2 = fakeSocket()
      expect(registry.isCurrentMachineSocket('m1', s1)).toBe(false)
      registry.setMachine('m1', s1)
      expect(registry.isCurrentMachineSocket('m1', s1)).toBe(true)
      expect(registry.isCurrentMachineSocket('m1', s2)).toBe(false)
      registry.setMachine('m1', s2)
      expect(registry.isCurrentMachineSocket('m1', s1)).toBe(false)
      expect(registry.isCurrentMachineSocket('m1', s2)).toBe(true)
    })

    it('getCommandMachine returns the registered machine', () => {
      registry.setCommandSession('c1', 'm1')
      expect(registry.getCommandMachine('c1')).toBe('m1')
      registry.clearCommand('c1')
      expect(registry.getCommandMachine('c1')).toBeUndefined()
    })
  })

  describe('canClientSeeMachine', () => {
    it('honours all / set / unknown client', () => {
      const admin = fakeSocket()
      const user = fakeSocket()
      client(registry, admin, 'all')
      client(registry, user, new Set(['m1']))
      expect(registry.canClientSeeMachine(admin, 'any')).toBe(true)
      expect(registry.canClientSeeMachine(user, 'm1')).toBe(true)
      expect(registry.canClientSeeMachine(user, 'm2')).toBe(false)
      expect(registry.canClientSeeMachine(fakeSocket(), 'm1')).toBe(false)
    })
  })
})
