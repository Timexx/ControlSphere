import { NextResponse } from 'next/server'
import { readFile, writeFile, access, mkdir } from 'fs/promises'
import { join } from 'path'
import crypto from 'crypto'

// Pfad für Schlüsseldateien
const KEYS_DIR = join(process.cwd(), '.keys')
const PRIVATE_KEY_PATH = join(KEYS_DIR, 'agent-signing.pem')
const PUBLIC_KEY_PATH = join(KEYS_DIR, 'agent-signing.pub')

// Generiert oder lädt RSA-Schlüsselpaar für Code-Signierung
async function getOrCreateSigningKeys(): Promise<{ privateKey: string; publicKey: string }> {
  try {
    // Prüfe ob Schlüssel bereits existieren
    await access(PRIVATE_KEY_PATH)
    await access(PUBLIC_KEY_PATH)
    
    const privateKey = await readFile(PRIVATE_KEY_PATH, 'utf-8')
    const publicKey = await readFile(PUBLIC_KEY_PATH, 'utf-8')
    return { privateKey, publicKey }
  } catch {
    // Schlüssel existieren nicht - generiere neue
    console.log('🔐 Generating new RSA key pair for agent code signing...')
    
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 4096,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem'
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem'
      }
    })
    
    // Erstelle Verzeichnis falls nicht vorhanden
    try {
      await mkdir(KEYS_DIR, { recursive: true, mode: 0o700 })
    } catch {
      // Verzeichnis existiert bereits
    }
    
    // Speichere Schlüssel mit restriktiven Berechtigungen
    await writeFile(PRIVATE_KEY_PATH, privateKey, { mode: 0o600 })
    await writeFile(PUBLIC_KEY_PATH, publicKey, { mode: 0o644 })
    
    console.log('✅ RSA key pair generated and saved')
    console.log(`   Private key: ${PRIVATE_KEY_PATH}`)
    console.log(`   Public key: ${PUBLIC_KEY_PATH}`)
    
    return { privateKey, publicKey }
  }
}

// Signiert Daten mit dem privaten Schlüssel
function signData(data: string, privateKey: string): string {
  const sign = crypto.createSign('RSA-SHA256')
  sign.update(data)
  sign.end()
  return sign.sign(privateKey, 'base64')
}

// Berechnet SHA-256 Hash
function computeHash(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex')
}

export async function GET() {
  try {
    const agentDir = join(process.cwd(), '..', 'agent')
    
    // Lese alle notwendigen Dateien
    const mainGo = await readFile(join(agentDir, 'main.go'), 'utf-8')
    const goMod = await readFile(join(agentDir, 'go.mod'), 'utf-8')
    
    // Hole Signing-Keys
    const { privateKey, publicKey } = await getOrCreateSigningKeys()
    
    // Erstelle Dateien-Objekt
    const files = {
      'main.go': mainGo,
      'go.mod': goMod,
    }
    
    // Berechne Hashes für jede Datei
    const hashes = {
      'main.go': computeHash(mainGo),
      'go.mod': computeHash(goMod),
    }
    
    // Erstelle signierbare Daten (sortierte Hashes)
    const signableData = Object.entries(hashes)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, hash]) => `${name}:${hash}`)
      .join('\n')
    
    // Signiere die Hashes
    const signature = signData(signableData, privateKey)
    
    // Zeitstempel für Replay-Schutz
    const timestamp = new Date().toISOString()
    const timestampedData = `${signableData}\ntimestamp:${timestamp}`
    const timestampedSignature = signData(timestampedData, privateKey)
    
    return NextResponse.json({
      files,
      hashes,
      signature,
      timestamp,
      timestampedSignature,
      publicKey,  // Agent braucht den Public Key zur Verifikation
      signatureAlgorithm: 'RSA-SHA256',
      hashAlgorithm: 'SHA-256'
    }, {
      headers: {
        'Content-Type': 'application/json',
        'X-Signature-Algorithm': 'RSA-SHA256',
        'X-Hash-Algorithm': 'SHA-256'
      },
    })
  } catch (error) {
    console.error('Failed to read agent source:', error)
    return NextResponse.json({ error: 'Agent source not found' }, { status: 404 })
  }
}

// Endpunkt um nur den Public Key abzurufen (für initiale Agent-Installation)
export async function HEAD() {
  try {
    const { publicKey } = await getOrCreateSigningKeys()
    return new NextResponse(null, {
      headers: {
        'X-Public-Key': Buffer.from(publicKey).toString('base64'),
        'X-Signature-Algorithm': 'RSA-SHA256'
      }
    })
  } catch (error) {
    return new NextResponse(null, { status: 500 })
  }
}
