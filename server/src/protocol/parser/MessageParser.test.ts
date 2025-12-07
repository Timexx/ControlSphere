import { MessageParser } from './MessageParser'
import { ConsoleLogger } from '../../types/logger'

describe('MessageParser', () => {
  let parser: MessageParser
  let logger: ConsoleLogger

  beforeEach(() => {
    logger = new ConsoleLogger()
    parser = new MessageParser(logger)
  })

  describe('parse', () => {
    test('should parse complete JSON message', () => {
      const data = '{"type":"register","secretKey":"abc123"}'
      const result = parser.parse(data)
      
      expect(result).not.toBeNull()
      expect(result?.data.type).toBe('register')
      expect(result?.data.secretKey).toBe('abc123')
      expect(result?.timestamp).toBeGreaterThan(0)
    })

    test('should handle buffer input', () => {
      const data = Buffer.from('{"type":"test"}')
      const result = parser.parse(data)
      
      expect(result).not.toBeNull()
      expect(result?.data.type).toBe('test')
    })

    test('should buffer incomplete JSON', () => {
      const incomplete = '{"type"'
      const result = parser.parse(incomplete)
      
      expect(result).toBeNull()
      expect(parser.getBufferState()).toBe(incomplete)
    })

    test('should complete JSON from multiple chunks', () => {
      parser.parse('{"type"')
      const result = parser.parse(':"register"}')
      
      expect(result).not.toBeNull()
      expect(result?.data.type).toBe('register')
      expect(parser.getBufferState()).toBe('')
    })

    test('should handle multiple messages in one chunk', () => {
      const chunk = '{"a":1}{"b":2}'
      const msg1 = parser.parse(chunk)
      
      expect(msg1?.data.a).toBe(1)
      
      // Second message still in buffer
      const msg2 = parser.parse('')
      expect(msg2?.data.b).toBe(2)
    })

    test('should recover from malformed JSON', () => {
      // Malformed JSON followed by valid JSON
      const chunk = '{invalid}{"type":"test"}'
      
      // Parser skips malformed, extracts valid
      const result = parser.parse(chunk)
      expect(result?.data.type).toBe('test')
    })

    test('should preserve JSON with nested objects', () => {
      const data = '{"type":"test","nested":{"value":123}}'
      const result = parser.parse(data)
      
      expect(result?.data.nested.value).toBe(123)
    })

    test('should handle empty JSON object', () => {
      const result = parser.parse('{}')
      
      expect(result).not.toBeNull()
      expect(result?.data).toEqual({})
    })

    test('should return null for invalid data', () => {
      const result = parser.parse('not json at all')
      expect(result).toBeNull()
    })

    test('should clear buffer on error', () => {
      parser.parse('bad data')
      parser.clear()
      
      expect(parser.getBufferState()).toBe('')
    })
  })

  describe('parseArray', () => {
    test('should parse multiple messages', () => {
      const data = '{"id":1}{"id":2}{"id":3}'
      const results = parser.parseArray(data)
      
      expect(results.length).toBe(3)
      expect(results[0].data.id).toBe(1)
      expect(results[1].data.id).toBe(2)
      expect(results[2].data.id).toBe(3)
    })

    test('should handle empty input', () => {
      const results = parser.parseArray('')
      expect(results.length).toBe(0)
    })
  })
})
