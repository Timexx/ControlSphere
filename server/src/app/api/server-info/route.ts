import { NextResponse } from 'next/server'
import { networkInterfaces } from 'os'

export async function GET() {
  try {
    // Finde die lokale IP-Adresse
    const nets = networkInterfaces()
    let serverIp = 'localhost'
    
    for (const name of Object.keys(nets)) {
      const netInfo = nets[name]
      if (!netInfo) continue
      
      for (const net of netInfo) {
        // IPv4, nicht intern und nicht loopback
        const familyV4Value = typeof net.family === 'string' ? 'IPv4' : 4
        if (net.family === familyV4Value && !net.internal) {
          serverIp = net.address
          break
        }
      }
      if (serverIp !== 'localhost') break
    }

    return NextResponse.json({
      ip: serverIp,
      port: process.env.PORT || 3000,
      url: `http://${serverIp}:${process.env.PORT || 3000}`
    })
  } catch (error) {
    console.error('Failed to get server info:', error)
    return NextResponse.json({
      ip: 'localhost',
      port: 3000,
      url: 'http://localhost:3000'
    }, { status: 500 })
  }
}
