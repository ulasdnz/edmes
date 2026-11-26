import { useAppCore, useCan, useSession, whenSessionKnown } from '@mes/frontend/core'
import { Banner } from '@mes/ui/components/banner'
import { Button } from '@mes/ui/components/button'
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  FullScreen,
  ScreenLoading,
  ScreenTitle,
  ServerUnreachable,
} from '../components/screen-state'

const BOOTSTRAP_RETRY_MS = 5000

export const Route = createFileRoute('/_station')({
  beforeLoad: async ({ context }) => {
    const { session } = context.core
    await whenSessionKnown(session)
    const { status, user } = session.getState()
    if (status === 'anonymous') throw redirect({ to: '/login' })
    // Started during an outage: no user, so no permissions to check yet.
    if (status === 'unreachable' && user === null) return
    if (!session.can('accessOperatorPanel')) return
    if (context.station.getWorkCenterId() === null) {
      throw redirect({ to: '/select-work-center', replace: true })
    }
  },
  pendingComponent: ScreenLoading,
  pendingMs: 0,
  component: StationLayout,
})

function StationLayout() {
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
    return <ServerUnreachable />
  }
  if (!user) return null
  if (!can('accessOperatorPanel')) {
    return (
      <FullScreen>
        <ScreenTitle>{t('access.noPanelTitle')}</ScreenTitle>
        <p className='text-base text-text-2'>{t('access.noPanel')}</p>
        <Button variant='primary' onClick={session.logout}>
          {t('common.signOut')}
        </Button>
      </FullScreen>
    )
  }

  return (
    <div className='flex min-h-screen flex-col'>
      {status === 'unreachable' && (
        <div className='px-6 pt-4'>
          <Banner tone='warn' role='status'>
            {t('common.unreachable')}
          </Banner>
        </div>
      )}
      <Outlet />
    </div>
  )
}
