import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../auth', () => ({ getSession: vi.fn() }))
vi.mock('../authorization', () => ({ canAccessMachine: vi.fn() }))
vi.mock('../audit', () => ({
  createAuditEntry: vi.fn(),
  AuditActions: { MACHINE_ACCESS_DENIED: 'MACHINE_ACCESS_DENIED' },
}))

import { getSession } from '../auth'
import { canAccessMachine } from '../authorization'
import { createAuditEntry } from '../audit'
import { guardMachineAccess, guardRole } from '../route-guards'

const mockSession = vi.mocked(getSession)
const mockAccess = vi.mocked(canAccessMachine)
const mockAudit = vi.mocked(createAuditEntry)

function session(role: any) {
  mockSession.mockResolvedValue({ user: { id: 'u1', username: 'x', role } } as any)
}

async function status(r: { ok: boolean; response?: Response }) {
  expect(r.ok).toBe(false)
  return r.response!.status
}

beforeEach(() => {
  vi.resetAllMocks()
  mockAudit.mockResolvedValue(undefined as any)
})

describe('route-guards', () => {
  it('returns 401 without session', async () => {
    mockSession.mockResolvedValue(null as any)
    expect(await status(await guardMachineAccess('m1'))).toBe(401)
    expect(mockAccess).not.toHaveBeenCalled()
  })

  it('allows viewer read with access', async () => {
    session('viewer')
    mockAccess.mockResolvedValue(true)
    const r = await guardMachineAccess('m1', 'read')
    expect(r.ok).toBe(true)
  })

  it('denies viewer write without hitting the DB check', async () => {
    session('viewer')
    expect(await status(await guardMachineAccess('m1', 'write'))).toBe(403)
    expect(mockAccess).not.toHaveBeenCalled()
  })

  it('denies user write without access and audits', async () => {
    session('user')
    mockAccess.mockResolvedValue(false)
    expect(await status(await guardMachineAccess('m1', 'write'))).toBe(403)
    expect(mockAudit).toHaveBeenCalledTimes(1)
    expect(mockAudit.mock.calls[0][0]).toMatchObject({
      action: 'MACHINE_ACCESS_DENIED',
      userId: 'u1',
      machineId: 'm1',
      severity: 'warn',
      details: { reason: 'No machine access', role: 'user', level: 'write' },
    })
  })

  it('allows user write with access', async () => {
    session('user')
    mockAccess.mockResolvedValue(true)
    expect((await guardMachineAccess('m1', 'write')).ok).toBe(true)
  })

  it('allows admin at admin level', async () => {
    session('admin')
    mockAccess.mockResolvedValue(true)
    expect((await guardMachineAccess('m1', 'admin')).ok).toBe(true)
  })

  it('denies user at admin level', async () => {
    session('user')
    expect(await status(await guardMachineAccess('m1', 'admin'))).toBe(403)
    expect(mockAccess).not.toHaveBeenCalled()
  })

  it('treats unknown role as viewer', async () => {
    session('superuser')
    mockAccess.mockResolvedValue(true)
    expect(await status(await guardMachineAccess('m1', 'write'))).toBe(403)
    const r = await guardMachineAccess('m1', 'read')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.user.role).toBe('viewer')
  })

  it('does not break the 403 when audit throws', async () => {
    session('user')
    mockAccess.mockResolvedValue(false)
    mockAudit.mockRejectedValue(new Error('db down'))
    expect(await status(await guardMachineAccess('m1', 'read'))).toBe(403)
  })

  it('guardRole admin denies user and allows admin', async () => {
    session('user')
    expect(await status(await guardRole('admin'))).toBe(403)
    session('admin')
    expect((await guardRole('admin')).ok).toBe(true)
  })
})
