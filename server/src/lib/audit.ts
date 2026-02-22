import { prisma } from '@/lib/prisma'
import { realtimeEvents } from '@/lib/realtime-events'

/**
 * Centralized audit logging helper
 * ISO 27001 A.12.4: Logging and monitoring
 *
 * All security-relevant actions MUST be logged via this helper.
 */

export interface AuditEntry {
  action: string
  userId?: string | null
  machineId?: string | null
  eventType?: string | null
  severity?: 'info' | 'warn' | 'critical'
  details?: Record<string, unknown> | string | null
}

/**
 * Create an audit log entry and broadcast via realtime events.
 */
export async function createAuditEntry(entry: AuditEntry): Promise<void> {
  const {
    action,
    userId = null,
    machineId = null,
    eventType = null,
    severity = 'info',
    details = null
  } = entry

  const detailsStr = details
    ? typeof details === 'string'
      ? details
      : JSON.stringify(details)
    : null

  try {
    const log = await prisma.auditLog.create({
      data: {
        action,
        userId,
        machineId,
        eventType,
        severity,
        details: detailsStr,
      },
    })

    // Broadcast to connected WebSocket clients
    realtimeEvents.emitAuditLog(machineId ?? '', {
      id: log.id,
      action: log.action,
      severity: log.severity,
      details: log.details,
      createdAt: log.createdAt.toISOString(),
    })
  } catch (error) {
    // Audit logging should never crash the calling operation
    console.error('Failed to create audit log entry:', error, entry)
  }
}

// ─── Predefined Audit Actions ────────────────────────────────────────────────

export const AuditActions = {
  // User management
  USER_CREATED: 'USER_CREATED',
  USER_UPDATED: 'USER_UPDATED',
  USER_DELETED: 'USER_DELETED',
  USER_DEACTIVATED: 'USER_DEACTIVATED',
  USER_ACTIVATED: 'USER_ACTIVATED',
  USER_ROLE_CHANGED: 'USER_ROLE_CHANGED',
  USER_PASSWORD_RESET: 'USER_PASSWORD_RESET',
  USER_MACHINE_ACCESS_UPDATED: 'USER_MACHINE_ACCESS_UPDATED',
  USER_LOGIN_BLOCKED: 'USER_LOGIN_BLOCKED',
  MACHINE_ACCESS_DENIED: 'MACHINE_ACCESS_DENIED',

  // Existing actions
  LOGIN: 'LOGIN',
  COMMAND_EXEC: 'COMMAND_EXEC',
  SHELL_OPEN: 'SHELL_OPEN',
  SHELL_CLOSE: 'SHELL_CLOSE',
  AGENT_EVENT: 'AGENT_EVENT',
  SESSION_CREATED: 'SESSION_CREATED',
  SESSION_ENDED: 'SESSION_ENDED',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  REPLAY_DETECTED: 'REPLAY_DETECTED',
  HMAC_FAILED: 'HMAC_FAILED',
  BULK_PAGE_ACCESS: 'BULK_PAGE_ACCESS',
  BULK_JOB_CREATED: 'BULK_JOB_CREATED',
  SECURITY_SCAN_TRIGGERED: 'SECURITY_SCAN_TRIGGERED',
} as const
