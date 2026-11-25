import { useAppCore } from '@mes/frontend/core'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { z } from 'zod'
import { LoginPage } from '../features/auth/login-page'
import { safeRedirect } from '../safe-redirect'

export const Route = createFileRoute('/login')({
  validateSearch: z.object({ redirect: z.string().optional().catch(undefined) }),
  beforeLoad: ({ context, search }) => {
    if (context.core.session.getState().status === 'authenticated') {
      throw redirect({ href: safeRedirect(search.redirect), replace: true })
    }
  },
  component: Login,
})

function Login() {
  const { redirect: target } = Route.useSearch()
  const { session } = useAppCore()
  const router = useRouter()
  return (
    <LoginPage
      onSubmit={async credentials => {
        await session.login(credentials)
        await router.navigate({ href: safeRedirect(target), replace: true })
      }}
    />
  )
}
