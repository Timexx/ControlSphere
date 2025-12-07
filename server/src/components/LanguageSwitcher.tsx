'use client'

import { useState, useRef, useEffect } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { locales } from '@/i18n'
import { Globe, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export default function LanguageSwitcher() {
  const locale = useLocale()
  const t = useTranslations('appShell')
  const tLanguages = useTranslations('languageSetup.languages')
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleLanguageChange = async (newLanguage: string) => {
    if (newLanguage === locale || isLoading) return

    console.log('🌐 Changing language from', locale, 'to', newLanguage)
    setIsLoading(true)
    try {
      const response = await fetch('/api/auth/change-language', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ language: newLanguage }),
      })

      console.log('API response status:', response.status)
      
      if (response.ok) {
        const data = await response.json()
        console.log('API response:', data)
        // Instead of reload, do a full navigation to force fresh cookies
        console.log('Navigating to force cookie refresh...')
        window.location.href = window.location.pathname
      } else {
        const errorData = await response.json()
        console.error('Failed to change language:', errorData)
        setIsLoading(false)
      }
    } catch (error) {
      console.error('Language change error:', error)
      setIsLoading(false)
    }
  }

  const currentLanguageLabel = locale === 'de' ? 'Deutsch' : 'English'

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={isLoading}
        className="inline-flex items-center justify-center gap-2 px-4 py-2 min-w-24 h-10 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white transition-all disabled:opacity-60"
        title={t('actions.language.title')}
      >
        <Globe className="h-4 w-4" />
        <span className="text-sm font-medium">
          {isLoading ? t('actions.language.loading') : currentLanguageLabel}
        </span>
      </button>

      {/* Dropdown Menu */}
      {isOpen && !isLoading && (
        <div className="absolute top-full right-0 mt-2 w-56 rounded-lg border border-slate-700 bg-[#0d141b] shadow-lg z-50 overflow-hidden">
          <div className="p-2 space-y-1">
            {locales.map((lang) => (
              <button
                key={lang}
                onClick={() => {
                  setIsOpen(false)
                  handleLanguageChange(lang)
                }}
                className={cn(
                  'w-full text-left px-3 py-2.5 rounded-md transition-colors text-sm',
                  lang === locale
                    ? 'bg-cyan-500/10 border border-cyan-500/50 text-cyan-100'
                    : 'hover:bg-slate-800 text-slate-300'
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex flex-col">
                      <span className="font-medium">
                        {tLanguages(`${lang}.title`)}
                      </span>
                      <span className="text-xs text-slate-400">
                        {tLanguages(`${lang}.tagline`)}
                      </span>
                    </div>
                  </div>
                  {lang === locale && (
                    <Check className="h-4 w-4 text-cyan-300 flex-shrink-0" />
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
