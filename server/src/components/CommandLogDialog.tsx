'use client'

import { useEffect, useRef, useState } from 'react'
import { X, CheckCircle, XCircle, Loader2 } from 'lucide-react'

interface CommandLogDialogProps {
  command: string
  onClose: () => void
  socket: WebSocket | null
  machineId: string
  commandId: string
}

export default function CommandLogDialog({
  command,
  onClose,
  socket,
  machineId,
  commandId
}: CommandLogDialogProps) {
  const [logs, setLogs] = useState<string>('')
  const [isRunning, setIsRunning] = useState(true)
  const [exitCode, setExitCode] = useState<number | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!socket) return
    
    // Check if this is an agent update command (calculated once)
    const cmd = command.toLowerCase().trim()
    const isAgentUpdate = cmd.includes('agent update') || cmd.includes('install-agent.sh')

    const handleMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data)
        
        const isCommandOutput = 
          (data.type === 'command_output' || data.type === 'command_response') &&
          data.machineId === machineId && 
          data.commandId === commandId
        const isCommandCompleted = 
          data.type === 'command_completed' &&
          data.machineId === machineId &&
          data.commandId === commandId
        
        // For agent updates, also listen for machine coming back online
        const isMachineOnline = 
          data.type === 'machine_status_changed' &&
          data.machineId === machineId &&
          data.status === 'online' &&
          isAgentUpdate
        
        if (isCommandOutput) {
          if (data.output) {
            setLogs(prev => prev + data.output)
          }
          
          if (data.completed || data.exitCode !== undefined) {
            setIsRunning(prev => data.completed ? false : prev)
            setExitCode(prev => data.exitCode ?? prev)
          }
        }

        if (isCommandCompleted) {
          setIsRunning(false)
          setExitCode(prev => data.exitCode ?? prev)
        }
        
        // Agent update: when machine comes back online, mark as completed
        if (isMachineOnline) {
          setLogs(prev => prev + '\n\n✅ Agent reconnected successfully!\n')
          setIsRunning(false)
          setExitCode(prev => prev ?? 0)
        }
      } catch (error) {
        console.error('Failed to parse message:', error)
      }
    }

    socket.addEventListener('message', handleMessage)
    
    return () => {
      socket.removeEventListener('message', handleMessage)
    }
  }, [socket, machineId, commandId, command])

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs])

  const getStatusColor = () => {
    if (isRunning) return 'text-cyan-300'
    if (exitCode === 0 || (exitCode === null && !isRunning)) return 'text-emerald-300'
    // Exit code -1 for reboot/shutdown/etc is expected
    if (exitCode === -1 && isSystemCommand()) return 'text-emerald-300'
    return 'text-red-400'
  }

  const getStatusIcon = () => {
    if (isRunning) return <Loader2 className="h-5 w-5 animate-spin" />
    if (exitCode === 0 || (exitCode === null && !isRunning)) return <CheckCircle className="h-5 w-5" />
    if (exitCode === -1 && isSystemCommand()) return <CheckCircle className="h-5 w-5" />
    return <XCircle className="h-5 w-5" />
  }

  const getStatusText = () => {
    if (isRunning) {
      if (isAgentUpdateCommand()) {
        return 'Agent Update läuft... (Warte auf Reconnect)'
      }
      return 'Wird ausgeführt...'
    }
    if (exitCode === 0) {
      if (isAgentUpdateCommand()) {
        return 'Agent Update erfolgreich!'
      }
      return 'Erfolgreich abgeschlossen'
    }
    if (exitCode === -1 && isSystemCommand()) {
      return 'System-Befehl ausgeführt (Verbindung unterbrochen)'
    }
    if (exitCode === null) return 'Abgeschlossen'
    return `Fehlgeschlagen (Exit Code: ${exitCode})`
  }

  const isSystemCommand = () => {
    const cmd = command.toLowerCase().trim()
    return cmd === 'reboot' || 
           cmd === 'shutdown' || 
           cmd.startsWith('reboot ') || 
           cmd.startsWith('shutdown ') ||
           cmd.includes('systemctl reboot') ||
           cmd.includes('systemctl poweroff') ||
           cmd.includes('init 6')
  }
  
  const isAgentUpdateCommand = () => {
    const cmd = command.toLowerCase().trim()
    return cmd.includes('agent update') || cmd.includes('install-agent.sh')
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="rounded-xl border border-slate-800 bg-[#0d141b] shadow-lg max-w-4xl w-full max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-800">
          <div>
            <h2 className="text-xl font-semibold text-white">Command Ausführung</h2>
            <p className="text-sm text-slate-400 font-mono mt-1">{command}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="h-5 w-5 text-slate-400 hover:text-white" />
          </button>
        </div>

        {/* Status */}
        <div className={`px-6 py-3 border-b border-slate-800 flex items-center space-x-2 ${getStatusColor()}`}>
          {getStatusIcon()}
          <span className="font-medium">{getStatusText()}</span>
        </div>

        {/* Logs */}
        <div 
          ref={logRef}
          className="flex-1 overflow-y-auto p-6 bg-[#0f161d] font-mono text-sm text-cyan-300"
          style={{ minHeight: '400px' }}
        >
          {logs ? (
            <pre className="whitespace-pre-wrap break-words">{logs}</pre>
          ) : (
            <div className="flex items-center justify-center h-full text-slate-500">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            disabled={isRunning}
            className="px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isRunning ? 'Läuft noch...' : 'Schließen'}
          </button>
        </div>
      </div>
    </div>
  )
}
