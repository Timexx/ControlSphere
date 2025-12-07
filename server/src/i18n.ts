export const locales = ['en', 'de'] as const
export type Locale = (typeof locales)[number]
export const defaultLocale: Locale = 'en'

export function normalizeLocale(input?: string | null): Locale | null {
  if (!input) return null
  const candidate = input.toLowerCase().split('-')[0]
  return (locales as readonly string[]).includes(candidate) ? (candidate as Locale) : null
}

export function resolveLocale(preferred?: string | null, acceptLanguage?: string | null): Locale {
  const normalizedPreferred = normalizeLocale(preferred)
  if (normalizedPreferred) return normalizedPreferred

  if (acceptLanguage) {
    const parts = acceptLanguage.split(',')
    for (const part of parts) {
      const lang = part.split(';')[0]?.trim()
      const normalized = normalizeLocale(lang)
      if (normalized) return normalized
    }
  }

  return defaultLocale
}
