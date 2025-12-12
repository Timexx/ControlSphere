// Global realtime event bus for broadcasting events from API routes to WebSocket clients
// Uses global singleton pattern to survive hot reloading

import { EventEmitter } from 'events'

interface SecurityEventData {
  id: string
  type: string
  severity: string
  message: string
  status: string
  createdAt: string
}

interface AuditLogData {
  id: string
  action: string
  severity: string
  details: string | null
  createdAt: string
}

interface RealtimeEventBus {
  emitSecurityEvent(machineId: string, event: SecurityEventData): void
  emitAuditLog(machineId: string, log: AuditLogData): void
  emitScanCompleted(machineId: string, scanId: string, summary: unknown): void
  emitScanProgress(machineId: string, progress: { progress: number; phase: string; etaSeconds: number | null; startedAt: string }): void
  emitSecurityEventsResolved(machineId: string, resolvedCount: number): void
  on(event: string, listener: (...args: unknown[]) => void): this
  emit(event: string, ...args: unknown[]): boolean
}

class RealtimeEventBusImpl extends EventEmitter implements RealtimeEventBus {
  constructor() {
    super()
    this.setMaxListeners(100)
  }

  emitSecurityEvent(machineId: string, event: SecurityEventData): void {
    this.emit('security_event', { machineId, event })
  }

  emitAuditLog(machineId: string, log: AuditLogData): void {
    this.emit('audit_log', { machineId, log })
  }

  emitScanCompleted(machineId: string, scanId: string, summary: unknown): void {
    this.emit('scan_completed', { 
      machineId, 
      scanId, 
      summary,
      timestamp: new Date().toISOString()
    })
  }

  emitScanProgress(machineId: string, progress: { progress: number; phase: string; etaSeconds: number | null; startedAt: string }): void {
    this.emit('scan_progress', {
      machineId,
      progress
    })
  }

  emitSecurityEventsResolved(machineId: string, resolvedCount: number): void {
    this.emit('security_events_resolved', {
      machineId,
      resolvedCount,
      timestamp: new Date().toISOString()
    })
  }
}

// Store on globalThis to survive hot reloading in development
const globalForEvents = globalThis as typeof globalThis & {
  __realtimeEvents?: RealtimeEventBusImpl
}

if (!globalForEvents.__realtimeEvents) {
  globalForEvents.__realtimeEvents = new RealtimeEventBusImpl()
}

export const realtimeEvents: RealtimeEventBus = globalForEvents.__realtimeEvents
