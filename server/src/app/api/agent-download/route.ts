import { NextRequest, NextResponse } from 'next/server'
import { readFile, stat } from 'fs/promises'
import { join } from 'path'
import { agentBinaryKey, agentDownloadsDir, readAgentManifest } from '@/lib/agent-manifest'

export const dynamic = 'force-dynamic'

// GET /api/agent-download?os=linux|windows&arch=amd64|arm64
// Used by the agent self-update and the install scripts (no session: agents
// and fresh hosts have none; the binaries are not secret, integrity comes from
// the SHA-256 the agent receives in the HMAC-signed update_agent message).
//
// Only files listed in the build manifest are served. Without a manifest
// (agents never built with the new build script) the legacy file names are
// served so that first installations keep working.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const os = (searchParams.get('os') || 'linux').toLowerCase()
  const arch = (searchParams.get('arch') || 'amd64').toLowerCase()

  const key = agentBinaryKey(os, arch)
  if (!key) {
    return NextResponse.json({ error: 'Unsupported os/arch' }, { status: 400 })
  }

  const manifest = await readAgentManifest()
  const entry = manifest?.binaries[key]
  if (manifest && !entry) {
    return NextResponse.json({ error: `No agent build for ${key}` }, { status: 404 })
  }

  const filename = entry?.file ?? `maintainer-agent-${key}${os === 'windows' ? '.exe' : ''}`
  const path = join(agentDownloadsDir(), filename)

  try {
    const st = await stat(path)
    if (!st.isFile()) throw new Error('not a file')
    if (entry && st.size !== entry.size) {
      // Build in progress or inconsistent – never serve a binary that does not match the manifest
      return NextResponse.json({ error: 'Agent build is being updated, retry shortly' }, { status: 503 })
    }
    const binary = await readFile(path)

    const headers: Record<string, string> = {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': binary.length.toString(),
      'Cache-Control': 'no-store',
    }
    if (manifest && entry) {
      headers['X-Agent-Version'] = manifest.version
      headers['X-Agent-Sha256'] = entry.sha256
    }
    return new NextResponse(new Uint8Array(binary), { status: 200, headers })
  } catch {
    return NextResponse.json(
      { error: 'Agent binary not found', hint: 'Run server/scripts/build-agents-if-needed.sh on the server' },
      { status: 404 }
    )
  }
}
