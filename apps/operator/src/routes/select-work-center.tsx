import { useAppCore, whenSessionKnown } from '@mes/frontend/core'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { ScreenLoading } from '../components/screen-state'
import { SelectStation } from '../features/station/select-station'

export const Route = createFileRoute('/select-work-center')({
  beforeLoad: async ({ context }) => {
    const { session } = context.core
    await whenSessionKnown(session)
    const { status, user } = session.getState()
    if (status === 'anonymous') throw redirect({ to: '/login' })
    // The station layout shows the unreachable and no-access screens.
    if (user === null || !session.can('accessOperatorPanel')) throw redirect({ to: '/' })
  },
  pendingComponent: ScreenLoading,
  pendingMs: 0,
  component: SelectWorkCenter,
})

function SelectWorkCenter() {
  const { session } = useAppCore()
  const { station } = Route.useRouteContext()
  const navigate = Route.useNavigate()
  return (
    <SelectStation
      station={station}
      onStation={() => void navigate({ to: '/', replace: true })}
      onSignOut={session.logout}
    />
  )
}
