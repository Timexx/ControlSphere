import { NextResponse } from 'next/server'
import { networkInterfaces } from 'os'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

function detectLocalIp(): string {
  const nets = networkInterfaces()
  let serverIp = 'localhost'
  for (const name of Object.keys(nets)) {
    const netInfo = nets[name]
    if (!netInfo) continue
    for (const net of netInfo) {
      const familyV4Value = typeof net.family === 'string' ? 'IPv4' : 4
      if (net.family === familyV4Value && !net.internal) {
        serverIp = net.address
        break
      }
    }
    if (serverIp !== 'localhost') break
  }
  return serverIp
}

export async function GET() {
  try {
    // 1. Prefer the admin-configured URL stored in the DB
    const config = await prisma.serverConfig.findUnique({ where: { id: 'global' } })
    if (config?.serverUrl) {
      const url = new URL(config.serverUrl)
      return NextResponse.json({
        ip: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        url: config.serverUrl,
      })
    }

    // 2. Fallback: auto-detect from network interfaces
    const serverIp = detectLocalIp()
    const port = process.env.PORT || 3000
    return NextResponse.json({
      ip: serverIp,
      port,
      url: `http://${serverIp}:${port}`,
    })
  } catch (error) {
    console.error('Failed to get server info:', error)
    return NextResponse.json({ ip: 'localhost', port: 3000, url: 'http://localhost:3000' }, { status: 500 })
  }
}
