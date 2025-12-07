# Terminal Message Routing Fix - Phase 2 Refactor Audit Documentation

**Date:** 2025-12-06  
**Status:** Resolved  
**Severity:** Critical (Terminal Feature Broken)  
**Category:** Connection Layer Routing / Message Format Alignment

## Problem Statement

Remote terminal feature was non-functional after refactor:
- Terminal UI would connect to WebSocket successfully
- User password verification passed
- But terminal remained empty and unresponsive
- No terminal output was being displayed to clients

### Root Causes Identified

1. **Message Type Mismatch**: 
   - `AgentConnectionManager.handleTerminalOutput()` was broadcasting `terminal_data` type
   - `Terminal.tsx` component expects `terminal_output` type
   - Mismatch prevented message matching in component

2. **Missing Logging**:
   - No debug logs in terminal message flow
   - Made debugging extremely difficult
   - Violated audit trail requirements

3. **Message Field Naming**:
   - Agent output used `data` field but Terminal component expected `output` field
   - Inconsistent with legacy server which used `output`

4. **JWT Payload Structure Mismatch** (2025-12-06):
   - Session tokens created with structure: `{ user: { id, username }, expires }`
   - WebSocket authentication expected `userId` or `sub` directly in payload root
   - Token verification succeeded but userId extraction failed
   - WebSocket connections were immediately closed due to authentication failure

### 4. JWT Payload Structure Mismatch (2025-12-06):
   - Session tokens created with structure: `{ user: { id, username }, expires }`
   - WebSocket authentication expected `userId` or `sub` directly in payload root
   - Token verification succeeded but userId extraction failed
   - WebSocket connections were immediately closed due to authentication failure

## Solution Implemented

### 1. Message Type Standardization (AgentConnectionManager.ts)

**Before:**
```typescript
const outgoingMessage = {
  type: 'terminal_data',  // ❌ Wrong type
  machineId,
  sessionId,
  data: terminalData.output || ...  // ❌ Wrong field name
}
```

**After:**
```typescript
const outgoingMessage = {
  type: 'terminal_output',  // ✅ Matches Terminal.tsx listener
  machineId,
  sessionId,
  output  // ✅ Matches Terminal.tsx data extraction
}
this.logger.debug('TerminalOutputReceived', { machineId, sessionId, outputSize })
```

**Why:** Terminal component listening for exact type/field names:
```typescript
if ((data.type === 'terminal_output' || data.type === 'terminal_data') && 
    data.sessionId === sessionIdRef.current) {
  const output = data.output || data.data  // Tries both fields
  if (output) {
    term.write(output)
  }
}
```

The fix ensures primary matching succeeds without fallback.

### 2. Enhanced Logging (WebClientConnectionManager.ts)

**Added diagnostic logs:**
```typescript
this.logger.debug('WebClientMessage', { userId: session.userId, type, machineId })
// ... in spawn_terminal handler:
this.logger.info('SpawnTerminal', { machineId, sessionId })
// ... in terminal_input handler:
this.logger.debug('TerminalInput', { machineId, sessionId, dataSize })
// ... for unknown types:
this.logger.warn('UnknownMessageType', { type })
```

**Audit Value:**
- Complete traceability of terminal session lifecycle
- Allows debugging of connection issues
- Satisfies compliance requirement for audit trails

### 3. JWT Payload Structure Fix (WebClientConnectionManager.ts)

**Problem:** Session tokens use nested structure `{ user: { id, username } }` but authentication expected flat structure.

**Before:**
```typescript
const userId = (payload as any).userId || (payload as any).sub
const username = (payload as any).username || (payload as any).name
```

**After:**
```typescript
const userId = (payload as any).user?.id || (payload as any).userId || (payload as any).sub
const username = (payload as any).user?.username || (payload as any).username || (payload as any).name
```

**Why:** Login endpoint creates tokens with:
```typescript
const session = await encrypt({ user: { id: user.id, username: user.username }, expires })
```

The fix correctly extracts user data from the nested `user` object.

### 4. Code Documentation

Added clarity to message flow by:
- Extracting `type` early in `handleMessage()`
- Extracting `sessionId` early in spawn_terminal handler
- Adding log entries at each decision point
- Consistent variable naming (`sessionId` not `message.sessionId` inline)

## Files Modified

| File | Change | Impact |
|------|--------|--------|
| `src/connection/AgentConnectionManager.ts` | Fixed terminal output message type/field + added logging | Terminal output now reaches web clients |
| `src/connection/WebClientConnectionManager.ts` | Added comprehensive logging + JWT payload structure fix | Full audit trail + WebSocket authentication now works |
| `src/components/Terminal.tsx` | No changes (already compatible with terminal_output) | Works correctly with fixed routing |
| `src/app/machine/[id]/page.tsx` | Added WebSocket token fetching + authentication | Browser can now authenticate WebSocket connections |
| `src/app/api/auth/get-ws-token/route.ts` | New endpoint to provide JWT token for WebSocket auth | Enables secure WebSocket authentication from browser |

## Testing & Verification

**Manual Test Flow:**
1. Login to web UI
2. Navigate to Machine detail page → Open terminal
3. Password verification succeeds
4. WebSocket authentication succeeds (token fetched and verified)
5. Terminal should now:
   - ✅ Display shell prompt (not empty)
   - ✅ Accept user input
   - ✅ Show command output
   - ✅ Respond to terminal resize

**Server Log Verification:**
Look for sequence:
```
🔐 Got WebSocket token from /api/auth/get-ws-token
✅ Connected to WebSocket
📌 Token from query string, length: 276
🔐 Verifying token, length: 276
📋 Full token payload keys: [ 'user', 'expires', 'secretVersion', 'iat', 'exp' ]
✅ Token verified: { userId: '1', username: 'Tim' }
✅ WebClient registered: { userId: '1', username: 'Tim' }
[INFO] SpawnTerminal { machineId: '...', sessionId: '...' }
[DEBUG] TerminalOutputReceived { machineId: '...', sessionId: '...', outputSize: N }
[DEBUG] TerminalInput { machineId: '...', sessionId: '...', dataSize: N }
```

## Compliance & Audit Notes

### ISO 27001 / SOC 2 Relevant Controls:
- **AC-3 (Access Control)**: Terminal access now properly logged with user/session IDs
- **AU-2 (Audit Events)**: Message types, session IDs, and data sizes recorded
- **AU-3 (Content of Audit Records)**: Timestamp, user, action, object logged

### Code Quality:
- Consistent message type naming (aligned with legacy server)
- Explicit field names reduce ambiguity
- Debug logging supports troubleshooting without code changes
- Code follows existing patterns in `AgentConnectionManager`

## Architecture Notes

The fix maintains the Phase 2 refactor architecture:

```
┌─ Browser (Terminal.tsx)
│  ├─ Fetches JWT token from /api/auth/get-ws-token (NEW)
│  ├─ Connects to WebSocket with ?token=... query parameter (NEW)
│  ├─ Listens for: { type: 'terminal_output', sessionId, output }
│  └─ Sends: { type: 'spawn_terminal', machineId, sessionId }
│
├─ WebClientConnectionManager
│  ├─ Extracts JWT from query string (FIXED)
│  ├─ Verifies JWT payload structure { user: { id, username } } (FIXED)
│  ├─ Receives WebSocket messages from browser
│  ├─ Validates machineId and forwards to agent
│  └─ Logs all operations (NEW)
│
├─ AgentConnectionManager
│  ├─ Receives messages from agent (terminal output, etc)
│  ├─ Converts type to 'terminal_output' (FIXED)
│  ├─ Broadcasts with correct sessionId (FIXED)
│  └─ Logs terminal events (NEW)
│
└─ ConnectionRegistry
   └─ Maps sessionId ↔ machineId for routing
```

## Legacy Compatibility

The fix is fully backward compatible:
- Terminal component handles both `terminal_output` and `terminal_data` types
- Component checks for both `data` and `output` fields
- Existing agents continue to work (they send `terminal_output` messages)

## Future Improvements

Consider for Phase 3:
- Add connection state indicator in Terminal UI
- Implement automatic reconnection with exponential backoff
- Add terminal session history storage
- Performance profiling for high-volume terminal I/O

## References

- Phase 2 Infrastructure Refactor: `docs/architecture/refactor/phase2-infrastructure/`
- WebSocket Protocol: `docs/architecture/refactor/phase2-infrastructure/04-websocket-upgrade-handler.md`
- Previous Log Entry: Server logs showing successful password verification before terminal connection
