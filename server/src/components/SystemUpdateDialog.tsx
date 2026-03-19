'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations, useLocale } from 'next-intl'
import {
  X,
  Download,
  Search,
  Shield,
  Package,
  Loader2,
  Lock,
  Eye,
  EyeOff,
  RefreshCw,
  Terminal as TerminalIcon,
  CheckCircle2,
  AlertTriangle,
  Info,
  ScanLine,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface VMPackage {
  id: string
  name: string
  version: string
  manager: string | null
  status: string
}

interface SystemUpdateDialogProps {
  machineId: string
  machineHostname: string
  socket: WebSocket | null
  lastScanAt: string | null
  onClose: () => void
}

function buildUpdateCommand(pkg: VMPackage): string {
  const mgr = (pkg.manager || 'apt').toLowerCase()
  switch (mgr) {
    case 'apt':
    case 'apt-get':
      return `sudo apt-get install --only-upgrade -y ${pkg.name}`
    case 'yum':
      return `sudo yum update -y ${pkg.name}`
    case 'dnf':
      return `sudo dnf upgrade -y ${pkg.name}`
    case 'apk':
      return `sudo apk add --upgrade ${pkg.name}`
    case 'pacman':
      return `sudo pacman -S --noconfirm ${pkg.name}`
    case 'winget':
      return `winget upgrade --id ${pkg.name} --silent`
    case 'choco':
    case 'chocolatey':
      return `choco upgrade ${pkg.name} -y`
    default:
      return `sudo apt-get install --only-upgrade -y ${pkg.name}`
  }
}

function buildUpdateAllCommand(pkgs: VMPackage[]): string {
  const managers = new Set(pkgs.map(p => (p.manager || 'apt').toLowerCase()))
  const cmds: string[] = []

  if (managers.has('apt') || managers.has('apt-get')) {
    cmds.push('sudo apt-get update && sudo apt-get upgrade -y')
  } else if (managers.has('dnf')) {
    cmds.push('sudo dnf upgrade -y')
  } else if (managers.has('yum')) {
    cmds.push('sudo yum update -y')
  } else if (managers.has('apk')) {
    cmds.push('sudo apk upgrade')
  } else if (managers.has('pacman')) {
    cmds.push('sudo pacman -Syu --noconfirm')
  } else if (managers.has('winget')) {
    cmds.push('winget upgrade --all --silent')
  } else {
    cmds.push('sudo apt-get update && sudo apt-get upgrade -y')
  }

  return cmds.join(' && ')
}

function StatusPill({ status }: { status: string }) {
  const t = useTranslations('machine.systemUpdateDialog')
  if (status === 'security_update') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-900/60 border border-rose-600/50 text-rose-200">
        <Shield className="h-2.5 w-2.5" />
        {t('statusSecurity')}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-900/60 border border-amber-600/50 text-amber-200">
      <Download className="h-2.5 w-2.5" />
      {t('statusUpdate')}
    </span>
  )
}

function ManagerPill({ manager }: { manager: string | null }) {
  if (!manager) return null
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 border border-slate-700 text-slate-400">
      {manager}
    </span>
  )
}

// ─── Password dialog ────────────────────────────────────────────────────────
function PasswordPrompt({
  onConfirm,
  onCancel,
  label,
}: {
  onConfirm: () => void
  onCancel: () => void
  label: string
}) {
  const t = useTranslations('machine.systemUpdateDialog.auth')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const handle = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [onCancel])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!password.trim()) { setError(t('errorEmpty')); return }
    setVerifying(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/verify-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (res.ok) {
        onConfirm()
      } else {
        const d = await res.json()
        setError(d.error || t('errorWrong'))
        setPassword('')
        inputRef.current?.focus()
      }
    } catch {
      setError(t('errorConnection'))
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div className="absolute inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-10 rounded-xl">
      <div className="w-full max-w-sm mx-4 rounded-xl border border-slate-700 bg-[#0d141b] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-gradient-to-r from-emerald-950/50 to-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
              <Download className="h-4 w-4 text-emerald-300" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">{t('title')}</h3>
              <p className="text-xs text-slate-400 truncate max-w-[200px]">{label}</p>
            </div>
          </div>
          <button onClick={onCancel} className="text-slate-400 hover:text-white p-1.5 rounded hover:bg-slate-800">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Lock className="h-4 w-4 text-slate-500" />
            </div>
            <input
              ref={inputRef}
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              disabled={verifying}
              placeholder={t('passwordPlaceholder')}
              className="w-full pl-10 pr-10 py-2.5 rounded-lg border border-slate-700 bg-slate-900/80 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 disabled:opacity-50"
              autoComplete="current-password"
            />
            <button
              type="button"
              onClick={() => setShowPw(!showPw)}
              className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-500 hover:text-slate-300"
            >
              {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {error && (
            <p className="text-xs text-red-300 flex items-center gap-1.5">
              <X className="h-3.5 w-3.5 flex-shrink-0" />
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={verifying}
              className="flex-1 py-2 rounded-lg border border-slate-700 text-sm text-slate-300 hover:bg-slate-800 hover:text-white transition-all disabled:opacity-50"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              disabled={verifying || !password.trim()}
              className="flex-1 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {verifying ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              {verifying ? t('confirming') : t('confirm')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Main Dialog ─────────────────────────────────────────────────────────────
export default function SystemUpdateDialog({
  machineId,
  machineHostname,
  socket,
  lastScanAt,
  onClose,
}: SystemUpdateDialogProps) {
  const t = useTranslations('machine.systemUpdateDialog')
  const locale = useLocale()
  const dateLocale = locale === 'de' ? 'de-DE' : 'en-GB'

  const [packages, setPackages] = useState<VMPackage[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [mounted, setMounted] = useState(false)

  // Auth
  const [showAuth, setShowAuth] = useState(false)
  const [authLabel, setAuthLabel] = useState('')
  const [pendingCommand, setPendingCommand] = useState<string | null>(null)

  // Terminal state
  const terminalContainerRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<any>(null)
  const fitAddonRef = useRef<any>(null)
  const sessionIdRef = useRef<string | null>(null)
  const hasSpawnedRef = useRef(false)
  const terminalInitialized = useRef(false)
  const promptTailRef = useRef<{ value: string }>({ value: '' })

  const [terminalStarted, setTerminalStarted] = useState(false)
  const [terminalReady, setTerminalReady] = useState(false)
  const [activePackage, setActivePackage] = useState<string | null>(null)
  const [scanToast, setScanToast] = useState(false)
  const activePackageRef = useRef<string | null>(null)

  // Keep ref in sync so the terminal message handler (closure) can read current value
  useEffect(() => {
    activePackageRef.current = activePackage
  }, [activePackage])

  useEffect(() => {
    setMounted(true)
    fetchPackages()
    return () => setMounted(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Close on Escape
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !showAuth) onClose()
    }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [onClose, showAuth])

  const fetchPackages = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/vms/${machineId}/packages`)
      const data = await res.json()
      const updatable = (data.packages || []).filter(
        (p: VMPackage) => p.status === 'update_available' || p.status === 'security_update'
      )
      // Sort: security_update first, then alphabetically
      updatable.sort((a: VMPackage, b: VMPackage) => {
        if (a.status === b.status) return a.name.localeCompare(b.name)
        return a.status === 'security_update' ? -1 : 1
      })
      setPackages(updatable)
    } catch (e) {
      console.error('Failed to fetch packages:', e)
    } finally {
      setLoading(false)
    }
  }

  // Initialize xterm.js terminal inline
  const initTerminal = useCallback(async () => {
    if (!terminalContainerRef.current || !socket || terminalInitialized.current) return
    terminalInitialized.current = true
    setTerminalStarted(true)

    try {
      const { Terminal: XTerm } = await import('xterm')
      const { FitAddon } = await import('xterm-addon-fit')

      const term = new XTerm({
        cursorBlink: true,
        cursorStyle: 'block',
        fontSize: 13,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        scrollback: 10000,
        allowProposedApi: true,
        theme: {
          background: '#0a1018',
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
      term.open(terminalContainerRef.current)
      xtermRef.current = term
      fitAddonRef.current = fitAddon

      const fit = () => {
        try {
          fitAddon.fit()
          if (socket.readyState === WebSocket.OPEN && sessionIdRef.current) {
            socket.send(JSON.stringify({
              type: 'terminal_resize',
              machineId,
              sessionId: sessionIdRef.current,
              cols: term.cols,
              rows: term.rows,
            }))
          }
        } catch {}
      }

      requestAnimationFrame(() => { setTimeout(fit, 50); setTimeout(fit, 300) })
      const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null
      ro?.observe(terminalContainerRef.current)
      window.addEventListener('resize', fit)

      // Send keyboard input to PTY
      term.onData((data) => {
        if (socket.readyState === WebSocket.OPEN && sessionIdRef.current) {
          socket.send(JSON.stringify({
            type: 'terminal_input',
            machineId,
            sessionId: sessionIdRef.current,
            data,
          }))
        }
      })
      term.onBinary((data) => {
        if (socket.readyState === WebSocket.OPEN && sessionIdRef.current) {
          socket.send(JSON.stringify({
            type: 'terminal_input',
            machineId,
            sessionId: sessionIdRef.current,
            data,
          }))
        }
      })

      // Detect shell prompt in raw terminal output to clear the active-package badge.
      // Strip ANSI escape codes, then check if the tail ends with a typical prompt char.
      const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[()][AB012]/g
      const detectPrompt = (raw: string) => {
        const clean = raw.replace(ANSI_RE, '')
        promptTailRef.current.value = (promptTailRef.current.value + clean).slice(-80)
        // Match a shell prompt: ends with "$ ", "# ", "> " (with optional trailing spaces/CR)
        return /[#$>]\s{0,4}$/.test(promptTailRef.current.value)
      }

      // Handle incoming messages
      const handleMessage = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data)

          if (msg.type === 'terminal_session_created') {
            sessionIdRef.current = msg.sessionId
            setTerminalReady(true)
            return
          }

          if (
            (msg.type === 'terminal_output' || msg.type === 'terminal_data') &&
            msg.sessionId === sessionIdRef.current
          ) {
            const out = msg.output || msg.data
            if (out) {
              term.write(out)
              // If a command was running and the shell prompt reappears, mark it done
              if (activePackageRef.current && detectPrompt(out)) {
                setActivePackage(null)
              }
            }
          }
        } catch {}
      }
      socket.addEventListener('message', handleMessage)

      // Spawn the shell
      const spawnShell = () => {
        if (socket.readyState === WebSocket.OPEN && !hasSpawnedRef.current) {
          hasSpawnedRef.current = true
          term.write(t('terminalConnectingMsg') + '\r\n')
          socket.send(JSON.stringify({ type: 'spawn_terminal', machineId }))
        } else if (socket.readyState !== WebSocket.OPEN && !hasSpawnedRef.current) {
          setTimeout(spawnShell, 100)
        }
      }
      spawnShell()

      return () => {
        window.removeEventListener('resize', fit)
        ro?.disconnect()
        socket.removeEventListener('message', handleMessage)
        term.dispose()
      }
    } catch (e) {
      console.error('Terminal init error:', e)
      terminalInitialized.current = false
    }
  }, [socket, machineId, t])

  // Run command in PTY after session is ready
  const runInTerminal = useCallback((command: string, pkgLabel: string) => {
    setActivePackage(pkgLabel)
    activePackageRef.current = pkgLabel
    // Reset the prompt-detection buffer so the previous prompt doesn't immediately clear the badge
    promptTailRef.current.value = ''
    if (!sessionIdRef.current || !socket || socket.readyState !== WebSocket.OPEN) return
    socket.send(JSON.stringify({
      type: 'terminal_input',
      machineId,
      sessionId: sessionIdRef.current,
      data: command + '\r',
    }))
    // Focus terminal so user can interact
    xtermRef.current?.focus()
  }, [socket, machineId])

  const triggerScan = useCallback(() => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    socket.send(JSON.stringify({ type: 'trigger_scan', machineId }))
    setScanToast(true)
    setTimeout(() => setScanToast(false), 8000)
  }, [socket, machineId])

  const queuedCommandRef = useRef<{ command: string; label: string } | null>(null)

  // When terminal becomes ready, run any queued command
  useEffect(() => {
    if (terminalReady && queuedCommandRef.current) {
      const { command, label } = queuedCommandRef.current
      queuedCommandRef.current = null
      runInTerminal(command, label)
    }
  }, [terminalReady, runInTerminal])

  const triggerUpdate = (command: string, label: string) => {
    setAuthLabel(label)
    setPendingCommand(command)
    // Store label for after spawn
    queuedCommandRef.current = { command, label }
    setShowAuth(true)
  }

  const onAuthConfirm = () => {
    setShowAuth(false)
    if (!pendingCommand) return
    const command = pendingCommand
    const label = authLabel
    setPendingCommand(null)

    if (!terminalStarted) {
      // Init terminal first; command will run via queuedCommandRef after ready
      queuedCommandRef.current = { command, label }
      initTerminal()
    } else if (terminalReady) {
      queuedCommandRef.current = null
      runInTerminal(command, label)
    }
    // else: terminal started but not yet ready → queuedCommandRef already set above
  }

  const filteredPackages = packages.filter(pkg =>
    !searchQuery ||
    pkg.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (pkg.manager || '').toLowerCase().includes(searchQuery.toLowerCase())
  )

  const securityCount = packages.filter(p => p.status === 'security_update').length
  const updateCount = packages.filter(p => p.status === 'update_available').length

  if (!mounted) return null

  const content = (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5"
      style={{ zIndex: 99998 }}
    >
      <div className="relative rounded-xl border border-slate-700/80 bg-[#0d141b] shadow-2xl w-full max-w-[1400px] h-[90vh] flex flex-col overflow-hidden">
        {/* Password overlay */}
        {showAuth && (
          <PasswordPrompt
            label={authLabel}
            onConfirm={onAuthConfirm}
            onCancel={() => {
              setShowAuth(false)
              setPendingCommand(null)
              queuedCommandRef.current = null
            }}
          />
        )}

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-gradient-to-r from-emerald-950/30 to-slate-900/30 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
              <Download className="h-5 w-5 text-emerald-300" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">System Update</h2>
              <p className="text-xs text-slate-400">{machineHostname}</p>
            </div>
            {/* Summary badges */}
            <div className="flex items-center gap-2 ml-2">
              {securityCount > 0 && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-900/50 border border-rose-600/40 text-rose-200 text-xs font-semibold">
                  <Shield className="h-3 w-3" />
                  {securityCount} Security
                </span>
              )}
              {updateCount > 0 && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-900/50 border border-amber-600/40 text-amber-200 text-xs font-semibold">
                  <Package className="h-3 w-3" />
                  {updateCount} Updates
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {packages.length > 0 && (
              <button
                onClick={() => triggerUpdate(
                  buildUpdateAllCommand(packages),
                  t('updateAllLabel', { count: packages.length })
                )}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-500 transition-all border border-emerald-500/50"
              >
                <Download className="h-4 w-4" />
                {t('updateAllBtn', { count: packages.length })}
              </button>
            )}
            <button
              onClick={fetchPackages}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              title={t('refreshList')}
            >
              <RefreshCw className="h-4 w-4" />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Split body */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* ── Left panel: Package list ──────────────────────────────── */}
          <div className="w-[42%] flex flex-col border-r border-slate-800 min-h-0">
            {/* Search */}
            <div className="px-4 py-3 border-b border-slate-800 flex-shrink-0">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder={t('searchPlaceholder')}
                  className="w-full pl-9 pr-4 py-2 rounded-lg border border-slate-700 bg-slate-900/60 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
                />
              </div>
              <p className="mt-1.5 text-[11px] text-slate-500">
                {filteredPackages.length < packages.length
                  ? t('packageCountFiltered', { filtered: filteredPackages.length, total: packages.length })
                  : t('packageCount', { total: packages.length })}
              </p>
            </div>

            {/* Package list */}
            <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
              {loading ? (
                <div className="flex items-center justify-center h-32 text-slate-500">
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  <span className="text-sm">{t('loading')}</span>
                </div>
              ) : filteredPackages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 gap-2 text-slate-500">
                  <CheckCircle2 className="h-8 w-8 text-emerald-500/50" />
                  <p className="text-sm">
                    {packages.length === 0 ? t('noUpdates') : t('noResults')}
                  </p>
                </div>
              ) : (
                filteredPackages.map(pkg => (
                  <div
                    key={pkg.id}
                    className={cn(
                      'rounded-lg border p-3 transition-colors',
                      activePackage === pkg.name
                        ? 'border-emerald-500/50 bg-emerald-950/20'
                        : 'border-slate-800 bg-[#0c121a]/80 hover:border-slate-700'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-sm font-medium text-white truncate">{pkg.name}</p>
                          <StatusPill status={pkg.status} />
                        </div>
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className="text-xs text-slate-500 font-mono">{pkg.version}</span>
                          <ManagerPill manager={pkg.manager} />
                        </div>
                      </div>
                      <button
                        onClick={() => triggerUpdate(
                          buildUpdateCommand(pkg),
                          pkg.name
                        )}
                        disabled={activePackage === pkg.name}
                        className={cn(
                          'flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border',
                          activePackage === pkg.name
                            ? 'bg-emerald-800/50 border-emerald-600/50 text-emerald-300 cursor-default'
                            : 'bg-emerald-700/20 border-emerald-600/40 text-emerald-300 hover:bg-emerald-600/30 hover:border-emerald-500/60'
                        )}
                      >
                        {activePackage === pkg.name ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Download className="h-3 w-3" />
                        )}
                        {t('updateBtn')}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Info: data freshness */}
            <div className="px-3 py-2.5 border-t border-slate-800 flex-shrink-0 bg-[#0a1018]/60">
              <div className="flex items-start gap-2">
                <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-slate-600" />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-slate-500">
                    {t('infoText')}
                  </p>
                  {lastScanAt && (
                    <p className="text-[11px] text-slate-600 mt-0.5">
                      {t('lastScan')}{' '}
                      <span className="font-mono text-slate-500">
                        {new Date(lastScanAt).toLocaleString(dateLocale, {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </p>
                  )}
                </div>
                <button
                  onClick={triggerScan}
                  disabled={!socket || socket.readyState !== WebSocket.OPEN}
                  className="flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border border-slate-700 bg-slate-800/60 text-slate-300 hover:border-cyan-600/50 hover:bg-cyan-900/20 hover:text-cyan-300 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  title={t('scanNowTitle')}
                >
                  <ScanLine className="h-3 w-3" />
                  {t('scanNowBtn')}
                </button>
              </div>
            </div>
          </div>

          {/* ── Right panel: Terminal ─────────────────────────────────── */}
          <div className="flex-1 flex flex-col min-h-0 bg-[#0a1018]">
            {/* Terminal header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800 flex-shrink-0 bg-[#0d141b]">
              <div className="flex items-center gap-2">
                <TerminalIcon className="h-4 w-4 text-emerald-400" />
                <span className="text-sm font-medium text-slate-300">{t('terminalTitle')}</span>
                {terminalReady && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    {t('terminalConnected')}
                  </span>
                )}
                {terminalStarted && !terminalReady && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-amber-400">
                    <Loader2 className="h-2.5 w-2.5 animate-spin" />
                    {t('terminalConnecting')}
                  </span>
                )}
              </div>
              {activePackage && (
                <div className="flex items-center gap-1.5 text-xs text-emerald-300 bg-emerald-900/30 border border-emerald-600/30 px-2 py-1 rounded-full">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {activePackage === 'all' ? t('terminalActiveAll') : activePackage}
                </div>
              )}
            </div>

            {/* Terminal area */}
            <div className="flex-1 min-h-0 relative">
              {!terminalStarted ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-slate-600 bg-[#0a1018]">
                  <div className="h-16 w-16 rounded-2xl bg-slate-800/50 border border-slate-700/50 flex items-center justify-center">
                    <TerminalIcon className="h-8 w-8 text-slate-500" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm text-slate-400 font-medium">{t('terminalPlaceholderTitle')}</p>
                    <p className="text-xs text-slate-600 mt-1">
                      {t('terminalPlaceholderHint')}
                    </p>
                  </div>
                  {packages.length > 0 && (
                    <button
                      onClick={() => triggerUpdate(
                        buildUpdateAllCommand(packages),
                        t('terminalActiveAll')
                      )}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-700/20 border border-emerald-600/40 text-emerald-300 text-sm hover:bg-emerald-600/30 transition-all"
                    >
                      <Download className="h-4 w-4" />
                      {t('terminalUpdateAllBtn', { count: packages.length })}
                    </button>
                  )}
                </div>
              ) : null}
              <div
                ref={terminalContainerRef}
                className="absolute inset-0 p-2"
                style={{ display: terminalStarted ? 'block' : 'none' }}
              />
            </div>

            {/* Terminal hint */}
            {terminalReady && (
              <div className="px-4 py-2 border-t border-slate-800 flex-shrink-0 bg-[#0d141b]">
                <div className="flex items-center gap-2 text-[11px] text-slate-600">
                  <AlertTriangle className="h-3 w-3 text-amber-600/60" />
                  <span>{t('terminalInteractive')}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )

  const toast = scanToast ? createPortal(
    <div
      className={cn(
        'fixed top-5 right-5 z-[99999] flex items-start gap-3 px-4 py-3 rounded-xl border shadow-2xl',
        'bg-[#0d1f17] border-emerald-600/50 text-white',
        'animate-in slide-in-from-top-2 fade-in duration-300',
      )}
      style={{ maxWidth: 340 }}
    >
      <div className="h-8 w-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center flex-shrink-0 mt-0.5">
        <ScanLine className="h-4 w-4 text-emerald-300" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-emerald-100">{t('toastTitle')}</p>
        <p className="text-xs text-slate-400 mt-0.5">
          {t('toastDesc')}
        </p>
        {/* progress bar shrinking over 8s */}
        <div className="mt-2 h-0.5 w-full rounded-full bg-slate-700 overflow-hidden">
          <div
            className="h-full bg-emerald-500 rounded-full origin-left"
            style={{ animation: 'shrink-width 8s linear forwards' }}
          />
        </div>
      </div>
      <button
        onClick={() => setScanToast(false)}
        className="text-slate-500 hover:text-slate-300 transition-colors flex-shrink-0 mt-0.5"
      >
        <X className="h-4 w-4" />
      </button>
      <style>{`
        @keyframes shrink-width {
          from { width: 100%; }
          to   { width: 0%; }
        }
      `}</style>
    </div>,
    document.body
  ) : null

  return (
    <>
      {createPortal(content, document.body)}
      {toast}
    </>
  )
}
