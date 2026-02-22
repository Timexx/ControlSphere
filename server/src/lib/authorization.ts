import { prisma } from './prisma'

/**
 * Role-based authorization utilities
 * ISO 27001 A.9.2.3: Principle of least privilege
 *
 * Roles:
 *   admin  – full access, user management, all machines
 *   user   – own machines + assigned machines, terminal/command access
 *   viewer – read-only access to assigned machines, no terminal/commands
 */

export type UserRole = 'admin' | 'user' | 'viewer'

export interface SessionUser {
  id: string
  username: string
  language?: string | null
  role: UserRole
}

// ─── Role Guard Helpers ──────────────────────────────────────────────────────

/**
 * Throw 403 if the session user does not have one of the required roles.
 */
export function requireRole(session: { user: SessionUser } | null, ...roles: UserRole[]): SessionUser {
  if (!session?.user) {
    throw new AuthorizationError('Unauthorized: No active session', 401)
  }
  if (!roles.includes(session.user.role)) {
    throw new AuthorizationError(
      `Forbidden: Requires role ${roles.join(' or ')}, got ${session.user.role}`,
      403
    )
  }
  return session.user
}

/**
 * Shortcut: require admin role.
 */
export function requireAdmin(session: { user: SessionUser } | null): SessionUser {
  return requireRole(session, 'admin')
}

/**
 * Shortcut: require at least 'user' role (blocks viewers).
 */
export function requireWriteAccess(session: { user: SessionUser } | null): SessionUser {
  return requireRole(session, 'admin', 'user')
}

// ─── Machine Access Control ──────────────────────────────────────────────────

/**
 * Check whether a user can access a specific machine.
 * Admins can access all machines.
 * Users/viewers can access machines they created or that are assigned to them.
 */
export async function canAccessMachine(
  userId: string,
  role: UserRole,
  machineId: string
): Promise<boolean> {
  if (role === 'admin') return true

  // Check UserMachineAccess table or ownership
  const [access, machine] = await Promise.all([
    prisma.userMachineAccess.findUnique({
      where: { userId_machineId: { userId, machineId } },
    }),
    prisma.machine.findUnique({
      where: { id: machineId },
      select: { createdBy: true },
    }),
  ])

  return !!access || machine?.createdBy === userId
}

/**
 * Return all machine IDs a user can access, or 'all' for admins.
 */
export async function getAccessibleMachineIds(
  userId: string,
  role: UserRole
): Promise<string[] | 'all'> {
  if (role === 'admin') return 'all'

  const [accessEntries, ownedMachines] = await Promise.all([
    prisma.userMachineAccess.findMany({
      where: { userId },
      select: { machineId: true },
    }),
    prisma.machine.findMany({
      where: { createdBy: userId },
      select: { id: true },
    }),
  ])

  const ids = new Set<string>()
  for (const a of accessEntries) ids.add(a.machineId)
  for (const m of ownedMachines) ids.add(m.id)

  return Array.from(ids)
}

/**
 * Filter a list of machines down to only those the user can access.
 */
export function filterMachinesByAccess<T extends { id: string }>(
  machines: T[],
  accessibleIds: string[] | 'all'
): T[] {
  if (accessibleIds === 'all') return machines
  const idSet = new Set(accessibleIds)
  return machines.filter((m) => idSet.has(m.id))
}

// ─── Authorization Error ─────────────────────────────────────────────────────

export class AuthorizationError extends Error {
  status: number
  constructor(message: string, status = 403) {
    super(message)
    this.name = 'AuthorizationError'
    this.status = status
  }
}
