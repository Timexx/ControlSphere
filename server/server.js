// Bridge entrypoint: runs the new TypeScript server (src/server.ts) via ts-node.
// This keeps backward compatibility with `node server.js` while we rely on TypeScript sources.

process.env.TS_NODE_TRANSPILE_ONLY = '1'
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'CommonJS',
  moduleResolution: 'node',
  esModuleInterop: true,
  resolveJsonModule: true,
  target: 'ES2020'
})

require('ts-node/register')
require('./src/server.ts')

// Legacy server code is retained for reference and can be re-enabled by setting USE_LEGACY_SERVER=1.
if (process.env.USE_LEGACY_SERVER === '1') {
const { createServer } = require('http')
const { URL } = require('url')
const next = require('next')
const { WebSocketServer } = require('ws')
const { PrismaClient } = require('@prisma/client')
const { jwtVerify } = require('jose')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { orchestrator } = require('./src/lib/orchestrator')
const { realtimeEvents } = require('./src/lib/realtime-events.js')
const TEXT_DECODER = new TextDecoder('utf-8', { fatal: false })

function normalizeOutputChunk(raw) {
  if (raw === null || raw === undefined) return ''
  if (typeof raw === 'string') return raw
  if (Buffer.isBuffer(raw)) {
    const text = TEXT_DECODER.decode(raw)
    const total = text.length || 1
    const printable = (text.match(/[\t\r\n\x20-\x7E]/g) || []).length
    const ratio = printable / total
    // Drop chunks that are mostly non-printable noise
    return ratio < 0.6 ? '' : text
  }
  try {
    return JSON.stringify(raw)
  } catch (e) {
    return String(raw)
  }
}

const dev = process.env.NODE_ENV !== 'production'
const hostname = 'localhost'
const port = 3000

// Auto-generate and save JWT_SECRET if missing or weak
function ensureJWTSecret() {
  const envPath = path.join(__dirname, '.env')
  let envContent = ''
  
  // Read existing .env file if it exists
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8')
  }
  
  const secret = process.env.JWT_SECRET
  const needsGeneration = !secret || secret.length < 32
  
  // Check for insecure patterns
  if (secret) {
    const insecurePatterns = ['change-me', 'secret', 'password', 'test', 'demo', '123456']
    const lowerSecret = secret.toLowerCase()
    for (const pattern of insecurePatterns) {
      if (lowerSecret.includes(pattern)) {
        console.warn(`⚠️  JWT_SECRET contains insecure pattern "${pattern}" - generating new secure secret`)
        return generateAndSaveSecret(envPath, envContent)
      }
    }
  }
  
  if (needsGeneration) {
    return generateAndSaveSecret(envPath, envContent)
  }
  
  console.log('✓ JWT_SECRET validated successfully')
  return secret
}

function generateAndSaveSecret(envPath, existingContent) {
  // Generate cryptographically secure random secret (64 bytes = base64 will be ~88 chars)
  const newSecret = crypto.randomBytes(64).toString('base64')
  
  console.log('🔐 Generating new JWT_SECRET...')
  
  // Update or add JWT_SECRET in .env content
  const lines = existingContent.split('\n')
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
    if (existingContent && !existingContent.endsWith('\n')) {
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

// JWT Secret for session verification - auto-generated if needed
const SECRET_KEY = ensureJWTSecret()
const key = new TextEncoder().encode(SECRET_KEY)

// Track the secret version to invalidate sessions on secret change
const SECRET_VERSION = Buffer.from(SECRET_KEY).toString('base64').slice(0, 8)

const app = next({ dev, hostname, port })
const handler = app.getRequestHandler()

// Use default datasource from schema to keep API and websocket paths aligned
const prisma = new PrismaClient({
  log: ['error', 'warn']
})
const machineConnections = new Map() // machineId -> WebSocket
const terminalSessions = new Map() // sessionId -> machineId mapping for tracking
const commandSessions = new Map() // commandId -> { machineId, timestamp }
const webClientSessions = new Map() // ws -> { userId, username } mapping for authenticated web clients

// Unified command dispatcher (used by UI and orchestrator)
function sendCommandToAgent(machineId, commandId, command) {
  const agentWs = machineConnections.get(machineId)
  if (!agentWs || agentWs.readyState !== 1) {
    return false
  }

  if (commandId) {
    commandSessions.set(commandId, {
      machineId,
      timestamp: Date.now()
    })
  }

  const message = {
    type: 'execute_command',
    data: {
      commandId,
      command
    }
  }

  agentWs.send(JSON.stringify(message))
  return true
}

// Send update command to agent (agent will download source and build locally)
function sendUpdateToAgent(machineId, commandId, serverUrl) {
  const agentWs = machineConnections.get(machineId)
  if (!agentWs || agentWs.readyState !== 1) {
    return false
  }

  if (commandId) {
    commandSessions.set(commandId, {
      machineId,
      timestamp: Date.now()
    })
  }

  const message = {
    type: 'update_agent',
    data: {
      commandId,
      serverUrl
    }
  }

  console.log(`🔄 Sending update command to agent ${machineId}:`, message)
  agentWs.send(JSON.stringify(message))
  return true
}

// Send scan trigger to agent for immediate security scan
function sendScanTriggerToAgent(machineId) {
  const agentWs = machineConnections.get(machineId)
  if (!agentWs || agentWs.readyState !== 1) {
    console.log(`⚠️ Cannot trigger scan: Agent ${machineId} not connected`)
    return false
  }

  const message = {
    type: 'trigger_scan',
    data: {}
  }

  console.log(`🔍 Triggering security scan for agent ${machineId}`)
  agentWs.send(JSON.stringify(message))
  return true
}

// Helper function to hash secret keys
function hashSecretKey(secretKey) {
  return crypto.createHash('sha256').update(secretKey).digest('hex')
}

// Helper function to verify secret key against hash
function verifySecretKey(secretKey, secretKeyHash) {
  const hash = hashSecretKey(secretKey)
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(secretKeyHash))
}

// Helper function to sanitize machine object - remove secretKey and secretKeyHash
function sanitizeMachine(machine) {
  if (!machine) return machine
  const { secretKey, secretKeyHash, ...safeMachine } = machine
  return safeMachine
}

// Helper function to decrypt and verify JWT session
async function verifySession(token) {
  try {
    // Decode URL-encoded token if necessary
    let decodedToken = token
    try {
      decodedToken = decodeURIComponent(token)
    } catch (e) {
      // If decoding fails, use original token
    }
    
    const { payload } = await jwtVerify(decodedToken, key, {
      algorithms: ['HS256'],
    })
    
    // Invalidate sessions created with a different secret
    if (payload.secretVersion !== SECRET_VERSION) {
      console.warn('⚠️  Session invalidated: JWT_SECRET has changed')
      return null
    }
    
    console.log('✅ Session payload:', payload)
    return payload
  } catch (error) {
    console.error('❌ Session verification failed:', error.message)
    console.error('Token (first 50 chars):', token.substring(0, 50))
    return null
  }
}

// Helper function to parse cookies from request headers
function parseCookies(cookieHeader) {
  const cookies = {}
  if (cookieHeader) {
    cookieHeader.split(';').forEach(cookie => {
      const parts = cookie.split('=')
      const name = parts[0].trim()
      const value = parts.slice(1).join('=').trim()
      cookies[name] = value
    })
  }
  return cookies
}

// Helper function to update ports asynchronously
async function updatePorts(machineId, ports) {
  try {
    for (const portData of ports) {
      await prisma.port.upsert({
        where: {
          machineId_port_proto: {
            machineId: machineId,
            port: portData.port,
            proto: portData.proto
          }
        },
        update: {
          service: portData.service,
          state: portData.state,
          lastSeen: new Date()
        },
        create: {
          machineId: machineId,
          port: portData.port,
          proto: portData.proto,
          service: portData.service,
          state: portData.state
        }
      })
    }

    // Delete old ports that weren't seen in this update
    const currentPorts = ports.map(p => ({ port: p.port, proto: p.proto }))
    await prisma.port.deleteMany({
      where: {
        machineId: machineId,
        NOT: {
          OR: currentPorts
        },
        lastSeen: {
          lt: new Date(Date.now() - 120000) // Not seen in last 2 minutes
        }
      }
    })
  } catch (error) {
    console.error('❌ Port update error (non-critical):', error.message)
  }
}

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    // CRITICAL: Check if this is a WebSocket upgrade request BEFORE calling Next.js handler
    // WebSocket upgrades have the 'upgrade' header and should NOT be processed by Next.js
    if (req.headers.upgrade === 'websocket') {
      // Do NOT call handler(req, res) for WebSocket requests
      // The 'upgrade' event will handle this
      console.log('🔄 Skipping Next.js handler for WebSocket upgrade:', req.url)
      return
    }
    
    try {
      await handler(req, res)
    } catch (err) {
      console.error('Error occurred handling', req.url, err)
      if (res && res.writeHead) {
        res.statusCode = 500
        res.end('internal server error')
      }
    }
  })

  // WebSocket Server for Agents
  // Create WebSocketServer without automatic server attachment
  const wss = new WebSocketServer({
    noServer: true,
    // Agents may stream arbitrary terminal bytes; skip strict UTF-8 validation to avoid disconnects
    skipUTF8Validation: true
  })

  // WebSocket Server for Web Clients
  const webClients = new Set()
  const wssWeb = new WebSocketServer({
    noServer: true
  })

  // Manual upgrade handling to ensure no compression
  server.on('upgrade', async (request, socket, head) => {
    const pathname = new URL(request.url, `http://${request.headers.host}`).pathname
    console.log('🔄 WebSocket upgrade request:', pathname)
    
    // Immediately handle WebSocket upgrades to prevent Next.js from processing them
    if (pathname === '/ws/agent') {
      // Handle WebSocket upgrade manually
      wss.handleUpgrade(request, socket, head, (ws) => {
        // Ensure no compression on this connection
        ws._sender._deflating = false
        ws._receiver._compressed = false
        
        wss.emit('connection', ws, request)
      })
    } else if (pathname === '/ws/web') {
      console.log('🌐 Authenticating web client connection...')
      
      // Parse cookies from the request
      const cookies = parseCookies(request.headers.cookie)
      const sessionToken = cookies['session']
      
      if (!sessionToken) {
        console.log('❌ No session token found - rejecting connection')
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }
      
      console.log('Session token found, verifying...')
      
      // Verify the session token
      const session = await verifySession(sessionToken)
      
      // Extract user data - handle both formats: session.userId or session.user.id
      const userId = session?.userId || session?.user?.id
      const username = session?.username || session?.user?.username
      
      if (!session || !userId) {
        console.log('❌ Invalid session token - rejecting connection')
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }
      
      console.log(`✅ Session verified for user: ${username} (${userId})`)
      
      // Upgrade the connection and pass session data
      wssWeb.handleUpgrade(request, socket, head, (ws) => {
        console.log('🌐 Web client upgrade successful')
        // Store session data with the WebSocket connection
        webClientSessions.set(ws, {
          userId: userId,
          username: username
        })
        wssWeb.emit('connection', ws, request)
      })
    } else if (pathname === '/_next/webpack-hmr') {
      // Allow Next.js hot-reload WebSocket
      console.log('🔥 Passing through Next.js HMR WebSocket')
      // Let Next.js handle HMR upgrades
      app.getUpgradeHandler()(request, socket, head)
    } else {
      console.log('❌ Unknown WebSocket path:', pathname)
      socket.destroy()
    }
  })

  wss.on('connection', (ws, req) => {
    console.log('Agent connected:', req.socket.remoteAddress)
    console.log('Headers:', req.headers)
    let machineId = null

    ws.on('message', async (data) => {
      // Parse agent payload defensively – ignore non-JSON frames (rare noise)
      let message
      const rawText =
        typeof data === 'string'
          ? data
          : Buffer.isBuffer(data)
            ? data.toString('utf8')
            : data?.toString?.() || ''

      // First, try to parse the entire message as JSON (most common case)
      try {
        message = JSON.parse(rawText)
        // Successfully parsed as single JSON - process it
        await processAgentMessage(message)
        return
      } catch (err) {
        // Not a single valid JSON - might be mixed content or raw output
      }

      // Check if this looks like truncated/partial JSON (starts with { but doesn't parse)
      // These are usually heartbeats that got mixed with command output
      const looksLikePartialJson = rawText.includes('{"type":"') && !rawText.trim().endsWith('}')
      
      if (looksLikePartialJson) {
        // Try to separate the JSON part from the output part
        // Pattern: either "output_text{json...}" or "{json_partial...output_text"
        
        // Find where JSON-like content starts
        const jsonStartIndex = rawText.indexOf('{"type":"')
        
        if (jsonStartIndex > 0) {
          // There's text before the JSON - that's likely command output
          const outputPart = rawText.slice(0, jsonStartIndex).trim()
          const jsonPart = rawText.slice(jsonStartIndex)
          
          // Send the output part as command output
          if (outputPart && machineId) {
            let latest = null
            for (const [cmdId, info] of commandSessions.entries()) {
              if (info.machineId === machineId) {
                if (!latest || info.timestamp > latest.timestamp) {
                  latest = { cmdId, timestamp: info.timestamp }
                }
              }
            }
            if (latest) {
              console.log(`📝 Extracted output before partial JSON: "${outputPart.slice(0, 80)}"`)
              const chunk = normalizeOutputChunk(outputPart)
              if (chunk) {
                broadcastToWebClients({
                  type: 'command_output',
                  machineId,
                  commandId: latest.cmdId,
                  output: chunk,
                  completed: false
                })
                await orchestrator.handleCommandOutput({
                  machineId,
                  commandId: latest.cmdId,
                  output: chunk,
                  completed: false
                })
              }
            }
          }
          
          // Try to parse the JSON part - if it fails, just ignore it (it's partial)
          try {
            message = JSON.parse(jsonPart)
            await processAgentMessage(message)
          } catch (e) {
            // Partial JSON - likely a heartbeat that got cut off, ignore it
            console.log(`⚠️ Ignoring partial JSON (likely truncated heartbeat): ${jsonPart.slice(0, 60)}...`)
          }
          return
        } else {
          // JSON starts at beginning but is truncated - just ignore this frame
          console.log(`⚠️ Ignoring truncated JSON frame: ${rawText.slice(0, 80)}...`)
          return
        }
      }

      // Not JSON at all - treat as raw command output
      if (!machineId) {
        console.warn('Ignoring non-JSON agent frame (no machineId):', rawText.slice(0, 120))
        return
      }

      let latest = null
      for (const [cmdId, info] of commandSessions.entries()) {
        if (info.machineId === machineId) {
          if (!latest || info.timestamp > latest.timestamp) {
            latest = { cmdId, timestamp: info.timestamp }
          }
        }
      }

      if (!latest) {
        // No active command - check if this looks like it might be JSON garbage
        if (rawText.includes('"type"') || rawText.includes('"data"')) {
          console.warn('Ignoring JSON-like garbage (no active command):', rawText.slice(0, 120))
          return
        }
        console.warn('Ignoring non-JSON agent frame (no active command):', rawText.slice(0, 120))
        return
      }

      // Filter out any content that looks like partial JSON messages
      let cleanOutput = rawText
      // Remove partial heartbeat JSON that might be mixed in
      cleanOutput = cleanOutput.replace(/\{"type":"heartbeat"[^}]*$/g, '')
      cleanOutput = cleanOutput.replace(/\{"type":"[^"]*"[^}]*$/g, '')
      
      const chunk = normalizeOutputChunk(cleanOutput)
      if (!chunk || chunk.trim().length === 0) return
      
      broadcastToWebClients({
        type: 'command_output',
        machineId,
        commandId: latest.cmdId,
        output: chunk,
        completed: false
      })
      await orchestrator.handleCommandOutput({
        machineId,
        commandId: latest.cmdId,
        output: chunk,
        completed: false
      })
    })

    // Helper function to process a valid agent message
    async function processAgentMessage(message) {
      try {
        // Log all agent messages for debugging
        if (message.type !== 'heartbeat') {
          console.log('📨 Agent message:', message.type, machineId || 'no-id')
        }
        
        // Registration - check for both old format and new format with type/data
        let regData = message
        if (message.type === 'register') {
          // message.data should be an object now, not a string
          regData = message.data
        }
        
        if (regData.hostname && regData.secretKey) {
          console.log('📝 Processing registration:', regData.hostname, 'IP:', regData.ip)
          
          // Validate secret key format
          if (!regData.secretKey || !/^[a-f0-9]{64}$/i.test(regData.secretKey)) {
            ws.send(JSON.stringify({ error: 'Invalid secret key format' }))
            ws.close()
            return
          }
          
          // Clean up IP address - use socket IP if agent sends "auto-detect" or invalid IP
          let cleanIP = regData.ip
          if (!cleanIP || cleanIP === 'auto-detect' || cleanIP.includes('::ffff:')) {
            cleanIP = req.socket.remoteAddress
          }
          // Remove IPv6 prefix if present
          if (cleanIP && cleanIP.startsWith('::ffff:')) {
            cleanIP = cleanIP.substring(7)
          }

          // Try to find machine by secretKey (old method) or secretKeyHash (new method)
          let machine = await prisma.machine.findFirst({
            where: {
              OR: [
                { secretKey: regData.secretKey },
                { secretKeyHash: hashSecretKey(regData.secretKey) }
              ]
            }
          })

          if (!machine) {
            // New machine registration - try to create with new schema (secretKeyHash) first
            try {
              machine = await prisma.machine.create({
                data: {
                  hostname: regData.hostname,
                  ip: cleanIP,
                  osInfo: JSON.stringify(regData.osInfo || {}),
                  secretKeyHash: hashSecretKey(regData.secretKey),
                  status: 'online'
                }
              })
            } catch (error) {
              // If secretKeyHash column doesn't exist, fall back to old schema (secretKey)
              console.log('⚠️  secretKeyHash not available, using legacy secretKey')
              machine = await prisma.machine.create({
                data: {
                  hostname: regData.hostname,
                  ip: cleanIP,
                  osInfo: JSON.stringify(regData.osInfo || {}),
                  secretKey: regData.secretKey,
                  status: 'online'
                }
              })
            }
            console.log(`✅ New machine registered: ${machine.hostname} (${machine.id}) IP: ${machine.ip}`)
            
            // Broadcast new machine to web clients (without secretKeyHash)
            broadcastToWebClients({
              type: 'new_machine',
              machine: sanitizeMachine(machine)
            })
          } else {
            machine = await prisma.machine.update({
              where: { id: machine.id },
              data: {
                hostname: regData.hostname,
                ip: cleanIP,
                osInfo: JSON.stringify(regData.osInfo || {}),
                status: 'online',
                lastSeen: new Date()
              }
            })
            console.log(`✅ Machine reconnected: ${machine.hostname} (${machine.id}) IP: ${machine.ip}`)
          }

          machineId = machine.id
          machineConnections.set(machineId, ws)
          
          ws.send(JSON.stringify({ 
            type: 'registered', 
            machineId: machine.id 
          }))
          
          // Broadcast to web clients
          broadcastToWebClients({ 
            type: 'machine_status_changed',
            machineId: machine.id,
            status: 'online'
          })
        }
        
        // Heartbeat with metrics - support both old format (message.metrics) and new format (type: heartbeat)
        else if ((message.metrics || message.type === 'heartbeat') && machineId) {
          let metrics = message.metrics
          let ports = []
          
          if (message.type === 'heartbeat') {
            const heartbeatData = message.data
            metrics = heartbeatData.metrics
            ports = heartbeatData.ports || []
          }
          
          if (metrics) {
            // Use separate, simpler operations with retries to avoid transaction locks
            try {
              // Update machine status and create metric without an explicit transaction to reduce contention
              await prisma.machine.update({
                where: { id: machineId },
                data: {
                  status: 'online',
                  lastSeen: new Date()
                }
              })

              await prisma.metric.create({
                data: {
                  machineId,
                  cpuUsage: metrics.cpuUsage || 0,
                  ramUsage: metrics.ramUsage || 0,
                  ramTotal: metrics.ramTotal || 0,
                  ramUsed: metrics.ramUsed || 0,
                  diskUsage: metrics.diskUsage || 0,
                  diskTotal: metrics.diskTotal || 0,
                  diskUsed: metrics.diskUsed || 0,
                  uptime: metrics.uptime || 0
                }
              })
              
              // Handle port updates separately and asynchronously to avoid blocking
              if (ports && ports.length > 0) {
                // Don't await this - let it run in background
                updatePorts(machineId, ports).catch(err => {
                  console.error('❌ Port update error (non-critical):', err.message)
                })
              }
            } catch (dbError) {
              console.error('❌ Database error for machine', machineId, ':', dbError.message)
              // Don't crash the connection on DB errors - just log and continue
              // The agent will retry on next heartbeat
            }
            
            // Broadcast to web clients with lastSeen
            broadcastToWebClients({
              type: 'machine_metrics',
              machineId,
              metrics: metrics,
              lastSeen: new Date().toISOString()
            })
          }
        }
        
        // Terminal output from agent - forward to web clients
        else if ((message.type === 'terminal_output' || message.type === 'terminal_data') && machineId) {
          console.log(`📺 Forwarding terminal data from ${machineId}`)
          
          // Parse data - it should be an object now
          let terminalData = message.data
          
          // Extract sessionId - handle both lowercase and uppercase
          let sessionId = terminalData.sessionId || terminalData.SessionID || message.sessionId
          
          // If still no sessionId, try to find it from our session mapping by machineId
          if (!sessionId) {
            // Find the first session for this machine
            for (const [sid, mid] of terminalSessions.entries()) {
              if (mid === machineId) {
                sessionId = sid
                break
              }
            }
          }
          
          const outgoingMessage = {
            type: 'terminal_data',
            machineId,
            sessionId: sessionId,
            // Handle both output and Output (Go uses capital)
            data: terminalData.output || terminalData.Output || terminalData.data || message.data
          }
          
          console.log(`📤 Terminal data to web:`, JSON.stringify(outgoingMessage, null, 2))
          broadcastToWebClients(outgoingMessage)
        }
        
        // Command output from agent
        else if (message.type === 'command_output' && machineId) {
          let commandId = message.commandId

          // Fallback: some agents may not send commandId - use last command for this machine
          if (!commandId) {
            let latest = null
            for (const [cmdId, info] of commandSessions.entries()) {
              if (info.machineId === machineId) {
                if (!latest || info.timestamp > latest.timestamp) {
                  latest = { cmdId, timestamp: info.timestamp }
                }
              }
            }
            commandId = latest?.cmdId
            if (commandId) {
              console.log(`🧭 Recovered missing commandId for ${machineId}: ${commandId}`)
            } else {
              console.log(`⚠️  Received command output without commandId for machine ${machineId}`)
            }
          }

          console.log(`📤 Forwarding command output from ${machineId} (completed: ${message.completed}, commandId: ${commandId})`)
          const rawOutput = message.output ?? message.Output ?? message.data ?? ''
          const outputChunk = normalizeOutputChunk(rawOutput)
          const payload = {
            type: 'command_output',
            machineId,
            commandId: commandId,
            output: outputChunk,
            exitCode: message.exitCode,
            completed: message.completed
          }
          
          broadcastToWebClients(payload)

          // Update orchestrator job execution mapping
          await orchestrator.handleCommandOutput({
            machineId,
            commandId,
            output: outputChunk,
            exitCode: message.exitCode,
            completed: Boolean(message.completed)
          })

          // Emit a completion event to clear UI state when finished
          if (message.completed) {
            if (commandId) {
              commandSessions.delete(commandId)
            }
            broadcastToWebClients({
              type: 'command_completed',
              machineId,
              commandId: commandId,
              exitCode: message.exitCode,
            })
          }
        }

        // Backwards compatibility: forward command_response as a completed command_output
        else if (message.type === 'command_response' && machineId) {
          let commandId = message.commandId

          if (!commandId) {
            let latest = null
            for (const [cmdId, info] of commandSessions.entries()) {
              if (info.machineId === machineId) {
                if (!latest || info.timestamp > latest.timestamp) {
                  latest = { cmdId, timestamp: info.timestamp }
                }
              }
            }
            commandId = latest?.cmdId
            if (commandId) {
              console.log(`🧭 Recovered missing legacy commandId for ${machineId}: ${commandId}`)
            } else {
              console.log(`⚠️  Legacy command_response without commandId for machine ${machineId}`)
            }
          }

          const normalizedExitCode = typeof message.exitCode === 'number'
            ? message.exitCode
            : 0
          const rawOutput = message.output ?? message.Output ?? message.data ?? ''
          const outputChunk = normalizeOutputChunk(rawOutput)

          console.log(`📤 Forwarding legacy command response from ${machineId}`)
          broadcastToWebClients({
            type: 'command_output',
            machineId,
            commandId: commandId,
            output: outputChunk,
            exitCode: normalizedExitCode,
            completed: true,
          })
          await orchestrator.handleCommandOutput({
            machineId,
            commandId,
            output: outputChunk,
            exitCode: normalizedExitCode,
            completed: true
          })
          if (commandId) {
            commandSessions.delete(commandId)
          }
          broadcastToWebClients({
            type: 'command_completed',
            machineId,
            commandId: commandId,
            exitCode: normalizedExitCode,
          })
        }
      } catch (error) {
        console.error('❌ Message processing error:', error)
      }
    } // end processAgentMessage

    ws.on('close', async () => {
      console.log('Agent disconnected. MachineId:', machineId || 'none')
      if (machineId) {
        machineConnections.delete(machineId)
        
        // Clean up any pending command mappings for this machine
        for (const [cmdId, info] of commandSessions.entries()) {
          if (info.machineId === machineId) {
            commandSessions.delete(cmdId)
          }
        }

        // Notify orchestrator to fail inflight executions for this machine
        try {
          await orchestrator.handleAgentDisconnect(machineId)
        } catch (err) {
          console.error('Orchestrator disconnect handling failed:', err)
        }

        try {
          await prisma.machine.update({
            where: { id: machineId },
            data: { status: 'offline' }
          })
          
          broadcastToWebClients({
            type: 'machine_status_changed',
            machineId,
            status: 'offline'
          })
        } catch (error) {
          console.error('Disconnect error:', error)
        }
      }
    })

    ws.on('error', (error) => {
      console.error('WebSocket error:', error)
    })
  })

  // Web Client event handlers
  wssWeb.on('connection', (ws) => {
    const sessionData = webClientSessions.get(ws)
    console.log(`✅ Web client connected: ${sessionData.username} (${sessionData.userId})`)
    webClients.add(ws)

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString())
        console.log('📱 Web client message:', JSON.stringify(message, null, 2))

        // Get session data for this connection
        const session = webClientSessions.get(ws)
        
        if (!session) {
          console.log('❌ No session data found - closing connection')
          ws.close(1008, 'Unauthorized')
          return
        }

        // Forward terminal messages to the appropriate agent
        if (message.type === 'spawn_terminal' || 
            message.type === 'terminal_input' || 
            message.type === 'terminal_resize' ||
            message.type === 'execute_command' ||
            message.type === 'update_agent' ||
            message.type === 'trigger_scan') {
          const { machineId, type, ...messageData } = message
          
          // Authorization: Verify machine exists (all authenticated users have access)
          try {
            const machine = await prisma.machine.findUnique({
              where: { id: machineId }
            })
            
            if (!machine) {
              console.log(`❌ Machine ${machineId} not found`)
              ws.send(JSON.stringify({
                type: 'error',
                message: 'Machine not found'
              }))
              return
            }
            
            console.log(`✅ User ${session.username} authorized for machine ${machineId}`)
          } catch (error) {
            console.error('❌ Authorization check failed:', error)
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Authorization check failed'
            }))
            return
          }
          
          const agentWs = machineConnections.get(machineId)
          
          if (agentWs && agentWs.readyState === 1) {
            console.log(`🔄 Forwarding ${type} to agent ${machineId}`)
            
            // Convert message format for agent
            let agentMessage
            if (type === 'spawn_terminal') {
              // Convert spawn_terminal to spawn_shell with proper format
              // Store session mapping for later use
              terminalSessions.set(messageData.sessionId, machineId)
              
              agentMessage = {
                type: 'spawn_shell',
                data: { sessionId: messageData.sessionId }
              }
            } else if (type === 'terminal_input') {
              // Convert terminal_input to terminal_stdin
              agentMessage = {
                type: 'terminal_stdin',
                data: { 
                  sessionId: messageData.sessionId,
                  data: messageData.data 
                }
              }
            } else if (type === 'terminal_resize') {
              agentMessage = {
                type: 'terminal_resize',
                data: {
                  sessionId: messageData.sessionId,
                  cols: messageData.cols,
                  rows: messageData.rows
                }
              }
            } else if (type === 'execute_command') {
              const sent = sendCommandToAgent(machineId, messageData.commandId, messageData.command)
              if (!sent) {
                ws.send(JSON.stringify({
                  type: 'error',
                  message: 'Agent not connected'
                }))
              }
              return
            } else if (type === 'update_agent') {
              // Get the server URL from the request or use default
              const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http'
              const serverUrl = messageData.serverUrl || `${protocol}://${hostname}:${port}`
              
              const sent = sendUpdateToAgent(machineId, messageData.commandId, serverUrl)
              if (!sent) {
                ws.send(JSON.stringify({
                  type: 'error',
                  message: 'Agent not connected'
                }))
              }
              return
            } else if (type === 'trigger_scan') {
              // Trigger immediate security scan on agent
              const sent = sendScanTriggerToAgent(machineId)
              if (sent) {
                ws.send(JSON.stringify({
                  type: 'scan_triggered',
                  machineId,
                  message: 'Security scan triggered on agent'
                }))
              } else {
                ws.send(JSON.stringify({
                  type: 'error',
                  message: 'Agent not connected - cannot trigger scan'
                }))
              }
              return
            }
            
            console.log(`📤 Sending to agent:`, JSON.stringify(agentMessage, null, 2))
            agentWs.send(JSON.stringify(agentMessage))
          } else {
            console.log(`❌ Agent not connected for machine ${machineId}`)
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Agent not connected'
            }))
          }
        }
      } catch (error) {
        console.error('❌ Web client message error:', error)
      }
    })

    ws.on('close', () => {
      const session = webClientSessions.get(ws)
      console.log(`👋 Web client disconnected: ${session?.username || 'unknown'}`)
      webClientSessions.delete(ws)
      webClients.delete(ws)
    })

    ws.on('error', (error) => {
      console.error('❌ Web client error:', error)
      webClientSessions.delete(ws)
      webClients.delete(ws)
    })
  })

  function broadcastToWebClients(data) {
    const message = JSON.stringify(data)
    // console.log(`📢 Broadcasting to ${webClients.size} web clients:`, data.type)
    let sentCount = 0
    webClients.forEach((client) => {
      if (client.readyState === 1) { // OPEN
        client.send(message)
        sentCount++
      }
    })
    // console.log(`📤 Sent to ${sentCount} clients`)
  }

  // Set up real-time event listeners for API route events
  realtimeEvents.on('security_event', (data) => {
    console.log(`🔔 Broadcasting security event for machine ${data.machineId}`)
    broadcastToWebClients({
      type: 'security_event',
      machineId: data.machineId,
      event: data.event
    })
  })

  realtimeEvents.on('audit_log', (data) => {
    console.log(`📝 Broadcasting audit log for machine ${data.machineId}`)
    broadcastToWebClients({
      type: 'audit_log',
      machineId: data.machineId,
      log: data.log
    })
  })

  realtimeEvents.on('scan_completed', (data) => {
    console.log(`✅ Broadcasting scan completed for machine ${data.machineId}`)
    broadcastToWebClients({
      type: 'scan_completed',
      machineId: data.machineId,
      scanId: data.scanId,
      summary: data.summary,
      timestamp: data.timestamp
    })
  })

  realtimeEvents.on('security_events_resolved', (data) => {
    console.log(`✅ Broadcasting security events resolved for machine ${data.machineId}`)
    broadcastToWebClients({
      type: 'security_events_resolved',
      machineId: data.machineId,
      resolvedCount: data.resolvedCount,
      timestamp: data.timestamp
    })
  })

  // Wire up orchestrator dispatchers for bulk jobs
  orchestrator.configure({
    sendCommand: (machineId, commandId, command) => sendCommandToAgent(machineId, commandId, command),
    isMachineOnline: (machineId) => {
      const ws = machineConnections.get(machineId)
      return Boolean(ws && ws.readyState === 1)
    },
    broadcast: (data) => broadcastToWebClients(data)
  })

  server.listen(port, (err) => {
    if (err) throw err
    console.log(`> Ready on http://${hostname}:${port}`)
    console.log(`> WebSocket server ready on ws://${hostname}:${port}/ws/agent`)
  })
})

}
