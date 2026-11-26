const BASE = 'http://edmes.invalid'

export function safeRedirect(target: unknown): string {
  if (typeof target !== 'string' || !target.startsWith('/')) return '/'
  try {
    const url = new URL(target, BASE)
    if (url.origin !== BASE) return '/'
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return '/'
  }
}
