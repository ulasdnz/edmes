import { createFileRoute, Navigate } from '@tanstack/react-router'
import { useSyncExternalStore } from 'react'
import { StationScreen } from '../../features/station/station-screen'

export const Route = createFileRoute('/_station/')({
  component: Station,
})

function Station() {
  const { station } = Route.useRouteContext()
  const workCenterId = useSyncExternalStore(station.subscribe, station.getWorkCenterId)
  if (workCenterId === null) return <Navigate to='/select-work-center' replace />
  return (
    <StationScreen
      key={workCenterId}
      workCenterId={workCenterId}
      onStationGone={() => station.clear()}
    />
  )
}
