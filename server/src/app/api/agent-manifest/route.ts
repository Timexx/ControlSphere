import { NextResponse } from 'next/server'
import { readAgentManifest } from '@/lib/agent-manifest'
import { getSession } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// GET /api/agent-manifest – current agent build (version only, for the
// "outdated" badge). Any logged-in user; checksums are not exposed here.
export async function GET() {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const manifest = await readAgentManifest()
  if (!manifest) {
    return NextResponse.json({ version: null, builtAt: null, platforms: [] })
  }
  return NextResponse.json(
    { version: manifest.version, builtAt: manifest.builtAt, platforms: Object.keys(manifest.binaries) },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
