import crypto from 'crypto'

/**
 * Hash a secret key using SHA-256
 * @param secretKey - The plaintext secret key to hash
 * @returns The hex-encoded hash of the secret key
 */
export function hashSecretKey(secretKey: string): string {
  return crypto.createHash('sha256').update(secretKey).digest('hex')
}

/**
 * Verify a secret key against a stored hash
 * @param secretKey - The plaintext secret key to verify
 * @param secretKeyHash - The stored hash to compare against
 * @returns True if the key matches the hash, false otherwise
 */
export function verifySecretKey(secretKey: string, secretKeyHash: string): boolean {
  const hash = hashSecretKey(secretKey)
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(secretKeyHash))
}

/**
 * Generate a new random secret key
 * @returns A 64-character hex string (32 random bytes)
 */
export function generateSecretKey(): string {
  return crypto.randomBytes(32).toString('hex')
}

// ─── User Password Utilities ────────────────────────────────────────────────

const UPPERCASE = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const LOWERCASE = 'abcdefghjkmnpqrstuvwxyz'
const DIGITS = '23456789'
const SPECIAL = '!@#$%&*_+-='
const ALL_CHARS = UPPERCASE + LOWERCASE + DIGITS + SPECIAL

/**
 * Generate a cryptographically secure random password.
 * Guarantees at least one uppercase, one lowercase, one digit, and one special character.
 * @param length - Password length (minimum 12, default 16)
 * @returns A random password string
 */
export function generateSecurePassword(length = 16): string {
  if (length < 12) length = 12

  // Ensure at least one of each required character class
  const required = [
    UPPERCASE[crypto.randomInt(UPPERCASE.length)],
    LOWERCASE[crypto.randomInt(LOWERCASE.length)],
    DIGITS[crypto.randomInt(DIGITS.length)],
    SPECIAL[crypto.randomInt(SPECIAL.length)],
  ]

  // Fill the rest randomly from all characters
  const remaining: string[] = []
  for (let i = 0; i < length - required.length; i++) {
    remaining.push(ALL_CHARS[crypto.randomInt(ALL_CHARS.length)])
  }

  // Shuffle (Fisher-Yates) to avoid predictable positions
  const chars = [...required, ...remaining]
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }

  return chars.join('')
}
