import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'

/**
 * Node.js runtime auth functions
 * Used by API routes and server components
 * Includes password hashing and JWT secret auto-generation
 */

// Lazy import bcrypt only when needed (not at module level)
let bcrypt: any = null
function getBcrypt() {
    if (!bcrypt) {
        console.log('📦 Loading bcryptjs...')
        bcrypt = require('bcryptjs')
        console.log('✓ bcryptjs loaded successfully')
    }
    return bcrypt
}

// Auto-generate and save JWT_SECRET if missing or weak
// Only runs in Node.js runtime (not Edge runtime)
function ensureJWTSecret(): string {
    const secret = process.env.JWT_SECRET
    
    // In Edge runtime or if secret exists and is strong enough, just validate
    if (typeof window !== 'undefined' || !globalThis.process?.versions?.node) {
        // Edge runtime - just use the secret without file operations
        if (!secret || secret.length < 32) {
            throw new Error(
                'JWT_SECRET must be set in environment variables for Edge runtime. ' +
                'Generate with: openssl rand -base64 64'
            )
        }
        return secret
    }
    
    // Node.js runtime - can do file operations
    // Lazy load Node.js modules only when needed
    const needsGeneration = !secret || secret.length < 32
    
    // Check for insecure patterns
    if (secret) {
        const insecurePatterns = ['change-me', 'secret', 'password', 'test', 'demo', '123456']
        const lowerSecret = secret.toLowerCase()
        for (const pattern of insecurePatterns) {
            if (lowerSecret.includes(pattern)) {
                console.warn(`⚠️  JWT_SECRET contains insecure pattern "${pattern}" - generating new secure secret`)
                return generateAndSaveSecret()
            }
        }
    }
    
    if (needsGeneration) {
        return generateAndSaveSecret()
    }
    
    console.log('✓ JWT_SECRET validated successfully')
    return secret!
}

function generateAndSaveSecret(): string {
    // Lazy load Node.js modules
    const fs = require('fs')
    const path = require('path')
    const crypto = require('crypto')
    
    const envPath = path.join(process.cwd(), '.env')
    let envContent = ''
    
    // Read existing .env file if it exists
    if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, 'utf8')
    }
    
    // Generate cryptographically secure random secret (64 bytes = base64 will be ~88 chars)
    const newSecret = crypto.randomBytes(64).toString('base64')
    
    console.log('🔐 Generating new JWT_SECRET...')
    
    // Update or add JWT_SECRET in .env content
    const lines = envContent.split('\n')
    let secretUpdated = false
    
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('JWT_SECRET=')) {
            lines[i] = `JWT_SECRET=${newSecret}`
            secretUpdated = true
            break
        }
    }
    
    if (!secretUpdated) {
        // Add JWT_SECRET at the end
        if (envContent && !envContent.endsWith('\n')) {
            lines.push('')
        }
        lines.push(`# Auto-generated JWT Secret (${new Date().toISOString()})`)
        lines.push(`JWT_SECRET=${newSecret}`)
    }
    
    // Write back to .env
    const newContent = lines.join('\n')
    fs.writeFileSync(envPath, newContent, 'utf8')
    
    // Update process.env for current process
    process.env.JWT_SECRET = newSecret
    
    console.log('✅ JWT_SECRET generated and saved to .env')
    console.log('🔒 Secret length:', newSecret.length, 'characters')
    
    return newSecret
}

const SECRET_KEY = ensureJWTSecret()
const key = new TextEncoder().encode(SECRET_KEY)

// Track the secret version to invalidate sessions on secret change
const SECRET_VERSION = Buffer.from(SECRET_KEY).toString('base64').slice(0, 8)

export async function encrypt(payload: any) {
    return await new SignJWT({
        ...payload,
        secretVersion: SECRET_VERSION  // Include secret version to invalidate old sessions
    })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('30m')
        .sign(key)
}

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

export async function getSession() {
    const session = cookies().get('session')?.value
    if (!session) return null
    return await decrypt(session)
}

export async function hashPassword(password: string) {
    const bcrypt = getBcrypt()
    return await bcrypt.hash(password, 10)
}

export async function verifyPassword(password: string, hash: string) {
    const bcrypt = getBcrypt()
    return await bcrypt.compare(password, hash)
}