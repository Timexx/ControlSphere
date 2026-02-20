'use client'

import { type ReactNode } from 'react'

export default function StatusBadge({
  icon,
  label,
  tone = 'info',
}: {
  icon: ReactNode
  label: string
  tone?: 'good' | 'info' | 'warn' | 'critical'
}) {
  const tones: Record<'good' | 'info' | 'warn' | 'critical', string> = {
    good: 'bg-emerald-500/10 border-emerald-400/40 text-emerald-100',
    info: 'bg-cyan-500/10 border-cyan-400/40 text-cyan-100',
    warn: 'bg-amber-500/10 border-amber-400/40 text-amber-100',
    critical: 'bg-rose-500/10 border-rose-400/40 text-rose-100',
  }
  return (
    <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-mono uppercase tracking-[0.18em] ${tones[tone]}`}>
      {icon}
      {label}
    </span>
  )
}
