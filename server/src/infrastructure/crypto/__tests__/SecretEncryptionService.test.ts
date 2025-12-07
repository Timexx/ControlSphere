import { describe, test, expect, beforeEach } from 'vitest'
import { SecretEncryptionService } from '../SecretEncryptionService'

describe('SecretEncryptionService', () => {
  let service: SecretEncryptionService
  const testMasterKey = 'test-jwt-secret-that-is-long-enough-for-aes-256'

  beforeEach(() => {
    service = new SecretEncryptionService(testMasterKey)
  })

  describe('encrypt/decrypt', () => {
    test('should encrypt and decrypt a secret correctly', () => {
      const plaintext = 'my-secret-agent-key-64-characters-long-abcdef1234567890abcdef'
      
      const encrypted = service.encrypt(plaintext)
      const decrypted = service.decrypt(encrypted)
      
      expect(decrypted).toBe(plaintext)
    })

    test('should produce different ciphertexts for same plaintext (random IV)', () => {
      const plaintext = 'same-secret'
      
      const encrypted1 = service.encrypt(plaintext)
      const encrypted2 = service.encrypt(plaintext)
      
      // Different encrypted values due to random IV
      expect(encrypted1).not.toBe(encrypted2)
      
      // But both decrypt to same plaintext
      expect(service.decrypt(encrypted1)).toBe(plaintext)
      expect(service.decrypt(encrypted2)).toBe(plaintext)
    })

    test('should handle empty string', () => {
      const plaintext = ''
      const encrypted = service.encrypt(plaintext)
      expect(service.decrypt(encrypted)).toBe('')
    })

    test('should handle special characters', () => {
      const plaintext = 'secret!@#$%^&*(){}[]|\\:";\'<>?,./`~'
      const encrypted = service.encrypt(plaintext)
      expect(service.decrypt(encrypted)).toBe(plaintext)
    })

    test('should handle unicode characters', () => {
      const plaintext = 'geheim🔒密码مرور비밀번호'
      const encrypted = service.encrypt(plaintext)
      expect(service.decrypt(encrypted)).toBe(plaintext)
    })
  })

  describe('format validation', () => {
    test('encrypted value should match format iv:authTag:ciphertext', () => {
      const plaintext = 'test-secret'
      const encrypted = service.encrypt(plaintext)
      
      const parts = encrypted.split(':')
      expect(parts).toHaveLength(3)
      
      // All parts should be valid hex
      parts.forEach(part => {
        expect(part).toMatch(/^[a-fA-F0-9]+$/)
        expect(part.length).toBeGreaterThan(0)
      })
    })

    test('isEncrypted should detect encrypted format', () => {
      const plaintext = 'test-secret'
      const encrypted = service.encrypt(plaintext)
      
      expect(service.isEncrypted(encrypted)).toBe(true)
      expect(service.isEncrypted(plaintext)).toBe(false)
      expect(service.isEncrypted('not:encrypted:format')).toBe(false)
      expect(service.isEncrypted('abc')).toBe(false)
    })
  })

  describe('error handling', () => {
    test('should throw on invalid encrypted format', () => {
      expect(() => service.decrypt('invalid')).toThrow('Invalid encrypted format')
      expect(() => service.decrypt('only:two')).toThrow('Invalid encrypted format')
      expect(() => service.decrypt('')).toThrow('Invalid encrypted format')
    })

    test('should throw on tampered ciphertext', () => {
      const plaintext = 'test-secret'
      const encrypted = service.encrypt(plaintext)
      
      // Tamper with ciphertext (flip first byte to ensure mutation)
      const parts = encrypted.split(':')
      const cipherBuf = Buffer.from(parts[2], 'hex')
      cipherBuf[0] = cipherBuf[0] ^ 0xff
      parts[2] = cipherBuf.toString('hex')
      const tampered = parts.join(':')
      
      expect(() => service.decrypt(tampered)).toThrow('Decryption failed')
    })

    test('should throw on tampered auth tag', () => {
      const plaintext = 'test-secret'
      const encrypted = service.encrypt(plaintext)
      
      // Tamper with auth tag
      const parts = encrypted.split(':')
      parts[1] = parts[1].replace(/0/g, 'f')
      const tampered = parts.join(':')
      
      expect(() => service.decrypt(tampered)).toThrow('Decryption failed')
    })

    test('should throw on wrong master key', () => {
      const plaintext = 'test-secret'
      const encrypted = service.encrypt(plaintext)
      
      // Try to decrypt with different service (different master key)
      const wrongService = new SecretEncryptionService('different-master-key-value')
      
      expect(() => wrongService.decrypt(encrypted)).toThrow('Decryption failed')
    })
  })

  describe('security properties', () => {
    test('IV should be 16 bytes (32 hex chars)', () => {
      const encrypted = service.encrypt('test')
      const ivHex = encrypted.split(':')[0]
      expect(ivHex.length).toBe(32) // 16 bytes = 32 hex chars
    })

    test('auth tag should be 16 bytes (32 hex chars)', () => {
      const encrypted = service.encrypt('test')
      const authTagHex = encrypted.split(':')[1]
      expect(authTagHex.length).toBe(32) // 16 bytes = 32 hex chars
    })

    test('should use AES-256-GCM (master key derived to 32 bytes)', () => {
      // Implicit test - if master key wasn't 32 bytes, encryption would fail
      const plaintext = 'test'
      const encrypted = service.encrypt(plaintext)
      expect(service.decrypt(encrypted)).toBe(plaintext)
    })
  })
})
