// Agent build manifest (written by scripts/build-agents-if-needed.sh).
//
// Used by the Next.js routes (agent-download, install scripts, agent-manifest)
// AND by the ts-node custom server (WebClientConnectionManager) – therefore
// node built-ins and relative imports only, no '@/...' aliases.

import { readFile, stat } from 'fs/promises'
import { join } from 'path'

export interface AgentBinaryInfo {
  file: string
  sha256: string
  size: number
}

export interface AgentManifest {
  version: string
  sourceTree: string
  builtAt: string
  goVersion?: string
  binaries: Record<string, AgentBinaryInfo>
}

export const AGENT_OS = ['linux', 'windows'] as const
export const AGENT_ARCH = ['amd64', 'arm64'] as const
export type AgentOS = (typeof AGENT_OS)[number]
export type AgentArch = (typeof AGENT_ARCH)[number]

const FILE_PATTERN = /^maintainer-agent-(linux|windows)-(amd64|arm64)(\.exe)?$/
const SHA_PATTERN = /^[a-f0-9]{64}$/
const VERSION_PATTERN = /^[A-Za-z0-9._+-]{1,64}$/

/** Directory with the agent binaries (service runs with cwd = server/). */
export function agentDownloadsDir(): string {
  return join(process.cwd(), 'public', 'downloads')
}

/** Manifest key for os/arch, or null for unsupported values. */
export function agentBinaryKey(os: string | null | undefined, arch: string | null | undefined): string | null {
  const o = (os || '').toLowerCase()
  const a = (arch || '').toLowerCase()
  if (!(AGENT_OS as readonly string[]).includes(o)) return null
  if (!(AGENT_ARCH as readonly string[]).includes(a)) return null
  return `${o}-${a}`
}

function isValidManifest(m: any): m is AgentManifest {
  if (!m || typeof m !== 'object') return false
  if (typeof m.version !== 'string' || !VERSION_PATTERN.test(m.version)) return false
  if (!m.binaries || typeof m.binaries !== 'object') return false
  for (const [key, b] of Object.entries<any>(m.binaries)) {
    const [o, a] = key.split('-')
    if (agentBinaryKey(o, a) !== key) return false
    if (!b || typeof b.file !== 'string' || !FILE_PATTERN.test(b.file)) return false
    if (typeof b.sha256 !== 'string' || !SHA_PATTERN.test(b.sha256)) return false
    if (typeof b.size !== 'number' || !Number.isInteger(b.size) || b.size <= 0) return false
  }
  return true
}

let cache: { mtimeMs: number; manifest: AgentManifest } | null = null

/**
 * Current manifest, or null if none was built yet / it is invalid.
 * Re-read whenever the file changes (one stat per call).
 */
export async function readAgentManifest(): Promise<AgentManifest | null> {
  const path = join(agentDownloadsDir(), 'manifest.json')
  try {
    const st = await stat(path)
    if (cache && cache.mtimeMs === st.mtimeMs) return cache.manifest
    const parsed = JSON.parse(await readFile(path, 'utf8'))
    if (!isValidManifest(parsed)) {
      cache = null
      return null
    }
    cache = { mtimeMs: st.mtimeMs, manifest: parsed }
    return parsed
  } catch {
    cache = null
    return null
  }
}

/** Binary entry for os/arch from the current manifest. */
export async function getAgentBinary(
  os: string | null | undefined,
  arch: string | null | undefined
): Promise<{ manifest: AgentManifest; key: string; binary: AgentBinaryInfo } | null> {
  const key = agentBinaryKey(os, arch)
  if (!key) return null
  const manifest = await readAgentManifest()
  const binary = manifest?.binaries[key]
  if (!manifest || !binary) return null
  return { manifest, key, binary }
}
