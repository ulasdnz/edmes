// When the stored token was issued, read from its payload without checking the signature: it is
// shown to the user ("signed in since"), never trusted for access.
export function tokenIssuedAt(token: string | null): Date | null {
  const payload = token?.split('.')[1]
  if (!payload) return null
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const { iat } = JSON.parse(atob(base64)) as { iat?: unknown }
    return typeof iat === 'number' && Number.isFinite(iat) ? new Date(iat * 1000) : null
  } catch {
    return null
  }
}
