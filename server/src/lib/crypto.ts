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
