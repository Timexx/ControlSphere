# Protocol Layer - Message Parsing & Validation

**Date:** 2025-12-06  
**Status:** ✅ Implemented  
**Phase:** Phase 4 (Protocol Layer)  
**Compliance:** ISO/IEC 27001 A.14.2.1 (Input Validation)  

---

## Overview

The Protocol Layer handles all message-level concerns:
- **Parsing**: Extract JSON from binary streams
- **Validation**: Schema validation and data sanitization
- **Routing**: Type-based message dispatching
- **Normalization**: Clean output formatting

```
Raw Data (Binary Stream)
       ↓
   Parser (JSON extraction)
       ↓
 Validator (Schema check + Sanitize)
       ↓
   Router (Type dispatch)
       ↓
 Normalizer (Output cleanup)
```

---

## Architecture

### 1. MessageParser

**File:** `src/protocol/parser/MessageParser.ts`

**Purpose:** Extract JSON messages from binary streams with partial message handling.

**Key Features:**
- Handles incomplete messages (buffers them)
- Recovers from malformed JSON
- Preserves stream order
- UTF-8 decoding

**Usage:**
```typescript
const parser = new MessageParser(logger)
const message = parser.parse(buffer)

if (message) {
  console.log(message.data) // Parsed JSON object
  console.log(message.timestamp) // When parsed
}
```

**Internal State:**
- Maintains `buffer: string` for incomplete messages
- Regex-based JSON detection: `/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/`
- Recursive parsing for multiple messages in buffer

**Error Handling:**
- Invalid JSON: Skips and continues parsing
- Incomplete JSON: Returns null, buffers for next data
- Buffer overflow: Returns null and logs warning

---

### 2. MessageValidator

**File:** `src/protocol/validator/MessageValidator.ts`

**Purpose:** Validate message structure against JSON schemas and sanitize data.

**Schemas Supported:**

| Type | Required Fields | Validation |
|------|-----------------|-----------|
| `register` | secretKey, hostname, ip | secretKey=64-char hex, IP format |
| `heartbeat` | machineId, metrics | metrics must be object |
| `command_response` | commandId, output, exitCode | exitCode is number |
| `terminal_output` | sessionId, output | output is string/buffer |
| `spawn_terminal` | machineId, sessionId | - |
| `terminal_input` | machineId, sessionId, data | data is string/buffer |

**Usage:**
```typescript
const validator = new MessageValidator(logger)
const result = validator.validate(data, 'register')

if (result.valid) {
  console.log(result.data) // Sanitized data
} else {
  console.log(result.errors) // ['Missing required fields: ...']
}
```

**Sanitization:**
- Removes sensitive fields: secretKey, password, token
- Truncates strings > 1MB
- Converts buffers to base64
- Logs truncation warnings

**ISO 27001 Compliance (A.14.2.1):**
```typescript
// ✅ Input validation against schema
// ✅ Required field checking
// ✅ Sensitive data removal
// ✅ Size limit enforcement
// ✅ Type validation
```

---

### 3. MessageRouter

**File:** `src/protocol/router/MessageRouter.ts`

**Purpose:** Route messages to appropriate handlers based on type.

**Usage:**
```typescript
const router = new MessageRouter(logger)

router.register('register', async (data) => {
  await agentManager.handleRegistration(data)
})

router.register('command_response', async (data) => {
  await orchestrator.handleCommandOutput(data)
})

// Route incoming message
await router.route('register', message.data)
```

**Handler Registry:**
- Async function support
- Error handling with logging
- Type-safe dispatch
- Unknown type warnings

---

### 4. OutputNormalizer

**File:** `src/protocol/normalizer/OutputNormalizer.ts`

**Purpose:** Clean and normalize terminal/command output.

**Features:**
- Binary detection (printability ratio)
- ANSI code preservation
- UTF-8 decoding with fallback
- Noise filtering

**Usage:**
```typescript
const normalizer = new OutputNormalizer(logger)
const output = normalizer.normalize(buffer)

if (output.printableRatio >= 0.6) {
  // Safe to display
  console.log(output.text)
} else {
  // Mostly binary data, drop it
  console.log('Binary data dropped')
}
```

**Printability Calculation:**
```
Printable characters:
- ASCII 32-126 (normal text)
- \n, \r, \t (whitespace)
- ANSI escape sequences (colors)
- UTF-8 multibyte sequences

Ratio = printableCount / totalLength
If ratio < 0.6 (60%), chunk is dropped as noise
```

**Example:**
```
Input:  Buffer with 100 bytes, 65 printable
Output: { text: 'Hello World', isBinary: false, printableRatio: 0.65 }

Input:  Buffer with random binary data
Output: { text: '', isBinary: true, printableRatio: 0.15 }
```

---

## Integration with Connection Layer

### Agent Message Flow

```
Agent sends binary data over WebSocket
        ↓
AgentConnectionManager.onMessage(data)
        ↓
parser.parse(data)
        ↓
if (message) validator.validate(data, type)
        ↓
if (valid) router.route(type, sanitized_data)
        ↓
Handler processes message
```

### Terminal Output Flow

```
Agent sends terminal output: { type: 'terminal_output', sessionId, data: Buffer }
        ↓
parser.parse()
        ↓
validator.validate(..., 'terminal_output')
        ↓
normalizer.normalize(output)
        ↓
if (printable) broadcast to web client
        ↓
Browser Terminal.tsx receives: { type: 'terminal_output', output: string }
```

---

## Error Handling

### Parsing Errors
```typescript
// Incomplete JSON: Buffered for next data
const msg1 = parser.parse('{"type"')
// Returns null, stores in buffer

const msg2 = parser.parse('":"register"}')
// Completes message, returns { data: { type: 'register' }, ... }
```

### Validation Errors
```typescript
// Missing field
const result = validator.validate({ /* no secretKey */ }, 'register')
// Returns { valid: false, errors: ['Missing required fields: secretKey'] }

// Invalid field value
const result = validator.validate({ secretKey: 'too-short', ... }, 'register')
// Returns { valid: false, errors: ['secretKey must be 64-character hex string'] }
```

### Routing Errors
```typescript
// No handler
await router.route('unknown_type', data)
// Throws: "No handler registered for message type: unknown_type"
```

### Normalization
```typescript
// Binary noise is silently dropped
const output = normalizer.normalize(binaryNoise)
// Returns { text: '', isBinary: true, printableRatio: 0.15 }
```

---

## Security Considerations

### Input Validation (ISO A.14.2.1)
- ✅ All required fields checked
- ✅ Type validation enforced
- ✅ Size limits (1MB per field)
- ✅ Schema validation

### Sensitive Data Handling
- ✅ secretKey/token removed before logging
- ✅ Passwords never logged
- ✅ Sanitized data passed to handlers

### Malformed Data
- ✅ Invalid JSON causes skip (no crash)
- ✅ Unknown message types routed safely
- ✅ Binary noise filtered automatically

### DoS Prevention
- ✅ Size limits prevent memory exhaustion
- ✅ Printability check prevents binary attacks
- ✅ Parser buffer cleared on errors

---

## Testing

### Unit Tests

**MessageParser:**
```typescript
test('should parse complete JSON', () => {
  const parser = new MessageParser(logger)
  const result = parser.parse('{"type":"register"}')
  expect(result?.data.type).toBe('register')
})

test('should buffer incomplete JSON', () => {
  const parser = new MessageParser(logger)
  const result = parser.parse('{"type"')
  expect(result).toBeNull()
  expect(parser.getBufferState()).toBe('{"type"')
})

test('should recover from malformed JSON', () => {
  const parser = new MessageParser(logger)
  parser.parse('{invalid} complete')
  const result = parser.parse('{"type":"test"}')
  expect(result?.data.type).toBe('test')
})
```

**MessageValidator:**
```typescript
test('should validate against schema', () => {
  const validator = new MessageValidator(logger)
  const result = validator.validate(
    { secretKey: 'a'.repeat(64), hostname: 'test', ip: '192.168.1.1' },
    'register'
  )
  expect(result.valid).toBe(true)
})

test('should sanitize sensitive fields', () => {
  const validator = new MessageValidator(logger)
  const result = validator.validate(
    { type: 'test', secretKey: 'secret', password: 'pwd' },
    'register'
  )
  expect(result.data.secretKey).toBeUndefined()
  expect(result.data.password).toBeUndefined()
})
```

**MessageRouter:**
```typescript
test('should route to registered handler', async () => {
  const router = new MessageRouter(logger)
  const handler = jest.fn()
  router.register('test', handler)
  
  await router.route('test', { data: 'value' })
  expect(handler).toHaveBeenCalledWith({ data: 'value' })
})

test('should throw on unknown type', async () => {
  const router = new MessageRouter(logger)
  await expect(router.route('unknown', {})).rejects.toThrow()
})
```

**OutputNormalizer:**
```typescript
test('should preserve ANSI codes', () => {
  const normalizer = new OutputNormalizer(logger)
  const input = 'Normal \x1b[31mRed\x1b[0m text'
  const result = normalizer.normalize(input)
  expect(result.text).toContain('\x1b[31m')
})

test('should drop mostly binary data', () => {
  const normalizer = new OutputNormalizer(logger)
  const binaryData = Buffer.alloc(100, 0x00)
  const result = normalizer.normalize(binaryData)
  expect(result.isBinary).toBe(true)
  expect(result.text).toBe('')
})
```

---

## Performance

### MessageParser
- **O(n)** where n = buffer length
- Single pass regex matching
- Buffer reuse (no copying)

### MessageValidator
- **O(m)** where m = number of fields
- Schema lookup O(1)
- Field validation O(f) where f = field count

### OutputNormalizer
- **O(n)** where n = output length
- Single pass character iteration
- ANSI sequence detection inline

---

## Future Enhancements

1. **Message Compression**: gzip support for large payloads
2. **Message Versioning**: Version field for backward compatibility
3. **Rate Limiting**: Prevent flooding attacks
4. **Custom Validators**: Allow registering field-level validators
5. **Protocol Metrics**: Track parse/validate/route performance
