'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { Check, Globe2, Loader2, Sparkles } from 'lucide-react'
import ParticleBackground from '@/components/ParticleBackground'
import { BackgroundLayers } from '@/components/AppShell'

const LANG_OPTIONS = [
  { code: 'de', accent: 'from-cyan-400 to-blue-500' },
  { code: 'en', accent: 'from-emerald-400 to-teal-500' },
] as const

export default function LanguageSetupPage() {
  const t = useTranslations('languageSetup')
  const locale = useLocale()
  const router = useRouter()
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleSelect = async (language: string) => {
    setSaving(language)
    setError(null)

    try {
      console.log('[LanguageSetup] Sending language:', language)
      const res = await fetch('/api/user/language', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language }),
      })

      console.log('[LanguageSetup] Response status:', res.status)
      const data = await res.json()
      console.log('[LanguageSetup] Response data:', data)
      
      if (!res.ok) {
        throw new Error(data.error || t('errors.saveFailed'))
      }

      console.log('[LanguageSetup] Success! Redirecting to /server-setup')
      // Force a complete page reload from server to pick up new cookies
      window.location.replace('/server-setup')
    } catch (err: any) {
      console.error('[LanguageSetup] Error:', err)
      setError(err.message || t('errors.saveFailed'))
      setSaving(null)
    }
  }

  return (
    <div className="min-h-screen relative bg-[#050505] text-[#E0E0E0] overflow-hidden">
      <BackgroundLayers />
      <ParticleBackground />

      <div className="relative z-10 max-w-5xl mx-auto px-6 py-12 lg:py-16">
        <div className="flex items-center gap-3 mb-6">
          <div className="h-11 w-11 rounded-xl border border-cyan-400/40 bg-cyan-500/10 flex items-center justify-center shadow-[0_0_30px_rgba(0,243,255,0.25)]">
            <Globe2 className="h-5 w-5 text-cyan-200" />
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-200/70 font-mono">
              {t('eyebrow')}
            </p>
            <h1 className="text-3xl font-semibold text-white">{t('title')}</h1>
          </div>
        </div>
        <p className="text-slate-300 text-sm max-w-2xl mb-10">{t('subtitle')}</p>

        {error && (
          <div className="mb-6 rounded-lg border border-rose-500/60 bg-rose-500/10 text-rose-50 px-4 py-3">
            {error}
          </div>
        )}

        <div className="grid gap-6 md:grid-cols-2">
          {LANG_OPTIONS.map((option) => {
            const isActive = locale === option.code
            const isSaving = saving === option.code
            return (
              <button
                key={option.code}
                type="button"
                onClick={() => handleSelect(option.code)}
                disabled={!!saving}
                className="relative group rounded-2xl border border-slate-800 bg-[#0b1118]/80 p-6 text-left shadow-[0_0_45px_rgba(0,243,255,0.12)] overflow-hidden transition-all hover:border-cyan-500/50 hover:-translate-y-0.5 disabled:opacity-70"
              >
                <div className={`absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-br ${option.accent} via-transparent`} />
                <div className="relative flex items-start justify-between gap-4">
                  <div>
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-white/10 bg-white/5 text-xs uppercase tracking-[0.18em] text-slate-200">
                      <Sparkles className="h-3.5 w-3.5" />
                      {t(`languages.${option.code}.tagline`)}
                    </div>
                    <h2 className="text-2xl font-semibold text-white mt-4">
                      {t(`languages.${option.code}.title`)}
                    </h2>
                    <p className="text-slate-300 text-sm mt-2">
                      {t(`languages.${option.code}.description`)}
                    </p>
                  </div>
                  <div className="h-12 w-12 rounded-xl border border-white/10 bg-black/30 flex items-center justify-center">
                    <span className="text-xl">{t(`languages.${option.code}.flag`)}</span>
                  </div>
                </div>

                <div className="mt-6 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm text-slate-200">
                    <Check className={`h-4 w-4 ${isActive ? 'text-emerald-300' : 'text-slate-500'}`} />
                    <span>
                      {isActive
                        ? t('cta.active')
                        : t('cta.switch')}
                    </span>
                  </div>
                  <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-cyan-500/50 bg-cyan-500/10 text-cyan-100 text-sm">
                    {isSaving ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>{t('saving')}</span>
                      </>
                    ) : (
                      <>
                        <Globe2 className="h-4 w-4" />
                        <span>{t('cta.select')}</span>
                      </>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        <p className="text-center text-xs text-slate-400 mt-10">
          {t('footnote')}
        </p>
      </div>
    </div>
  )
}
