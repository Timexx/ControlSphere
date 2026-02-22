import { NextRequest, NextResponse } from 'next/server'
import { readFile, stat } from 'fs/promises'
import { join } from 'path'

export const dynamic = 'force-dynamic'

// GET /downloads/maintainer-agent - Returns the agent binary for download
// This route is used by the agent's self-update mechanism
export async function GET(request: NextRequest) {
  try {
    // Try multiple possible locations for the agent binary
    const possiblePaths = [
      join(process.cwd(), 'public', 'downloads', 'maintainer-agent'),
      join(process.cwd(), '..', 'agent', 'bin', 'maintainer-agent'),
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
        'Content-Disposition': 'attachment; filename="maintainer-agent"',
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
