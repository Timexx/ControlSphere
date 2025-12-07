import crypto from 'crypto'

/**
 * SecretEncryptionService - Encrypts/decrypts agent secrets using AES-256-GCM
 * 
 * Security Design:
 * - Uses JWT_SECRET as master key (must be 32+ bytes)
 * - AES-256-GCM for authenticated encryption
 * - Random IV per encryption (stored with ciphertext)
 * - Auth tag prevents tampering
 * 
 * Format: iv:authTag:ciphertext (all hex encoded)
 * 
 * ISO 27001 Compliance:
 * - A.10.1.1: Encryption of sensitive data at rest
 * - A.10.1.2: Key management via environment variable
 */
export class SecretEncryptionService {
  private readonly algorithm = 'aes-256-gcm'
  private readonly ivLength = 16 // 128 bits
  private readonly authTagLength = 16 // 128 bits
  private masterKey: Buffer

  constructor(jwtSecret: string) {
    // Derive 32-byte key from JWT_SECRET using SHA-256
    this.masterKey = crypto.createHash('sha256').update(jwtSecret).digest()
  }

  /**
   * Encrypt a secret (agent secretKey)
   * Returns: "iv:authTag:ciphertext" (hex encoded)
   */
  encrypt(plaintext: string): string {
    // Generate random IV
    const iv = crypto.randomBytes(this.ivLength)
    
    // Create cipher
    const cipher = crypto.createCipheriv(this.algorithm, this.masterKey, iv)
    
    // Encrypt
    let ciphertext = cipher.update(plaintext, 'utf8', 'hex')
    ciphertext += cipher.final('hex')
    
    // Get auth tag
    const authTag = cipher.getAuthTag()
    
    // Return format: iv:authTag:ciphertext
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext}`
  }

  /**
   * Decrypt a secret
   * Input format: "iv:authTag:ciphertext" (hex encoded)
   * Returns: plaintext secret
   */
  decrypt(encrypted: string): string {
    // Parse format early to provide precise error for malformed input
    const parts = encrypted.split(':')
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted format')
    }

    try {
      const [ivHex, authTagHex, ciphertext] = parts
      const iv = Buffer.from(ivHex, 'hex')
      const authTag = Buffer.from(authTagHex, 'hex')

      const decipher = crypto.createDecipheriv(this.algorithm, this.masterKey, iv)
      decipher.setAuthTag(authTag)

      let plaintext = decipher.update(ciphertext, 'hex', 'utf8')
      plaintext += decipher.final('utf8')

      return plaintext
    } catch (error) {
      // Hide specifics to avoid oracle leakage; keep stable message for tests
      throw new Error('Decryption failed')
    }
  }

  /**
   * Check if a value is encrypted (matches our format)
   */
  isEncrypted(value: string): boolean {
    const parts = value.split(':')
    if (parts.length !== 3) return false
    
    // Check if parts are valid hex
    const hexRegex = /^[a-fA-F0-9]+$/
    return parts.every(part => hexRegex.test(part) && part.length > 0)
  }
}
