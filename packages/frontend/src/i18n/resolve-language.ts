export type Language = 'en' | 'tr'

const LANGUAGES: readonly string[] = ['en', 'tr']

function supported(value: string | null | undefined): Language | undefined {
  const base = value?.toLowerCase().split('-')[0]
  return base !== undefined && LANGUAGES.includes(base) ? (base as Language) : undefined
}

export function resolveLanguage(input: {
  user?: string
  stored?: string | null
  browser?: string
}): Language {
  return supported(input.user) ?? supported(input.stored) ?? supported(input.browser) ?? 'en'
}
