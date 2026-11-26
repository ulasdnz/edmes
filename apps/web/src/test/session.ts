import type { AppCore } from '@mes/frontend/core'

const encode = (value: object) =>
  btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

// A token shaped like user-service's, issued at the given time; the fake API never checks it
export function fakeToken(issuedAt: Date): string {
  const iat = Math.floor(issuedAt.getTime() / 1000)
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ id: 'u1', iat, exp: iat + 86400 })}.sig`
}

// Signs the test core in with the token: the fake API must answer GET /users/me
export async function signIn(core: AppCore, token: string): Promise<void> {
  sessionStorage.setItem('edmes.web.token', token)
  await core.session.bootstrap()
}
