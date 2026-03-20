'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { Settings, Download, Users } from 'lucide-react'
import AppShell from '@/components/AppShell'
import AddAgentModal from '@/components/AddAgentModal'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'

const tabs = [
  { href: '/settings',        icon: Settings, labelKey: 'tabs.general' as const },
  { href: '/settings/users',  icon: Users,    labelKey: 'tabs.users'   as const },
  { href: '/settings/update', icon: Download, labelKey: 'tabs.update'  as const },
]

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('settings')
  const pathname = usePathname()
  const [showAddModal, setShowAddModal] = useState(false)

  return (
    <AppShell onAddAgent={() => setShowAddModal(true)}>
      <div className="space-y-6 max-w-5xl">
        {/* Page Header */}
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-cyan-200/70 font-mono mb-1">
            {t('eyebrow')}
          </p>
          <h2 className="text-2xl font-semibold text-white">{t('title')}</h2>
          <p className="text-sm text-slate-400 mt-1">{t('subtitle')}</p>
        </div>

        {/* Horizontal Tab Bar */}
        <div className="flex gap-1 border-b border-slate-800">
          {tabs.map((tab) => {
            const active = tab.href === '/settings'
              ? pathname === '/settings'
              : pathname.startsWith(tab.href)
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap',
                  active
                    ? 'border-cyan-400 text-cyan-300'
                    : 'border-transparent text-slate-400 hover:text-white hover:border-slate-600'
                )}
              >
                <tab.icon className="h-4 w-4" />
                {t(tab.labelKey)}
              </Link>
            )
          })}
        </div>

        {/* Active Tab Content */}
        <div>
          {children}
        </div>
      </div>

      {showAddModal && <AddAgentModal onClose={() => setShowAddModal(false)} />}
    </AppShell>
  )
}
