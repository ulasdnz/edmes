import { useAppCore, useCan, useSession } from '@mes/frontend/core'
import { Banner } from '@mes/ui/components/banner'
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { AppSidebar } from '../components/app-sidebar'
import { NoPermission, PageLoading } from '../components/page-state'
import { Topbar } from '../components/topbar'
import { whenSessionKnown } from '../session-ready'

const BOOTSTRAP_RETRY_MS = 5000

export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context, location }) => {
    await whenSessionKnown(context.core.session)
    if (context.core.session.getState().status === 'anonymous') {
      throw redirect({ to: '/login', search: { redirect: location.href } })
    }
  },
  pendingComponent: PageLoading,
  pendingMs: 0,
  component: AppLayout,
})

function AppLayout() {
  const { t } = useTranslation()
  const { session } = useAppCore()
  const { status, user } = useSession()
  const can = useCan()
  const waitingForServer = status === 'unreachable' && user === null

  useEffect(() => {
    if (!waitingForServer) return
    const timer = setInterval(() => void session.bootstrap(), BOOTSTRAP_RETRY_MS)
    return () => clearInterval(timer)
  }, [waitingForServer, session])

  if (waitingForServer) {
    return (
      <div className='grid min-h-screen place-items-center p-6'>
        <output className='font-display text-lg font-semibold text-text-2'>
          {t('common.unreachable')}
        </output>
      </div>
    )
  }
  if (!user) return null
  if (!can('accessWebApp')) {
    return (
      <div className='grid min-h-screen place-items-center p-6'>
        <NoPermission
          title={t('access.noAppTitle')}
          message={t('access.noApp')}
          onSignOut={session.logout}
        />
      </div>
    )
  }

  return (
    <div className='flex min-h-screen'>
      <AppSidebar userId={user._id} />
      <div className='flex min-w-0 flex-1 flex-col'>
        <Topbar />
        {status === 'unreachable' && (
          <div className='px-6 pt-4'>
            <Banner tone='warn' role='status'>
              {t('common.unreachable')}
            </Banner>
          </div>
        )}
        <main className='flex flex-col gap-5 px-6 pt-6 pb-12'>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
