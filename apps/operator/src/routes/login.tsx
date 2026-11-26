import { useAppCore, whenSessionKnown } from '@mes/frontend/core'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { FullScreen, ScreenLoading, ScreenTitle } from '../components/screen-state'
import { LoginForm } from '../features/auth/login-form'

// Every sign-in passes the picker, which reconciles the stored station with the user's work
// centers and goes on to the station when it is still theirs.
export const Route = createFileRoute('/login')({
  beforeLoad: async ({ context }) => {
    await whenSessionKnown(context.core.session)
    if (context.core.session.getState().status === 'authenticated') {
      throw redirect({ to: '/select-work-center', replace: true })
    }
  },
  pendingComponent: ScreenLoading,
  pendingMs: 0,
  component: Login,
})

function Login() {
  const { t } = useTranslation()
  const { session } = useAppCore()
  const router = useRouter()
  return (
    <FullScreen>
      <div className='flex w-full max-w-100 flex-col gap-6 text-left'>
        <ScreenTitle>{t('auth.title')}</ScreenTitle>
        <LoginForm
          onSubmit={async credentials => {
            await session.login(credentials)
            await router.navigate({ to: '/select-work-center', replace: true })
          }}
        />
      </div>
    </FullScreen>
  )
}
