'use client'

import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'

interface TerminalProps {
  machineId: string
  socket: WebSocket | null
  onClose: () => void
}

export default function Terminal({ machineId, socket, onClose }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<any>(null)
  const fitAddonRef = useRef<any>(null)
  const sessionIdRef = useRef<string | null>(null) // Will be set by server
  const [isReady, setIsReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hasSpawnedRef = useRef(false)

  useEffect(() => {
    if (!terminalRef.current || !socket) {
      console.log('⚠️ Terminal skipping init: terminalRef.current=', !!terminalRef.current, 'socket=', !!socket)
      return
    }

    console.log('🔧 Terminal initializing with socket:', { readyState: socket.readyState, machineId, sessionId: sessionIdRef.current })

    let cancelled = false

    // Dynamically import xterm only on client side
    const initTerminal = async () => {
      if (!terminalRef.current) return

      // Load xterm dynamically
      try {
        const { Terminal: XTerm } = await import('xterm')
        const { FitAddon } = await import('xterm-addon-fit')
        if (cancelled) return

        // Initialize xterm
        const term = new XTerm({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        theme: {
          background: '#0f161d',
          foreground: '#d4d4d4',
          cursor: '#ffffff',
          black: '#000000',
          red: '#cd3131',
          green: '#0dbc79',
          yellow: '#e5e510',
          blue: '#2472c8',
          magenta: '#bc3fbc',
          cyan: '#11a8cd',
          white: '#e5e5e5',
          brightBlack: '#666666',
          brightRed: '#f14c4c',
          brightGreen: '#23d18b',
          brightYellow: '#f5f543',
          brightBlue: '#3b8eea',
          brightMagenta: '#d670d6',
          brightCyan: '#29b8db',
          brightWhite: '#e5e5e5',
        },
      })

        const fitAddon = new FitAddon()
      term.loadAddon(fitAddon)
      
        try {
          term.open(terminalRef.current)
        } catch (error) {
          console.error('Terminal initialization error:', error)
          setError('Terminal konnte nicht initialisiert werden.')
          return
        }

        xtermRef.current = term
        fitAddonRef.current = fitAddon

        const fitTerminal = () => {
        const addon = fitAddonRef.current
        const terminal = xtermRef.current
        if (!addon || !terminal) return

        try {
          addon.fit()
          if (socket.readyState === WebSocket.OPEN && sessionIdRef.current) {
            socket.send(JSON.stringify({
              type: 'terminal_resize',
              machineId,
              sessionId: sessionIdRef.current,
              cols: terminal.cols,
              rows: terminal.rows,
            }))
          }
        } catch (error) {
          console.error('Fit error:', error)
        }
        }

        // Ensure correct sizing after mount and font load
        requestAnimationFrame(() => {
          setTimeout(fitTerminal, 50)
          setTimeout(fitTerminal, 200)
        })
        if (typeof document !== 'undefined' && 'fonts' in document) {
          // Refits once fonts are ready to get accurate character measurements
          // @ts-ignore document.fonts is not in TS DOM lib yet
          document.fonts?.ready?.then(() => fitTerminal()).catch(() => {})
        }

        // Send data to server
        term.onData((data) => {
        console.log('📝 Terminal input:', {
          socketReady: socket.readyState === WebSocket.OPEN,
          readyState: socket.readyState,
          sessionId: sessionIdRef.current,
          dataLength: data.length
        })
        if (socket.readyState === WebSocket.OPEN && sessionIdRef.current) {
          socket.send(JSON.stringify({
            type: 'terminal_input',
            machineId,
            sessionId: sessionIdRef.current,
            data: data,
          }))
          console.log('✅ Sent terminal_input')
        } else {
          if (!sessionIdRef.current) {
            console.warn('⚠️ No session ID yet, cannot send input')
          } else {
            console.warn('⚠️ Socket not ready, cannot send input', { readyState: socket.readyState })
          }
        }
      })

        // Handle resize
        const handleResize = () => fitTerminal()

        window.addEventListener('resize', handleResize)
        const resizeObserver = typeof ResizeObserver !== 'undefined'
          ? new ResizeObserver(() => fitTerminal())
          : null
        resizeObserver?.observe(terminalRef.current)

        // Receive data from server
        const handleMessage = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data)
          
          // Handle session creation response from server
          if (data.type === 'terminal_session_created') {
            console.log('✅ Session created by server:', data.sessionId)
            sessionIdRef.current = data.sessionId
            return
          }
          
          // Log terminal messages for debugging
          if (data.type === 'terminal_output' || data.type === 'terminal_data') {
            console.log('Terminal received:', {
              type: data.type,
              sessionId: data.sessionId,
              expectedSessionId: sessionIdRef.current,
              hasData: !!(data.output || data.data)
            })
          }
          
          // Accept both terminal_output and terminal_data
          if ((data.type === 'terminal_output' || data.type === 'terminal_data') && 
              data.sessionId === sessionIdRef.current) {
            const output = data.output || data.data
            if (output) {
              term.write(output)
            }
          }
          } catch (error) {
            console.error('Terminal message error:', error)
          }
        }

        socket.addEventListener('message', handleMessage)

        // Spawn shell on agent - only once
        const spawnShell = () => {
          if (socket.readyState === WebSocket.OPEN && !hasSpawnedRef.current) {
            hasSpawnedRef.current = true
            console.log('📤 Sending spawn_terminal:', { machineId })
            term.write('Connecting to remote terminal...\r\n')
            socket.send(JSON.stringify({
              type: 'spawn_terminal',
              machineId
            }))
          } else if (socket.readyState !== WebSocket.OPEN && !hasSpawnedRef.current) {
            console.warn('⚠️ Socket not ready yet, retrying...', { readyState: socket.readyState })
            setTimeout(spawnShell, 100)
          }
        }
        
        spawnShell()
      
        return () => {
          window.removeEventListener('resize', handleResize)
          resizeObserver?.disconnect()
          socket.removeEventListener('message', handleMessage)
          if (term) {
            term.dispose()
          }
        }
      } catch (e) {
        console.error('Terminal init error:', e)
        setError('Terminal konnte nicht geladen werden. Bitte laden Sie die Seite neu.')
      }
    }

    // Initialize terminal
    initTerminal()
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => {
      cancelled = true
    }
  }, [machineId, socket])

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-3 sm:p-6">
      <div className="rounded-xl border border-slate-800 bg-[#0d141b] shadow-lg w-[96vw] max-w-[1600px] h-[88vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <h3 className="text-lg font-semibold text-white">Remote Terminal</h3>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="h-5 w-5 text-slate-400 hover:text-white" />
          </button>
        </div>

        {/* Terminal */}
        <div className="flex-1 min-h-0 p-4 bg-[#0f161d]">
          {error ? (
            <div className="h-full w-full flex items-center justify-center text-red-200 text-sm">
              {error}
            </div>
          ) : (
            <div ref={terminalRef} className="h-full w-full" />
          )}
        </div>
      </div>
    </div>
  )
}
