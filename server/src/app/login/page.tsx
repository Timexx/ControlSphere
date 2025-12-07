'use client'

import { useState, useEffect, useCallback, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import {
  Shield,
  Lock,
  User,
  ArrowRight,
  Loader2,
  Terminal,
  Activity,
  Wifi,
  Cpu,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import ParticleBackground from '@/components/ParticleBackground'

export default function LoginPage() {
  const t = useTranslations('login')
  const [isSetup, setIsSetup] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  const [formData, setFormData] = useState({
    username: '',
    password: '',
    confirmPassword: '',
  })

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/status')
      const data = await res.json()
      setIsSetup(data.isSetup)
    } catch (err) {
      setError(t('errors.statusCheck'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    checkStatus()
  }, [checkStatus])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSubmitting(true)

    try {
      const completeAuth = (language: string | null) => {
        if (language) {
          document.cookie = `NEXT_LOCALE=${language}; path=/`
        }
        const target = language ? '/' : '/language-setup'
        router.push(target)
        router.refresh()
      }

      let language: string | null = null

      if (!isSetup) {
        // Setup mode
        if (formData.password !== formData.confirmPassword) {
          throw new Error(t('errors.passwordMismatch'))
        }
        
        const res = await fetch('/api/auth/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: formData.username,
            password: formData.password,
          }),
        })

        const data = await res.json()
        if (!res.ok) {
          throw new Error(data.error || t('errors.setupFailed'))
        }
        language = data.language ?? null
      } else {
        // Login mode
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: formData.username,
            password: formData.password,
          }),
        })

        const data = await res.json()
        if (!res.ok) {
          throw new Error(data.error || t('errors.loginFailed'))
        }
        language = data.language ?? null
      }

      // Success
      completeAuth(language)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const modeKey = isSetup ? 'login' : 'setup'

  if (loading) {
    return (
      <div className="min-h-screen bg-[#050505] text-[#E0E0E0] flex items-center justify-center relative overflow-hidden">
        <BackgroundLayers />
        <ParticleBackground />
        <div className="relative z-10 flex flex-col items-center gap-4">
          <div className="flex items-center gap-3">
            <Loader2 className="w-10 h-10 text-cyan-300 animate-spin" />
            <div className="text-left">
              <p className="text-xs uppercase tracking-[0.24em] text-cyan-300/80 font-mono">
                {t('loading.title')}
              </p>
              <p className="text-sm text-slate-300">
                {t('loading.subtitle')}
              </p>
            </div>
          </div>
          <div className="w-48 h-px bg-gradient-to-r from-transparent via-cyan-500/70 to-transparent animate-pulse" />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen relative bg-[#050505] text-[#E0E0E0] overflow-hidden">
      <BackgroundLayers />
      <ParticleBackground />

      <div className="relative z-10 max-w-6xl mx-auto px-6 py-10 lg:py-16">
        <div className="flex flex-col items-center mb-10">
          <div className="flex items-center gap-4 mb-8">
            <div className="h-12 w-12 rounded-xl border border-cyan-400/40 bg-cyan-400/10 shadow-[0_0_30px_rgba(0,243,255,0.35)] flex items-center justify-center">
              <Shield className="w-7 h-7 text-cyan-300" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-cyan-300/70 font-mono">
                ControlSphere
              </p>
              <h1 className="text-3xl font-semibold font-display text-white">
                {t(`titles.primary.${modeKey}`)}
              </h1>
            </div>
          </div>
        </div>

        <div className="max-w-md mx-auto">
          <div className="relative overflow-hidden rounded-2xl border border-cyan-500/50 bg-[#0A0F14]/80 backdrop-blur-xl shadow-[0_0_55px_rgba(0,243,255,0.16)]">
            <div className="absolute inset-0 pointer-events-none opacity-70" style={{ backgroundImage: 'linear-gradient(120deg, rgba(0,243,255,0.18), rgba(112,0,255,0.12))' }} />
            <div className="absolute -inset-x-6 -top-1 h-1 bg-gradient-to-r from-transparent via-cyan-400/70 to-transparent" />
            <div className="relative p-8 lg:p-10 space-y-7">
              <div>
                <h2 className="text-2xl font-display text-white">
                  {t(`titles.form.${modeKey}`)}
                </h2>
                <p className="text-sm text-slate-400 mt-2">
                  {t(`subtitles.${modeKey}`)}
                </p>
              </div>

              {error && (
                <div className="p-4 rounded-lg border border-red-500/50 bg-red-500/10 text-sm text-red-100 shadow-[0_0_25px_rgba(255,0,85,0.18)]">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                  <label className="text-sm uppercase tracking-[0.18em] text-slate-300 font-mono">
                    {t('labels.username')}
                  </label>
                  <div className="relative group">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-cyan-300 transition-colors" />
                    <input
                      type="text"
                      required
                      value={formData.username}
                      onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                      className="w-full bg-[#0c1219]/80 border border-[#133040] rounded-lg pl-11 pr-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/30 outline-none transition-all shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
                      placeholder={t('placeholders.username')}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm uppercase tracking-[0.18em] text-slate-300 font-mono">
                    {t('labels.password')}
                  </label>
                  <div className="relative group">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-cyan-300 transition-colors" />
                    <input
                      type="password"
                      required
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      className="w-full bg-[#0c1219]/80 border border-[#133040] rounded-lg pl-11 pr-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/30 outline-none transition-all shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
                      placeholder={t('placeholders.password')}
                    />
                  </div>
                </div>

                {!isSetup && (
                  <div className="space-y-2">
                    <label className="text-sm uppercase tracking-[0.18em] text-slate-300 font-mono">
                      {t('labels.confirmPassword')}
                    </label>
                    <div className="relative group">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-cyan-300 transition-colors" />
                      <input
                        type="password"
                        required
                        value={formData.confirmPassword}
                        onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                        className="w-full bg-[#0c1219]/80 border border-[#133040] rounded-lg pl-11 pr-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/30 outline-none transition-all shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
                        placeholder={t('placeholders.confirmPassword')}
                      />
                    </div>
                  </div>
                )}

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="relative overflow-hidden w-full text-white font-semibold py-3 px-6 rounded-lg transition-all duration-200 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 disabled:cursor-not-allowed border border-cyan-500/50"
                  >
                    <div className="flex items-center justify-center gap-2">
                      {submitting ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          <span>{t(`buttons.submitting.${modeKey}`)}</span>
                        </>
                      ) : (
                        <>
                          <span>{t(`buttons.submit.${modeKey}`)}</span>
                          <ArrowRight className="w-5 h-5" />
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

function StatusPill({
  icon,
  label,
  tone = 'info',
}: {
  icon: ReactNode
  label: string
  tone?: 'good' | 'info' | 'warn'
}) {
  const tones: Record<'good' | 'info' | 'warn', string> = {
    good: 'text-emerald-200 border-emerald-400/40 bg-emerald-500/10',
    info: 'text-cyan-200 border-cyan-400/40 bg-cyan-500/10',
    warn: 'text-amber-200 border-amber-400/40 bg-amber-500/10',
  }

  return (
    <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-mono uppercase tracking-[0.18em] ${tones[tone]}`}>
      {icon}
      {label}
    </span>
  )
}

function FeatureCard({
  icon,
  title,
  body,
}: {
  icon: ReactNode
  title: string
  body: string
}) {
  return (
    <div className="border border-white/10 rounded-lg bg-white/5 backdrop-blur-sm p-4 hover:border-cyan-400/50 transition-all hover:-translate-y-0.5">
      <div className="flex items-center gap-3 mb-2">
        <div className="h-9 w-9 rounded-md border border-white/10 bg-black/30 flex items-center justify-center shadow-[0_0_18px_rgba(0,243,255,0.18)]">
          {icon}
        </div>
        <h3 className="font-semibold text-white">{title}</h3>
      </div>
      <p className="text-sm text-slate-300 leading-relaxed">{body}</p>
    </div>
  )
}

function LogLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-cyan-200/80">{label}</span>
      <span className="text-cyan-100 font-semibold uppercase tracking-wide">{value}</span>
    </div>
  )
}
