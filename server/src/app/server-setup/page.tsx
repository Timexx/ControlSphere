'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Server, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import ParticleBackground from '@/components/ParticleBackground'
import { BackgroundLayers } from '@/components/AppShell'

export default function ServerSetupPage() {
  const t = useTranslations('serverSetup')
  const [serverUrl, setServerUrl] = useState('')
  const [detected, setDetected] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Pre-fill with auto-detected URL (from /api/server-info fallback)
  useEffect(() => {
    fetch('/api/server-info')
      .then((r) => r.json())
      .then((d) => {
        const url = d.url || ''
        setDetected(url)
        // Only pre-fill if no value was typed yet
        setServerUrl((prev) => prev || url)
      })
      .catch(() => {})
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSaved(false)

    try {
      const res = await fetch('/api/server-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverUrl }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || t('errors.saveFailed'))
      setSaved(true)
      setTimeout(() => window.location.replace('/'), 1200)
    } catch (err: any) {
      setError(err.message || t('errors.saveFailed'))
      setSaving(false)
    }
  }

  const isValid = /^https?:\/\/.+/.test(serverUrl.trim())

  return (
    <div className="min-h-screen relative bg-[#050505] text-[#E0E0E0] overflow-hidden">
      <BackgroundLayers />
      <ParticleBackground />

      <div className="relative z-10 max-w-2xl mx-auto px-6 py-12 lg:py-16">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="h-11 w-11 rounded-xl border border-cyan-400/40 bg-cyan-500/10 flex items-center justify-center shadow-[0_0_30px_rgba(0,243,255,0.25)]">
            <Server className="h-5 w-5 text-cyan-200" />
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-200/70 font-mono">
              {t('eyebrow')}
            </p>
            <h1 className="text-3xl font-semibold text-white">{t('title')}</h1>
          </div>
        </div>
        <p className="text-slate-300 text-sm max-w-xl mb-10">{t('subtitle')}</p>

        {/* Card */}
        <div className="rounded-2xl border border-slate-800 bg-[#0b1118]/80 p-6 shadow-[0_0_45px_rgba(0,243,255,0.08)]">
          <label className="block text-sm text-slate-200 mb-2 font-medium">
            {t('label')}
          </label>
          <input
            type="url"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder={t('placeholder')}
            className="w-full rounded-lg border border-slate-700 bg-[#0f161d] px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors font-mono text-sm"
          />

          {detected && detected !== serverUrl && (
            <p className="mt-2 text-xs text-slate-400">
              {t('detectedHint')}: <span className="text-cyan-400 font-mono">{detected}</span>
            </p>
          )}

          <p className="mt-3 text-xs text-slate-500 leading-relaxed">
            {t('hint')}
          </p>

          {error && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-rose-500/60 bg-rose-500/10 text-rose-200 px-4 py-3 text-sm">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {saved && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-500/60 bg-emerald-500/10 text-emerald-200 px-4 py-3 text-sm">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              {t('savedFeedback')}
            </div>
          )}

          <button
            onClick={handleSave}
            disabled={saving || saved || !isValid}
            className="mt-6 w-full inline-flex items-center justify-center gap-2 rounded-lg border border-cyan-500/50 bg-cyan-500/10 px-5 py-3 text-cyan-100 text-sm font-medium transition-all hover:bg-cyan-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving || saved ? (
              <>
                {saved
                  ? <CheckCircle2 className="h-4 w-4" />
                  : <Loader2 className="h-4 w-4 animate-spin" />}
                <span>{saved ? t('savedFeedback') : t('saving')}</span>
              </>
            ) : (
              t('save')
            )}
          </button>
        </div>

        <p className="text-center text-xs text-slate-400 mt-8">
          {t('footnote')}
        </p>
      </div>
    </div>
  )
}
