// When the stored token was issued, read from its payload without checking the signature: it is
// shown to the user ("signed in since"), never trusted for access.
export function tokenIssuedAt(token: string | null): Date | null {
  const payload = token?.split('.')[1]
  if (!payload) return null
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const { iat } = JSON.parse(atob(base64)) as { iat?: unknown }
    if (typeof iat !== 'number' || !Number.isFinite(iat)) return null
    const issued = new Date(iat * 1000)
    // A number past the range of a date gives an invalid one, which would throw when formatted
    return Number.isNaN(issued.getTime()) ? null : issued
  } catch {
    return null
  }
}
