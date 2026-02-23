import { NextRequest, NextResponse } from 'next/server'
import { readFile, stat } from 'fs/promises'
import { join } from 'path'

export const dynamic = 'force-dynamic'

// Resolve binary name based on OS and architecture query parameters.
// Defaults to linux-amd64 for backward compatibility.
function resolveBinaryName(os: string | null, arch: string | null): { name: string; filename: string } {
  const normalizedOS = (os || 'linux').toLowerCase()
  const normalizedArch = (arch || 'amd64').toLowerCase()

  if (normalizedOS === 'windows') {
    const suffix = normalizedArch === 'arm64' ? 'windows-arm64' : 'windows-amd64'
    return {
      name: `maintainer-agent-${suffix}.exe`,
      filename: `maintainer-agent-${suffix}.exe`,
    }
  }

  // Linux / Darwin
  const suffix = normalizedArch === 'arm64' ? `${normalizedOS}-arm64` : `${normalizedOS}-amd64`
  return {
    name: `maintainer-agent-${suffix}`,
    filename: `maintainer-agent-${suffix}`,
  }
}

// GET /api/agent-download - Returns the agent binary for download
// Query params:
//   ?os=linux|windows  (default: linux)
//   ?arch=amd64|arm64  (default: amd64)
// This route is used by the agent's self-update mechanism and the install scripts.
// NOTE: This route was moved from /downloads/maintainer-agent to /api/agent-download
// because the static file public/downloads/maintainer-agent shadowed the route handler
// in Next.js, causing Windows clients to receive the Linux binary.
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const requestedOS = searchParams.get('os')
    const requestedArch = searchParams.get('arch')
    const { name: binaryName, filename } = resolveBinaryName(requestedOS, requestedArch)

    // Try multiple possible locations for the agent binary.
    // IMPORTANT: Only fall back to the generic "maintainer-agent" for Linux
    // requests — the generic binary is always a Linux copy and must never be
    // served to Windows clients.
    const isWindows = (requestedOS || '').toLowerCase() === 'windows'
    const possiblePaths = [
      join(process.cwd(), 'public', 'downloads', binaryName),
      join(process.cwd(), '..', 'agent', 'bin', binaryName),
      // Fallback: legacy name without OS/arch suffix (Linux only — the
      // generic binary is a copy of the Linux build)
      ...(!isWindows ? [
        join(process.cwd(), 'public', 'downloads', 'maintainer-agent'),
        join(process.cwd(), '..', 'agent', 'bin', 'maintainer-agent'),
      ] : []),
    ]

    let binaryPath: string | null = null
    let binaryStats = null

    for (const path of possiblePaths) {
      try {
        binaryStats = await stat(path)
        if (binaryStats.isFile()) {
          binaryPath = path
          break
        }
      } catch {
        continue
      }
    }

    if (!binaryPath) {
      return NextResponse.json({
        error: 'Agent binary not found',
        hint: 'Build the agent with: cd agent && go build -o bin/maintainer-agent',
        searchedPaths: possiblePaths
      }, { status: 404 })
    }

    console.log(`Serving agent binary from: ${binaryPath}`)
    const binary = await readFile(binaryPath)

    return new NextResponse(binary, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': binary.length.toString(),
        'Cache-Control': 'no-cache',
      },
    })
  } catch (error) {
    console.error('Failed to serve agent binary:', error)
    return NextResponse.json({ 
      error: 'Failed to serve agent binary',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
