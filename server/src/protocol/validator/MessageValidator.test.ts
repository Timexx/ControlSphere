import { MessageValidator } from './MessageValidator'
import { ConsoleLogger } from '../../types/logger'

describe('MessageValidator', () => {
  let validator: MessageValidator
  let logger: ConsoleLogger

  beforeEach(() => {
    logger = new ConsoleLogger()
    validator = new MessageValidator(logger)
  })

  describe('validate - register schema', () => {
    test('should validate valid register message', () => {
      const data = {
        secretKey: 'a'.repeat(64),
        hostname: 'server-1',
        ip: '192.168.1.1'
      }
      const result = validator.validate(data, 'register')
      
      expect(result.valid).toBe(true)
      expect(result.data).toBeDefined()
    })

    test('should reject invalid secretKey', () => {
      const data = {
        secretKey: 'too-short',
        hostname: 'server-1',
        ip: '192.168.1.1'
      }
      const result = validator.validate(data, 'register')
      
      expect(result.valid).toBe(false)
      expect(result.errors?.[0]).toContain('64-character')
    })

    test('should reject invalid IP', () => {
      const data = {
        secretKey: 'a'.repeat(64),
        hostname: 'server-1',
        ip: 'not-an-ip'
      }
      const result = validator.validate(data, 'register')
      
      expect(result.valid).toBe(false)
      expect(result.errors?.[0]).toContain('IP')
    })

    test('should reject missing required fields', () => {
      const data = {
        secretKey: 'a'.repeat(64)
        // missing hostname and ip
      }
      const result = validator.validate(data, 'register')
      
      expect(result.valid).toBe(false)
      expect(result.errors?.[0]).toContain('Missing required fields')
    })
  })

  describe('validate - command_response schema', () => {
    test('should validate valid command response', () => {
      const data = {
        commandId: 'cmd-123',
        output: 'Command executed successfully',
        exitCode: 0
      }
      const result = validator.validate(data, 'command_response')
      
      expect(result.valid).toBe(true)
    })

    test('should reject non-numeric exitCode', () => {
      const data = {
        commandId: 'cmd-123',
        output: 'output',
        exitCode: 'zero'
      }
      const result = validator.validate(data, 'command_response')
      
      expect(result.valid).toBe(false)
    })
  })

  describe('validate - unknown schema', () => {
    test('should reject unknown schema', () => {
      const result = validator.validate({}, 'unknown_type')
      
      expect(result.valid).toBe(false)
      expect(result.errors?.[0]).toContain('Unknown message type')
    })
  })

  describe('validate - non-object input', () => {
    test('should reject non-object input', () => {
      const result = validator.validate('not an object', 'register')
      
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Message must be an object')
    })

    test('should reject null input', () => {
      const result = validator.validate(null, 'register')
      
      expect(result.valid).toBe(false)
    })
  })

  describe('sanitize', () => {
    test('should remove secretKey', () => {
      const data = {
        type: 'test',
        secretKey: 'a'.repeat(64),
        hostname: 'test',
        ip: '192.168.1.1'
      }
      const result = validator.validate(data, 'register')
      
      expect(result.data.secretKey).toBe('a'.repeat(64))
      expect(result.sanitized?.secretKey).toBeUndefined()
      expect(result.data.hostname).toBe('test')
    })

    test('should remove password', () => {
      const data = {
        username: 'admin',
        password: 'secret123',
        hostname: 'test',
        ip: '192.168.1.1',
        secretKey: 'a'.repeat(64)
      }
      const result = validator.validate(data, 'register')
      
      expect(result.data.password).toBe('secret123')
      expect(result.sanitized?.password).toBeUndefined()
    })

    test('should remove token', () => {
      const data = {
        token: 'jwt-token-123',
        hostname: 'test',
        ip: '192.168.1.1',
        secretKey: 'a'.repeat(64)
      }
      const result = validator.validate(data, 'register')
      
      expect(result.data.token).toBe('jwt-token-123')
      expect(result.sanitized?.token).toBeUndefined()
    })

    test('should truncate very long strings', () => {
      const longString = 'a'.repeat(1_000_001)
      const data = {
        commandId: 'cmd-123',
        output: longString,
        exitCode: 0
      }
      const result = validator.validate(data, 'command_response')
      
      expect(result.data.output.length).toBe(1_000_000)
    })

    test('should convert buffers to base64', () => {
      const buffer = Buffer.from('test-data')
      const data = {
        secretKey: 'a'.repeat(64),
        hostname: 'test',
        ip: '192.168.1.1',
        binaryData: buffer
      }
      const result = validator.validate(data, 'register')
      
      expect(typeof result.data.binaryData).toBe('string')
      expect(Buffer.from(result.data.binaryData, 'base64').toString()).toBe('test-data')
    })
  })

  describe('terminal messages', () => {
    test('should validate terminal_output', () => {
      const data = {
        sessionId: 'session-123',
        output: 'command output'
      }
      const result = validator.validate(data, 'terminal_output')
      
      expect(result.valid).toBe(true)
    })

    test('should validate terminal_input', () => {
      const data = {
        machineId: 'machine-1',
        sessionId: 'session-123',
        data: 'ls\n'
      }
      const result = validator.validate(data, 'terminal_input')
      
      expect(result.valid).toBe(true)
    })

    test('should validate spawn_terminal', () => {
      const data = {
        machineId: 'machine-1',
        sessionId: 'session-123'
      }
      const result = validator.validate(data, 'spawn_terminal')
      
      expect(result.valid).toBe(true)
    })

    test('should validate spawn_terminal without sessionId', () => {
      const data = {
        machineId: 'machine-1'
      }
      const result = validator.validate(data, 'spawn_terminal')
      
      expect(result.valid).toBe(true)
    })
  })
})
