import { OutputNormalizer } from './OutputNormalizer'
import { ConsoleLogger } from '../../types/logger'

describe('OutputNormalizer', () => {
  let normalizer: OutputNormalizer
  let logger: ConsoleLogger

  beforeEach(() => {
    logger = new ConsoleLogger()
    normalizer = new OutputNormalizer(logger)
  })

  describe('normalize - string input', () => {
    test('should handle normal string', () => {
      const result = normalizer.normalize('Hello World')
      
      expect(result.text).toBe('Hello World')
      expect(result.isBinary).toBe(false)
      expect(result.printableRatio).toBeGreaterThan(0.9)
    })

    test('should preserve newlines and tabs', () => {
      const result = normalizer.normalize('Line 1\nLine 2\tTabbed')
      
      expect(result.text).toContain('\n')
      expect(result.text).toContain('\t')
      expect(result.isBinary).toBe(false)
    })

    test('should preserve ANSI color codes', () => {
      const ansiText = 'Normal \x1b[31mRed\x1b[0m text'
      const result = normalizer.normalize(ansiText)
      
      expect(result.text).toContain('\x1b[31m')
      expect(result.text).toContain('\x1b[0m')
      expect(result.isBinary).toBe(false)
    })

    test('should preserve ANSI style codes', () => {
      const ansiText = '\x1b[1;32;4mBold Green Underline\x1b[0m'
      const result = normalizer.normalize(ansiText)
      
      expect(result.text).toContain('\x1b[')
      expect(result.isBinary).toBe(false)
    })

    test('should handle empty string', () => {
      const result = normalizer.normalize('')
      
      expect(result.text).toBe('')
      expect(result.printableRatio).toBe(0)
    })
  })

  describe('normalize - buffer input', () => {
    test('should decode UTF-8 buffer', () => {
      const buffer = Buffer.from('Hello UTF-8: 你好')
      const result = normalizer.normalize(buffer)
      
      expect(result.text).toContain('Hello')
      expect(result.text).toContain('你好')
      expect(result.isBinary).toBe(false)
    })

    test('should handle binary buffer', () => {
      const binaryBuffer = Buffer.alloc(100, 0x00)
      const result = normalizer.normalize(binaryBuffer)
      
      expect(result.text).toBe('')
      expect(result.isBinary).toBe(true)
      expect(result.printableRatio).toBeLessThan(0.6)
    })

    test('should handle mixed binary and text', () => {
      const mixed = Buffer.concat([
        Buffer.from('Hello'),
        Buffer.alloc(50, 0x00),
        Buffer.from('World')
      ])
      const result = normalizer.normalize(mixed)
      
      // Should be marked as binary due to low printability
      expect(result.isBinary).toBe(true)
    })

    test('should calculate correct printability ratio', () => {
      // 100 bytes, 50 printable = 0.5 ratio (should be dropped as < 0.6)
      const buffer = Buffer.alloc(100)
      for (let i = 0; i < 50; i++) {
        buffer[i] = 0x41 // 'A'
      }
      for (let i = 50; i < 100; i++) {
        buffer[i] = 0x00 // null
      }
      
      const result = normalizer.normalize(buffer)
      
      expect(result.printableRatio).toBeLessThan(0.6)
      expect(result.isBinary).toBe(true)
      expect(result.text).toBe('')
    })
  })

  describe('printability detection', () => {
    test('should accept 60% printable content', () => {
      // Create buffer with 60% printable ratio (should pass)
      const buffer = Buffer.alloc(100)
      for (let i = 0; i < 60; i++) {
        buffer[i] = 0x41 // 'A' (printable)
      }
      for (let i = 60; i < 100; i++) {
        buffer[i] = 0x00 // null (non-printable)
      }
      
      const result = normalizer.normalize(buffer)
      
      expect(result.isBinary).toBe(false)
      expect(result.printableRatio).toBeGreaterThanOrEqual(0.6)
    })

    test('should reject 59% printable content', () => {
      const buffer = Buffer.alloc(100)
      for (let i = 0; i < 59; i++) {
        buffer[i] = 0x41 // 'A'
      }
      for (let i = 59; i < 100; i++) {
        buffer[i] = 0x00 // null
      }
      
      const result = normalizer.normalize(buffer)
      
      expect(result.isBinary).toBe(true)
      expect(result.text).toBe('')
    })
  })

  describe('ANSI sequence handling', () => {
    test('should preserve simple ANSI sequence', () => {
      const text = '\x1b[1m'
      const result = normalizer.normalize(text)
      
      expect(result.text).toContain('\x1b[')
    })

    test('should preserve complex ANSI with parameters', () => {
      const text = '\x1b[38;5;196mRed\x1b[0m'
      const result = normalizer.normalize(text)
      
      expect(result.text).toContain('\x1b[38;5;196m')
      expect(result.text).toContain('Red')
    })

    test('should handle multiple ANSI sequences', () => {
      const text = '\x1b[1m\x1b[31mBold Red\x1b[0m\x1b[0m'
      const result = normalizer.normalize(text)
      
      expect(result.text).toContain('Bold Red')
      expect(result.isBinary).toBe(false)
    })

    test('should handle incomplete ANSI sequence', () => {
      const text = 'Normal \x1b[' // Incomplete escape
      const result = normalizer.normalize(text)
      
      expect(result.text).toContain('Normal')
      expect(result.isBinary).toBe(false)
    })
  })

  describe('original length tracking', () => {
    test('should track original string length', () => {
      const text = 'Hello World'
      const result = normalizer.normalize(text)
      
      expect(result.originalLength).toBe(text.length)
    })

    test('should track original buffer length', () => {
      const buffer = Buffer.from('Test')
      const result = normalizer.normalize(buffer)
      
      expect(result.originalLength).toBe(buffer.length)
    })
  })

  describe('error handling', () => {
    test('should handle decode errors gracefully', () => {
      // Invalid UTF-8 sequence
      const buffer = Buffer.from([0xff, 0xfe, 0xfd])
      const result = normalizer.normalize(buffer)
      
      // Should not throw, should mark as binary
      expect(result.isBinary).toBe(true)
    })
  })

  describe('real-world examples', () => {
    test('should handle shell prompt output', () => {
      const shellOutput = 'user@host:~$ ls\nfile1.txt\nfile2.txt\nuser@host:~$ '
      const result = normalizer.normalize(shellOutput)
      
      expect(result.text).toContain('file1.txt')
      expect(result.isBinary).toBe(false)
      expect(result.printableRatio).toBeGreaterThan(0.9)
    })

    test('should handle colored command output', () => {
      const coloredOutput = '\x1b[1;31mError:\x1b[0m Permission denied\n'
      const result = normalizer.normalize(coloredOutput)
      
      expect(result.text).toContain('Error')
      expect(result.text).toContain('Permission denied')
      expect(result.isBinary).toBe(false)
    })

    test('should handle build tool output', () => {
      const buildOutput = '[✓] Build successful\n[✓] 2 files compiled\n'
      const result = normalizer.normalize(buildOutput)
      
      expect(result.text).toContain('Build successful')
      expect(result.isBinary).toBe(false)
    })
  })
})
