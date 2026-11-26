export interface WebPrefs {
  sidebar: 'full' | 'rail'
}

const DEFAULTS: WebPrefs = { sidebar: 'full' }

const keyFor = (userId: string) => `edmes.web.prefs.${userId}`

export function readPrefs(storage: Pick<Storage, 'getItem'>, userId: string): WebPrefs {
  try {
    const stored: unknown = JSON.parse(storage.getItem(keyFor(userId)) ?? 'null')
    const sidebar =
      typeof stored === 'object' && stored !== null && 'sidebar' in stored
        ? stored.sidebar
        : undefined
    return sidebar === 'full' || sidebar === 'rail' ? { sidebar } : { ...DEFAULTS }
  } catch {
    return { ...DEFAULTS }
  }
}

export function writePrefs(
  storage: Pick<Storage, 'setItem'>,
  userId: string,
  prefs: WebPrefs,
): void {
  try {
    storage.setItem(keyFor(userId), JSON.stringify(prefs))
  } catch {
    // the choice stays for this page only when the device keeps nothing
  }
}

// Device-local, kept before anyone signs in; a signed-in user's own language wins over it.
const LANGUAGE_KEY = 'edmes.web.language'

export function readLanguage(storage: Pick<Storage, 'getItem'>): string | null {
  try {
    return storage.getItem(LANGUAGE_KEY)
  } catch {
    return null
  }
}

export function writeLanguage(storage: Pick<Storage, 'setItem'>, language: string): void {
  try {
    storage.setItem(LANGUAGE_KEY, language)
  } catch {
    // the choice lasts for this page when the device keeps nothing
  }
}
