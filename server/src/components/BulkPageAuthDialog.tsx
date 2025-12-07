'use client'

import { useEffect, useRef, useState } from 'react'
import { Lock, Eye, EyeOff, ShieldCheck, Layers, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import ParticleBackground from '@/components/ParticleBackground'

interface BulkPageAuthDialogProps {
  onConfirm: () => void
  onCancel: () => void
}

function BackgroundLayers() {
  return (
    <>
      <div className="absolute inset-0 bg-gradient-to-br from-[#050505] via-[#070c12] to-[#050505]" />
      <div className="absolute inset-0 opacity-[0.18]" style={{ backgroundImage: 'radial-gradient(circle at 20% 20%, rgba(0,243,255,0.25), transparent 28%), radial-gradient(circle at 80% 0%, rgba(255,0,85,0.22), transparent 22%), radial-gradient(circle at 70% 70%, rgba(112,0,255,0.18), transparent 28%)' }} />
      <div className="absolute inset-0 opacity-[0.11]" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)', backgroundSize: '80px 80px' }} />
      <div className="absolute inset-0 opacity-[0.15] pointer-events-none bg-[linear-gradient(transparent_96%,rgba(0,0,0,0.65)_100%)] bg-[length:100%_3px]" />
    </>
  )
}

export default function BulkPageAuthDialog({ 
  onConfirm,
  onCancel
}: BulkPageAuthDialogProps) {
  const t = useTranslations('bulkAuth')
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
      setError(t('errors.required'))
      return
    }

    setVerifying(true)
    setError(null)

    try {
      // Verify password and renew session
      const res = await fetch('/api/auth/renew-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      })

      if (res.ok) {
        // Notify AppShell to refresh session timer immediately
        window.dispatchEvent(new CustomEvent('session-renewed'))
        onConfirm()
        return
      } else {
        const data = await res.json()
        setError(data.error || t('errors.wrong'))
        setPassword('')
        inputRef.current?.focus()
      }
    } catch (err) {
      setError(t('errors.network'))
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-[#050505] text-[#E0E0E0] overflow-hidden relative">
      <BackgroundLayers />
      <ParticleBackground />

      <div className="relative z-10 max-w-6xl mx-auto px-6 py-10 lg:py-16 flex flex-col items-center justify-center min-h-screen">
        <div className="flex flex-col items-center mb-10">
          <div className="flex items-center gap-4 mb-8">
            <div className="h-12 w-12 rounded-xl border border-cyan-400/40 bg-cyan-400/10 flex items-center justify-center">
              <Layers className="w-7 h-7 text-cyan-300" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-cyan-300/70 font-mono">
                {t('eyebrow')}
              </p>
              <h1 className="text-3xl font-semibold font-display text-white">
                {t('title')}
              </h1>
            </div>
          </div>
        </div>

        <div className="max-w-md mx-auto">
          <div className="relative overflow-hidden rounded-2xl border border-cyan-500/50 bg-[#0A0F14]/80 backdrop-blur-xl">
            <div className="relative p-8 lg:p-10 space-y-7">
              <div>
                <h2 className="text-2xl font-display text-white">
                  {t('heading')}
                </h2>
              </div>

              {/* Warning Message */}
              <div className="flex items-start gap-3 p-4 rounded-lg bg-cyan-500/5 border border-cyan-500/20">
                <ShieldCheck className="h-5 w-5 text-cyan-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-cyan-100">
                    {t('warning.title')}
                  </p>
                  <p className="text-xs text-cyan-200/70 mt-1">
                    {t('warning.body')}
                  </p>
                </div>
              </div>

              {error && (
                <div className="p-4 rounded-lg border border-red-500/50 bg-red-500/10 text-sm text-red-100 shadow-[0_0_25px_rgba(255,0,85,0.18)]">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                  <label className="text-sm uppercase tracking-[0.18em] text-slate-300 font-mono">
                    {t('password.label')}
                  </label>
                  <div className="relative group">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-cyan-300 transition-colors" />
                    <input
                      ref={inputRef}
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value)
                        setError(null)
                      }}
                      disabled={verifying}
                      className="w-full bg-[#0c1219]/80 border border-[#133040] rounded-lg pl-11 pr-12 py-3 text-sm text-white placeholder:text-slate-500 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/30 outline-none transition-all shadow-[0_0_0_1px_rgba(0,0,0,0.4)] disabled:opacity-50"
                      placeholder={t('password.placeholder')}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      disabled={verifying}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded hover:bg-slate-800 transition-colors disabled:opacity-50"
                      tabIndex={-1}
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4 text-slate-400" />
                      ) : (
                        <Eye className="h-4 w-4 text-slate-400" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={onCancel}
                    disabled={verifying}
                    className="flex-1 px-4 py-2 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white transition-all disabled:opacity-50"
                  >
                    {t('actions.cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={verifying || !password.trim()}
                    className="flex-1 relative overflow-hidden text-white font-semibold py-2 px-4 rounded-lg transition-all duration-200 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 disabled:cursor-not-allowed border border-cyan-500/50"
                  >
                    <div className="flex items-center justify-center gap-2">
                      {verifying ? (
                        <>
                          <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          <span>{t('actions.verifying')}</span>
                        </>
                      ) : (
                        <>
                          <ShieldCheck className="h-4 w-4" />
                          <span>{t('actions.submit')}</span>
                        </>
                      )}
                    </div>
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
