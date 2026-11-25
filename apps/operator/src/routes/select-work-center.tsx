import { toApiError } from '@mes/api-client'
import { useAppCore, whenSessionKnown } from '@mes/frontend/core'
import { workCentersListOptions } from '@mes/frontend/data/work-center/work-centers'
import { Button } from '@mes/ui/components/button'
import { useSuspenseQuery } from '@tanstack/react-query'
import {
  createFileRoute,
  type ErrorComponentProps,
  redirect,
  useRouter,
} from '@tanstack/react-router'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { FullScreen, ScreenLoading, ScreenTitle } from '../components/screen-state'
import { WorkCenterPicker } from '../features/station/work-center-picker'

const RETRY_MS = 5000
const UNREACHABLE_KINDS = new Set(['network', 'timeout'])

export const Route = createFileRoute('/select-work-center')({
  beforeLoad: async ({ context }) => {
    const { session } = context.core
    await whenSessionKnown(session)
    const { status, user } = session.getState()
    if (status === 'anonymous') throw redirect({ to: '/login' })
    // The station layout shows the unreachable and no-access screens.
    if (user === null || !session.can('accessOperatorPanel')) throw redirect({ to: '/' })
  },
  loader: async ({ context }) => {
    const { core, station } = context
    // Fresh, not cached: a station whose room was just refused must not be chosen again from an
    // older list.
    const list = await core.queryClient.fetchQuery({
      ...workCentersListOptions(core.api, { status: 'active' }),
      staleTime: 0,
    })
    const result = station.reconcile(list.data.map(workCenter => workCenter._id))
    if (result === 'kept' || result === 'auto-selected') throw redirect({ to: '/', replace: true })
  },
  pendingComponent: ScreenLoading,
  pendingMs: 0,
  errorComponent: PickerError,
  component: SelectWorkCenter,
})

function SelectWorkCenter() {
  const { api, session } = useAppCore()
  const { station } = Route.useRouteContext()
  const navigate = Route.useNavigate()
  const { data } = useSuspenseQuery(workCentersListOptions(api, { status: 'active' }))
  return (
    <WorkCenterPicker
      workCenters={data.data}
      onSelect={workCenterId => {
        station.select(workCenterId)
        void navigate({ to: '/', replace: true })
      }}
      onSignOut={session.logout}
    />
  )
}

function PickerError(props: ErrorComponentProps) {
  const { t } = useTranslation()
  const router = useRouter()
  const { session } = useAppCore()
  const unreachable = UNREACHABLE_KINDS.has(toApiError(props.error).kind)

  // An unreachable server is retried without anyone at the tablet.
  useEffect(() => {
    if (!unreachable) return
    const timer = setInterval(() => void router.invalidate(), RETRY_MS)
    return () => clearInterval(timer)
  }, [unreachable, router])

  if (unreachable) {
    return (
      <FullScreen>
        <output className='font-display text-lg font-semibold text-text-2'>
          {t('common.unreachable')}
        </output>
      </FullScreen>
    )
  }
  return (
    <FullScreen>
      <ScreenTitle>{t('picker.loadFailed')}</ScreenTitle>
      <div className='flex flex-wrap justify-center gap-3'>
        <Button variant='primary' onClick={() => void router.invalidate()}>
          {t('common.tryAgain')}
        </Button>
        <Button onClick={session.logout}>{t('common.signOut')}</Button>
      </div>
    </FullScreen>
  )
}
