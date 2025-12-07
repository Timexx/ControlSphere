// Global realtime event bus - compatible with both CommonJS and ES modules
// This uses the same global singleton as the TypeScript version

const EventEmitter = require('events')

class RealtimeEventBusImpl extends EventEmitter {
  constructor() {
    super()
    this.setMaxListeners(100)
  }

  emitSecurityEvent(machineId, event) {
    this.emit('security_event', { machineId, event })
  }

  emitAuditLog(machineId, log) {
    this.emit('audit_log', { machineId, log })
  }

  emitScanCompleted(machineId, scanId, summary) {
    this.emit('scan_completed', { 
      machineId, 
      scanId, 
      summary,
      timestamp: new Date().toISOString()
    })
  }

  emitSecurityEventsResolved(machineId, resolvedCount) {
    this.emit('security_events_resolved', {
      machineId,
      resolvedCount,
      timestamp: new Date().toISOString()
    })
  }
}

// Use the same global key as the TypeScript version
if (!globalThis.__realtimeEvents) {
  globalThis.__realtimeEvents = new RealtimeEventBusImpl()
}

module.exports = { realtimeEvents: globalThis.__realtimeEvents }
