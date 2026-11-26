import { useAppCore, whenSessionKnown } from '@mes/frontend/core'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { z } from 'zod'
import { PageLoading } from '../components/page-state'
import { LoginPage } from '../features/auth/login-page'
import { safeRedirect } from '../safe-redirect'

export const Route = createFileRoute('/login')({
  validateSearch: z.object({ redirect: z.string().optional().catch(undefined) }),
  beforeLoad: async ({ context, search }) => {
    await whenSessionKnown(context.core.session)
    if (context.core.session.getState().status === 'authenticated') {
      throw redirect({ href: safeRedirect(search.redirect), replace: true })
    }
  },
  pendingComponent: PageLoading,
  pendingMs: 0,
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
