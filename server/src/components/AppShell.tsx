'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Server, Layers, Plus, LogOut, ShieldCheck, ShieldAlert, Menu, X, TerminalSquare } from 'lucide-react'
import { type ReactNode, useState, useEffect, useRef, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'
import LanguageSwitcher from './LanguageSwitcher'

interface AppShellProps {
  children: ReactNode
  onAddAgent?: () => void
  onLogout?: () => void
  loggingOut?: boolean
  hideNav?: boolean
}

export default function AppShell({
  children,
  onAddAgent,
  onLogout,
  loggingOut = false,
  hideNav = false,
}: AppShellProps) {
  const t = useTranslations('appShell')
  const pathname = usePathname()
  const [isNavOpen, setIsNavOpen] = useState(false)
  const [vulnSummary, setVulnSummary] = useState<{ critical: number; high: number; affectedMachines: number; criticalEvents: number } | null>(null)
  const [remainingTime, setRemainingTime] = useState<number | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [showExpiryDialog, setShowExpiryDialog] = useState(false)
  const [showRefreshTooltip, setShowRefreshTooltip] = useState(false)
  const [internalLoggingOut, setInternalLoggingOut] = useState(false)
  const remainingRef = useRef<number | null>(null)
  const expiryDialogRef = useRef(false)

  // Fetch remaining session time; reused for polling and manual refresh events
  const updateRemainingTime = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/session-time')
      if (res.ok) {
        const data = await res.json()
        const remaining = data.remainingTime
        const prevRemaining = remainingRef.current
        remainingRef.current = remaining
        setRemainingTime(remaining)

        // Show dialog when time drops below 60 seconds
        if (
          remaining !== null &&
          remaining <= 60 &&
          remaining > 0 &&
          !expiryDialogRef.current &&
          prevRemaining !== null &&
          prevRemaining > 60
        ) {
          expiryDialogRef.current = true
          setShowExpiryDialog(true)
        }

        // Auto redirect when expired
        if (remaining !== null && remaining <= 0) {
          window.location.href = '/login'
        }
      }
    } catch (error) {
      console.error('Failed to fetch session time:', error)
    }
  }, [])

  const fetchVulnSummary = useCallback(async () => {
    try {
      const res = await fetch('/api/security/vulnerabilities', { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json()
      setVulnSummary({
        critical: data.critical ?? 0,
        high: data.high ?? 0,
        affectedMachines: data.affectedMachines ?? 0,
        criticalEvents: data.criticalEvents ?? 0
      })
    } catch (error) {
      console.error('Failed to fetch vulnerability summary:', error)
    }
  }, [])

  const handleInternalLogout = async () => {
    if (internalLoggingOut) return
    
    setInternalLoggingOut(true)
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
      window.location.href = '/login'
    } catch (error) {
      console.error('Logout failed:', error)
      setInternalLoggingOut(false)
    }
  }

  const effectiveOnLogout = onLogout || handleInternalLogout
  const effectiveLoggingOut = loggingOut || internalLoggingOut

  useEffect(() => {
    updateRemainingTime()

    // Reduce polling frequency to lower server load
    const interval = setInterval(updateRemainingTime, 30000)

    // Update immediately when a session is renewed elsewhere (e.g., Bulk Auth Dialog)
    const handleSessionRenewed = () => {
      updateRemainingTime()
    }
    window.addEventListener('session-renewed', handleSessionRenewed)

    return () => {
      clearInterval(interval)
      window.removeEventListener('session-renewed', handleSessionRenewed)
    }
  }, [updateRemainingTime])

  useEffect(() => {
    fetchVulnSummary()
    const intervalMs = 120000

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchVulnSummary()
      }
    }

    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchVulnSummary()
      }
    }, intervalMs)

    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [fetchVulnSummary])

  const handleRefreshSession = async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      const res = await fetch('/api/auth/refresh', { method: 'POST' })
      if (res.ok) {
        expiryDialogRef.current = false
        setShowExpiryDialog(false)
        // Dispatch event to notify other components (e.g., bulk page) and update timer
        window.dispatchEvent(new CustomEvent('session-renewed'))
        await updateRemainingTime()
      } else {
        console.error('Failed to refresh session')
      }
    } catch (error) {
      console.error('Session refresh error:', error)
    } finally {
      setRefreshing(false)
    }
  }

  const navItems = [
    { href: '/', label: t('nav.dashboard'), icon: Server },
    { href: '/bulk-management', label: t('nav.bulk'), icon: Layers },
    { href: '/security', label: t('nav.security'), icon: ShieldCheck },
    { href: '/audit-logs', label: t('nav.audit'), icon: TerminalSquare },
  ];

  return (
    <div className="min-h-screen relative bg-[#050505] text-[#E0E0E0]">
      <BackgroundLayers />

      <div className="relative z-10 min-h-screen">
        <header className="fixed top-0 left-0 right-0 h-16 flex items-center justify-between px-6 border-b border-slate-800 bg-[#070b11]/95 backdrop-blur-md z-50">
          <div className="flex items-center gap-3">
            {!hideNav && (
              <button
                onClick={() => setIsNavOpen(!isNavOpen)}
                className="lg:hidden inline-flex items-center justify-center w-10 h-10 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white transition-all"
                title={t('actions.toggleNav')}
              >
                {isNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>
            )}
            <div className="h-10 w-10 rounded-lg border border-cyan-400/30 bg-[#0f161d] flex items-center justify-center">
              <Server className="h-5 w-5 text-cyan-200" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-200/70 font-mono">
                ControlSphere
              </p>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-semibold text-white">Fleet Console</h1>
                <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                  BETA
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onAddAgent}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 min-w-24 h-10 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white transition-all"
            >
              <Plus className="h-4 w-4" />
              <span>{t('actions.addAgent')}</span>
            </button>
            <Link
              href="/security"
              className={cn(
                "inline-flex h-10 items-center gap-3 px-4 rounded-lg border transition-all min-w-[180px]",
                ((vulnSummary?.critical ?? 0) + (vulnSummary?.criticalEvents ?? 0)) > 0
                  ? "border-rose-500/60 bg-rose-500/10 text-rose-50 shadow-[0_0_18px_rgba(244,63,94,0.35)]"
                  : "border-slate-700 bg-slate-800/60 text-slate-100 hover:border-cyan-500/60 hover:text-white"
              )}
              title="Open vulnerabilities"
            >
              <div className="relative h-8 w-8 rounded-md border border-current/50 bg-black/30 flex items-center justify-center">
                <ShieldAlert className="h-4 w-4" />
                {((vulnSummary?.critical ?? 0) + (vulnSummary?.criticalEvents ?? 0)) > 0 && (
                  <span className="absolute -top-1 -right-1 h-5 min-w-[20px] px-1 rounded-full bg-rose-600 text-[11px] font-semibold text-white flex items-center justify-center leading-none">
                    {(vulnSummary?.critical ?? 0) + (vulnSummary?.criticalEvents ?? 0)}
                  </span>
                )}
              </div>
              <div className="leading-tight text-left">
                <div className="text-[11px] uppercase tracking-[0.14em] text-slate-300">
                  {t('nav.security')}
                </div>
                <div className="text-xs text-slate-200">
                  {vulnSummary
                    ? (() => {
                        const totalCritical = (vulnSummary.critical ?? 0) + (vulnSummary.criticalEvents ?? 0)
                        return `${totalCritical} critical${(vulnSummary.high ?? 0) > 0 ? ` • ${vulnSummary.high} high` : ''}`
                      })()
                    : '...'}
                </div>
              </div>
            </Link>
            {remainingTime !== null && (
              <div className="relative">
                <button
                  onClick={handleRefreshSession}
                  disabled={refreshing}
                  onMouseEnter={() => setShowRefreshTooltip(true)}
                  onMouseLeave={() => setShowRefreshTooltip(false)}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 min-w-24 h-10 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white transition-all disabled:opacity-60 ml-6"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="currentColor" className="h-4 w-4">
                    <path d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z"/>
                  </svg>
                  <span className={cn(
                    "text-sm font-mono",
                    remainingTime < 120 ? "text-orange-400" : "text-slate-300"
                  )}>
                    {remainingTime < 120 
                      ? `${remainingTime}s` 
                      : `${Math.floor(remainingTime / 60)}m`
                    }
                  </span>
                </button>
                
                {/* Custom Tooltip */}
                {showRefreshTooltip && (
                  <div className="absolute top-full left-1/2 transform -translate-x-1/2 mt-2 px-3 py-2 bg-slate-900/95 backdrop-blur-md border border-slate-700 rounded-lg shadow-lg z-50 min-w-max">
                    <div className="text-xs text-slate-200 font-medium">
                      {t('actions.refresh.title')}
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                      {t('actions.refresh.subtitle')}
                    </div>
                    {/* Arrow */}
                    <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-b-4 border-transparent border-b-slate-700"></div>
                  </div>
                )}
              </div>
            )}
            <LanguageSwitcher />
            <button
              onClick={effectiveOnLogout}
              disabled={effectiveLoggingOut}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 min-w-24 h-10 rounded-lg border border-slate-600 text-slate-200 hover:bg-slate-800 transition-all disabled:opacity-60"
              title={t('actions.logout.title')}
            >
              <LogOut className="h-4 w-4" />
              <span>{effectiveLoggingOut ? t('actions.logout.loading') : t('actions.logout.label')}</span>
            </button>
          </div>
        </header>

        {/* Mobile Navigation Overlay */}
        {isNavOpen && !hideNav && (
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-30 lg:hidden"
            onClick={() => setIsNavOpen(false)}
          />
        )}

        {/* Sidebar - Fixed on both mobile and desktop */}
        {!hideNav && (
          <aside className={cn(
            "fixed top-16 left-0 bottom-0 w-64 border-r border-slate-800 bg-[#0a0f16]/95 backdrop-blur-md z-40 transition-transform duration-300 ease-in-out lg:transition-none",
            isNavOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
          )}>
            <nav className="p-4 space-y-2">
              {navItems.map((item) => {
                const active = pathname === item.href
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setIsNavOpen(false)}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2 rounded-lg border transition-all",
                      active
                        ? "border-cyan-500/70 bg-cyan-500/10 text-cyan-100 shadow-[0_0_20px_rgba(0,243,255,0.18)]"
                        : "border-slate-800 text-slate-300 hover:border-cyan-500/50 hover:text-white hover:bg-[#0d1722]"
                    )}
                  >
                    <item.icon className="h-4 w-4" />
                    <span className="text-sm font-medium">{item.label}</span>
                  </Link>
                )
              })}
            </nav>
          </aside>
        )}

        {/* Main Content */}
        <main className={cn(
          "min-h-screen px-6 pb-8 lg:px-10 lg:pb-12",
          "pt-[88px] lg:pt-[104px]",
          hideNav ? "" : "lg:ml-64"
        )}>
          {children}
        </main>

        {/* Session Expiry Dialog */}
        {showExpiryDialog && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center px-4">
            <div className="relative max-w-md w-full rounded-xl border border-orange-500/50 bg-[#0d141b] p-6 space-y-4 shadow-lg">
              <div className="text-center space-y-3">
                <div className="h-12 w-12 rounded-full border border-orange-500/50 bg-orange-500/10 flex items-center justify-center mx-auto">
                  <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor" className="h-6 w-6 text-orange-400">
                    <path d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z"/>
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-white">{t('sessionExpiry.title')}</h3>
                <p className="text-sm text-slate-300">
                  {t('sessionExpiry.description')}
                </p>
                <div className="text-2xl font-mono text-orange-400">
                  {remainingTime !== null ? `${remainingTime}s` : '0s'}
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowExpiryDialog(false)}
                  className="flex-1 px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-800 transition-all"
                >
                  {t('sessionExpiry.cancel')}
                </button>
                <button
                  onClick={handleRefreshSession}
                  disabled={refreshing}
                  className="flex-1 px-4 py-2 rounded-lg border border-cyan-500/50 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 transition-all disabled:opacity-60"
                >
                  {refreshing ? t('sessionExpiry.extending') : t('sessionExpiry.extend')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function BackgroundLayers() {
  return (
    <>
      <div className="absolute inset-0 bg-[#05080d]" />
      <div className="absolute inset-0 opacity-[0.08]" style={{ backgroundImage: 'radial-gradient(circle at 20% 20%, rgba(0,243,255,0.12), transparent 26%), radial-gradient(circle at 80% 0%, rgba(255,0,85,0.08), transparent 20%), radial-gradient(circle at 70% 70%, rgba(112,0,255,0.08), transparent 24%)' }} />
    </>
  )
}
