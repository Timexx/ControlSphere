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

// Lazy initialisation — avoid crashing at import time when JWT_SECRET is not
// yet available (e.g. during `next build`).
let _key: Uint8Array | null = null
let _secretVersion: string | null = null

function getKeyAndVersion() {
    if (!_key) {
        const secret = getJWTSecret()
        _key = new TextEncoder().encode(secret)
        _secretVersion = Buffer.from(secret).toString('base64').slice(0, 8)
    }
    return { key: _key, secretVersion: _secretVersion! }
}

export async function decrypt(input: string): Promise<any> {
    try {
        const { key, secretVersion } = getKeyAndVersion()
        const { payload } = await jwtVerify(input, key, {
            algorithms: ['HS256'],
        })
        
        // Invalidate sessions created with a different secret
        if (payload.secretVersion !== secretVersion) {
            console.warn('Session invalidated: JWT_SECRET has changed')
            return null
        }
        
        return payload
    } catch (error) {
        return null
    }
}
