'use client'

import { useEffect, useState, useCallback } from 'react'
import { Settings, Server, Globe, CheckCircle2, AlertCircle, RefreshCw, Copy, Check } from 'lucide-react'
import AppShell from '@/components/AppShell'
import AddAgentModal from '@/components/AddAgentModal'
import { useTranslations } from 'next-intl'

export default function SettingsPage() {
  const t = useTranslations('settings')

  const [currentUrl, setCurrentUrl] = useState<string | null>(null)
  const [detectedUrl, setDetectedUrl] = useState<string | null>(null)
  const [inputUrl, setInputUrl] = useState('')
  const [loadingConfig, setLoadingConfig] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)

  const loadConfig = useCallback(async () => {
    setLoadingConfig(true)
    try {
      const [configRes, infoRes] = await Promise.all([
        fetch('/api/server-config', { cache: 'no-store' }),
        fetch('/api/server-info', { cache: 'no-store' }),
      ])
      const config = await configRes.json()
      const info = await infoRes.json()
      setCurrentUrl(config.serverUrl ?? null)
      setInputUrl(config.serverUrl ?? '')
      setDetectedUrl(info.url ?? null)
    } catch {
      // non-fatal
    } finally {
      setLoadingConfig(false)
    }
  }, [])

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  const handleSave = async () => {
    setSaving(true)
    setSaveSuccess(false)
    setSaveError(null)
    try {
      const res = await fetch('/api/server-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverUrl: inputUrl.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setSaveError(data.error || t('serverUrl.errorGeneric'))
      } else {
        setCurrentUrl(data.serverUrl)
        setSaveSuccess(true)
        setTimeout(() => setSaveSuccess(false), 4000)
      }
    } catch {
      setSaveError(t('serverUrl.errorGeneric'))
    } finally {
      setSaving(false)
    }
  }

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const isDirty = inputUrl.trim() !== (currentUrl ?? '')

  return (
    <AppShell onAddAgent={() => setShowAddModal(true)}>
      <div className="space-y-6 max-w-3xl">
        {/* Page Header */}
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-cyan-200/70 font-mono mb-1">
            {t('eyebrow')}
          </p>
          <h2 className="text-2xl font-semibold text-white">{t('title')}</h2>
          <p className="text-sm text-slate-400 mt-1">{t('subtitle')}</p>
        </div>

        {/* ── Server URL Card ──────────────────────────────────────── */}
        <div className="rounded-xl border border-slate-800 bg-[#0B1118]/70 shadow-[0_0_30px_rgba(0,243,255,0.06)] overflow-hidden">
          {/* Card header */}
          <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-800">
            <div className="h-8 w-8 rounded-lg border border-cyan-500/30 bg-cyan-500/10 flex items-center justify-center">
              <Globe className="h-4 w-4 text-cyan-300" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400 font-mono">
                {t('serverUrl.eyebrow')}
              </p>
              <h3 className="text-white font-semibold text-base leading-tight">
                {t('serverUrl.title')}
              </h3>
            </div>
          </div>

          {/* Card body */}
          <div className="px-5 py-5 space-y-5">
            <p className="text-sm text-slate-400 leading-relaxed">
              {t('serverUrl.description')}
            </p>

            {/* Currently active URL */}
            {!loadingConfig && currentUrl && (
              <div className="flex items-center gap-2 rounded-lg border border-slate-700/60 bg-slate-900/60 px-4 py-2.5">
                <Server className="h-4 w-4 text-slate-400 shrink-0" />
                <span className="text-sm font-mono text-slate-200 flex-1 truncate">{currentUrl}</span>
                <button
                  onClick={() => handleCopy(currentUrl)}
                  className="text-slate-400 hover:text-white transition-colors"
                  title={t('serverUrl.copy')}
                >
                  {copied
                    ? <Check className="h-3.5 w-3.5 text-emerald-400" />
                    : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
            )}

            {/* Auto-detected fallback hint */}
            {!loadingConfig && detectedUrl && detectedUrl !== currentUrl && (
              <div className="flex items-start gap-3 rounded-lg border border-slate-700/40 bg-slate-800/40 px-4 py-3">
                <RefreshCw className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-400 mb-1">{t('serverUrl.detected')}</p>
                  <p className="text-sm font-mono text-slate-200 truncate">{detectedUrl}</p>
                </div>
                <button
                  onClick={() => setInputUrl(detectedUrl)}
                  className="text-xs text-cyan-400 hover:text-cyan-200 transition-colors whitespace-nowrap"
                >
                  {t('serverUrl.useDetected')}
                </button>
              </div>
            )}

            {/* Input row */}
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium">
                {t('serverUrl.inputLabel')}
              </label>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={inputUrl}
                  onChange={(e) => {
                    setInputUrl(e.target.value)
                    setSaveError(null)
                    setSaveSuccess(false)
                  }}
                  placeholder="http://192.168.10.10:3000"
                  className="flex-1 rounded-lg border border-slate-700 bg-[#070b11] px-3 py-2 text-sm font-mono text-slate-200 placeholder-slate-600 focus:border-cyan-500/60 focus:outline-none focus:ring-1 focus:ring-cyan-500/30 transition-colors"
                />
                <button
                  onClick={handleSave}
                  disabled={saving || !isDirty || !inputUrl.trim()}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-600 text-white text-sm font-medium hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {saving
                    ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    : <Settings className="h-3.5 w-3.5" />}
                  {saving ? t('serverUrl.saving') : t('serverUrl.save')}
                </button>
              </div>

              {saveSuccess && (
                <div className="flex items-center gap-2 text-emerald-400 text-xs mt-1">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {t('serverUrl.saveSuccess')}
                </div>
              )}
              {saveError && (
                <div className="flex items-center gap-2 text-rose-400 text-xs mt-1">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {saveError}
                </div>
              )}
            </div>

            {/* Impact notice */}
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3">
              <p className="text-xs text-amber-300/80 font-medium mb-1.5">
                {t('serverUrl.impactTitle')}
              </p>
              <ul className="text-xs text-slate-400 space-y-1 list-disc list-inside">
                <li>{t('serverUrl.impactAgent')}</li>
                <li>{t('serverUrl.impactWs')}</li>
                <li>{t('serverUrl.impactInstall')}</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {showAddModal && <AddAgentModal onClose={() => setShowAddModal(false)} />}
    </AppShell>
  )
}
