import { NextResponse } from 'next/server'
import { getSession } from './auth'
import { canAccessMachine, type SessionUser, type UserRole } from './authorization'
import { createAuditEntry, AuditActions } from './audit'

export type MachineAccessLevel = 'read' | 'write' | 'admin'

type GuardResult =
  | { ok: true; user: SessionUser }
  | { ok: false; response: NextResponse }

const VALID_ROLES: UserRole[] = ['admin', 'user', 'viewer']

function deny(status: 401 | 403): { ok: false; response: NextResponse } {
  return {
    ok: false,
    response: NextResponse.json(
      { error: status === 401 ? 'Unauthorized' : 'Forbidden' },
      { status }
    ),
  }
}

async function resolveUser(level: MachineAccessLevel): Promise<GuardResult> {
  const session = await getSession()
  const sessionUser = session?.user
  if (!sessionUser || !sessionUser.id) return deny(401)

  const role: UserRole = VALID_ROLES.includes(sessionUser.role as UserRole)
    ? (sessionUser.role as UserRole)
    : 'viewer'

  if (level === 'admin' && role !== 'admin') return deny(403)
  if (level === 'write' && role !== 'admin' && role !== 'user') return deny(403)

  return { ok: true, user: { ...sessionUser, role } }
}

/**
 * Require an authenticated session with sufficient role and access to the machine.
 * Role checks run before the DB access check.
 */
export async function guardMachineAccess(
  machineId: string,
  level: MachineAccessLevel = 'read'
): Promise<GuardResult> {
  const result = await resolveUser(level)
  if (!result.ok) return result

  const { user } = result
  const hasAccess = await canAccessMachine(user.id, user.role, machineId)
  if (!hasAccess) {
    try {
      await createAuditEntry({
        action: AuditActions.MACHINE_ACCESS_DENIED,
        userId: user.id,
        machineId,
        severity: 'warn',
        details: { reason: 'No machine access', role: user.role, level },
      })
    } catch (error) {
      console.error('Failed to write access-denied audit entry:', error)
    }
    return deny(403)
  }

  return result
}

/**
 * Require an authenticated session with at least the given role level (no machine check).
 */
export async function guardRole(level: 'write' | 'admin'): Promise<GuardResult> {
  return resolveUser(level)
}
