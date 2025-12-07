'use client'

import { useState, useRef, useEffect } from 'react'
import { X, AlertTriangle, Lock, Eye, EyeOff } from 'lucide-react'

// Liste kritischer Befehle die Passwort-Bestätigung erfordern
export const CRITICAL_COMMANDS = [
  // System
  'reboot',
  'shutdown',
  'poweroff',
  'halt',
  'init 0',
  'init 6',
  'systemctl reboot',
  'systemctl poweroff',
  'systemctl halt',
  // Destruktive Befehle
  'rm -rf',
  'rm -fr',
  'mkfs',
  'dd if=',
  'wipefs',
  'shred',
  '> /dev/',
  'chmod -R 000',
  'chmod -R 777',
  'chown -R',
  // Service Management (kritisch)
  'systemctl disable',
  'systemctl mask',
  // Netzwerk
  'iptables -F',
  'iptables --flush',
  'ufw disable',
  'firewall-cmd --panic-on',
  // Paket Management (potentiell gefährlich)
  'apt purge',
  'apt remove --purge',
  'apt autoremove --purge',
  'yum remove',
  'dnf remove',
  // User Management
  'userdel',
  'passwd root',
  'usermod -L root',
]

// Prüft ob ein Befehl kritisch ist
export function isCriticalCommand(command: string): boolean {
  const lowerCmd = command.toLowerCase().trim()
  
  // Spezielle Patterns die genauer geprüft werden müssen
  const exactMatches = ['reboot', 'shutdown', 'poweroff', 'halt', 'init 0', 'init 6']
  const prefixMatches = [
    'rm -rf', 'rm -fr', 'rm -r ', 'rm -r;', 'rm --recursive',
    'rm -Rf', 'rm -fR', 'rm -R ',
    'mkfs', 'dd if=', 'wipefs', 'shred',
    '> /dev/', 'chmod -R 000', 'chmod -R 777', 'chown -R',
    'systemctl reboot', 'systemctl poweroff', 'systemctl halt',
    'systemctl disable', 'systemctl mask',
    'iptables -F', 'iptables --flush', 'ufw disable',
    'firewall-cmd --panic-on',
    'apt purge', 'apt remove --purge', 'apt autoremove --purge',
    'yum remove', 'dnf remove',
    'userdel', 'passwd root', 'usermod -L root'
  ]
  
  // Exakte Übereinstimmung oder Befehl gefolgt von Leerzeichen/Semikolon
  for (const exact of exactMatches) {
    if (lowerCmd === exact || 
        lowerCmd.startsWith(exact + ' ') || 
        lowerCmd.startsWith(exact + ';') ||
        lowerCmd.includes(' ' + exact + ' ') ||
        lowerCmd.includes(';' + exact + ' ') ||
        lowerCmd.includes('&&' + exact) ||
        lowerCmd.includes('&& ' + exact) ||
        lowerCmd.includes('||' + exact) ||
        lowerCmd.includes('|| ' + exact) ||
        lowerCmd.endsWith(' ' + exact) ||
        lowerCmd.endsWith(';' + exact)) {
      return true
    }
  }
  
  // Prefix-Matches: Befehl muss am Anfang stehen oder nach Separator
  for (const prefix of prefixMatches) {
    if (lowerCmd.startsWith(prefix) ||
        lowerCmd.includes(' ' + prefix) ||
        lowerCmd.includes(';' + prefix) ||
        lowerCmd.includes('&&' + prefix) ||
        lowerCmd.includes('&& ' + prefix) ||
        lowerCmd.includes('||' + prefix) ||
        lowerCmd.includes('|| ' + prefix)) {
      return true
    }
  }
  
  return false
}

// Gibt den Grund zurück, warum ein Befehl kritisch ist
export function getCriticalReason(command: string): string {
  const lowerCmd = command.toLowerCase().trim()
  
  if (lowerCmd.includes('reboot') || lowerCmd.includes('shutdown') || 
      lowerCmd.includes('poweroff') || lowerCmd.includes('halt') ||
      lowerCmd.includes('init 0') || lowerCmd.includes('init 6')) {
    return 'System-Neustart/Herunterfahren'
  }
  if (lowerCmd.includes('rm -rf') || lowerCmd.includes('rm -fr')) {
    return 'Rekursives Löschen'
  }
  if (lowerCmd.includes('mkfs') || lowerCmd.includes('wipefs') || lowerCmd.includes('shred')) {
    return 'Dateisystem-Löschung'
  }
  if (lowerCmd.includes('dd if=')) {
    return 'Low-Level Disk Operation'
  }
  if (lowerCmd.includes('iptables') || lowerCmd.includes('ufw') || lowerCmd.includes('firewall')) {
    return 'Firewall-Änderung'
  }
  if (lowerCmd.includes('chmod') || lowerCmd.includes('chown')) {
    return 'Berechtigungsänderung'
  }
  if (lowerCmd.includes('userdel') || lowerCmd.includes('passwd root') || lowerCmd.includes('usermod')) {
    return 'User-Management'
  }
  if (lowerCmd.includes('systemctl disable') || lowerCmd.includes('systemctl mask')) {
    return 'Service-Deaktivierung'
  }
  if (lowerCmd.includes('purge') || lowerCmd.includes('remove')) {
    return 'Paket-Entfernung'
  }
  return 'Kritischer Systembefehl'
}

interface CriticalCommandDialogProps {
  command: string
  onConfirm: () => void
  onCancel: () => void
}

export default function CriticalCommandDialog({ 
  command, 
  onConfirm, 
  onCancel 
}: CriticalCommandDialogProps) {
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Focus password input when dialog opens
    inputRef.current?.focus()
  }, [])

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

  const criticalReason = getCriticalReason(command)

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="relative max-w-lg w-full rounded-xl border border-amber-500/50 bg-[#0d141b] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-amber-500/30 bg-amber-500/10">
          <div className="flex items-center gap-3">
            <div className="bg-amber-500/20 border border-amber-400/40 rounded-full p-2">
              <AlertTriangle className="h-5 w-5 text-amber-300" />
            </div>
            <h3 className="text-lg font-semibold text-amber-100">
              Kritischer Befehl
            </h3>
          </div>
          <button
            onClick={onCancel}
            className="p-2 hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="h-5 w-5 text-slate-400 hover:text-white" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Warning Message */}
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
            <p className="text-sm text-amber-100 mb-2">
              <strong>Warnung:</strong> Sie sind dabei, einen kritischen Befehl auszuführen.
            </p>
            <p className="text-xs text-amber-200/80">
              Grund: <span className="font-medium">{criticalReason}</span>
            </p>
          </div>

          {/* Command Preview */}
          <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700">
            <p className="text-xs text-slate-400 mb-2">Befehl:</p>
            <code className="text-sm font-mono text-rose-300 break-all">
              {command}
            </code>
          </div>

          {/* Password Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-white mb-2">
                <Lock className="h-4 w-4 text-slate-400" />
                Passwort zur Bestätigung
              </label>
              <div className="relative">
                <input
                  ref={inputRef}
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    setError(null)
                  }}
                  placeholder="Geben Sie Ihr Passwort ein"
                  className="w-full rounded-lg border border-slate-700 bg-slate-900/50 px-4 py-3 pr-12 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50"
                  disabled={verifying}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-white transition-colors"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {error && (
                <p className="mt-2 text-sm text-rose-400">{error}</p>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onCancel}
                className="flex-1 px-4 py-3 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors"
                disabled={verifying}
              >
                Abbrechen
              </button>
              <button
                type="submit"
                disabled={verifying || !password.trim()}
                className="flex-1 px-4 py-3 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {verifying ? (
                  <>
                    <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Prüfe...
                  </>
                ) : (
                  <>
                    <Lock className="h-4 w-4" />
                    Befehl ausführen
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
