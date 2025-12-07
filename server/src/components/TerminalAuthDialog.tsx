'use client'

import { useState, useRef, useEffect } from 'react'
import { X, Terminal, Lock, Eye, EyeOff, ShieldCheck } from 'lucide-react'

interface TerminalAuthDialogProps {
  machineName: string
  onConfirm: () => void
  onCancel: () => void
}

export default function TerminalAuthDialog({ 
  machineName,
  onConfirm, 
  onCancel 
}: TerminalAuthDialogProps) {
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Focus password input when dialog opens
    inputRef.current?.focus()
  }, [])

  // Handle Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onCancel])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!password.trim()) {
      setError('Bitte geben Sie Ihr Passwort ein')
      return
    }

    setVerifying(true)
    setError(null)

    try {
      // Verifiziere Passwort über die API
      const res = await fetch('/api/auth/verify-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      })

      if (res.ok) {
        onConfirm()
      } else {
        const data = await res.json()
        setError(data.error || 'Falsches Passwort')
        setPassword('')
        inputRef.current?.focus()
      }
    } catch (err) {
      setError('Verbindungsfehler. Bitte versuchen Sie es erneut.')
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="relative max-w-md w-full rounded-xl border border-slate-700 bg-[#0d141b] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-gradient-to-r from-cyan-950/50 to-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center">
              <Terminal className="h-5 w-5 text-cyan-300" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">Terminal-Zugang</h3>
              <p className="text-xs text-slate-400">{machineName}</p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="text-slate-400 hover:text-white transition-colors p-2 rounded-lg hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Security Notice */}
          <div className="flex items-start gap-3 p-4 rounded-lg border border-cyan-500/30 bg-cyan-950/20">
            <ShieldCheck className="h-5 w-5 text-cyan-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="text-cyan-100 font-medium mb-1">Sicherheitsbestätigung erforderlich</p>
              <p className="text-slate-400">
                Das Terminal ermöglicht vollständigen Shell-Zugriff auf die Maschine. 
                Bitte bestätigen Sie Ihre Identität mit Ihrem Passwort.
              </p>
            </div>
          </div>

          {/* Password Input */}
          <div className="space-y-2">
            <label htmlFor="terminal-password" className="block text-sm font-medium text-slate-300">
              Passwort
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Lock className="h-5 w-5 text-slate-500" />
              </div>
              <input
                ref={inputRef}
                id="terminal-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={verifying}
                placeholder="Ihr Passwort eingeben"
                className="w-full pl-10 pr-12 py-3 rounded-lg border border-slate-700 bg-slate-900/80 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 disabled:opacity-50 transition-all"
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-500 hover:text-slate-300 transition-colors"
              >
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="p-3 rounded-lg border border-red-500/40 bg-red-950/30 text-red-200 text-sm flex items-center gap-2">
              <X className="h-4 w-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={verifying}
              className="flex-1 px-4 py-3 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white transition-all disabled:opacity-50"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={verifying || !password.trim()}
              className="flex-1 px-4 py-3 rounded-lg bg-cyan-600 text-white font-medium hover:bg-cyan-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {verifying ? (
                <>
                  <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Prüfe...</span>
                </>
              ) : (
                <>
                  <Terminal className="h-4 w-4" />
                  <span>Terminal öffnen</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
