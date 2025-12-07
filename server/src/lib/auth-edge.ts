import { jwtVerify } from 'jose'

/**
 * Edge Runtime compatible auth functions
 * No Node.js APIs or modules (fs, path, crypto, bcrypt)
 * Used by middleware.ts
 */

// Get JWT_SECRET with validation (Edge runtime safe)
function getJWTSecret(): string {
    const secret = process.env.JWT_SECRET
    
    if (!secret || secret.length < 32) {
        throw new Error(
            'JWT_SECRET must be set in environment variables. ' +
            'Generate with: openssl rand -base64 64'
        )
    }
    
    return secret
}

const SECRET_KEY = getJWTSecret()
const key = new TextEncoder().encode(SECRET_KEY)

// Track the secret version to invalidate sessions on secret change
const SECRET_VERSION = Buffer.from(SECRET_KEY).toString('base64').slice(0, 8)

export async function decrypt(input: string): Promise<any> {
    try {
        const { payload } = await jwtVerify(input, key, {
            algorithms: ['HS256'],
        })
        
        // Invalidate sessions created with a different secret
        if (payload.secretVersion !== SECRET_VERSION) {
            console.warn('Session invalidated: JWT_SECRET has changed')
            return null
        }
        
        return payload
    } catch (error) {
        return null
    }
}
