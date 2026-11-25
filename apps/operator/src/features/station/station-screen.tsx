import { useAppCore, useConnection, useRealtimeRooms, useSession } from '@mes/frontend/core'
import { formatInstant } from '@mes/frontend/time'
import { ConnectionIndicator } from '@mes/ui/components/connection-indicator'
import { Skeleton } from '@mes/ui/components/skeleton'
import { useQuery } from '@tanstack/react-query'
import { type ReactNode, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { queryProblem } from '../../recovery'
import { stationJobOrderQuery, visibleWorkCentersQuery } from '../../station/station-queries'
import { stationRoom } from '../../station/station-store'
import { CurrentJobOrder } from './current-job-order'

function StationConnection(): ReactNode {
  const { t, i18n } = useTranslation()
  const { plantTimezone } = useSession()
  const connection = useConnection()

  let label = t('common.live')
  if (connection.status === 'reconnecting') label = t('common.reconnecting')
  if (connection.status === 'offline') {
    const time = formatInstant((connection.since ?? new Date()).toISOString(), {
      timeZone: plantTimezone ?? 'UTC',
      locale: i18n.language,
      style: 'time',
    })
    label = t('common.offlineSince', { time })
  }
  return <ConnectionIndicator status={connection.status} label={label} />
}

export function StationScreen(props: {
  workCenterId: string
  onStationGone: () => void
}): ReactNode {
  const { t } = useTranslation()
  const { api } = useAppCore()
  const { workCenterId, onStationGone } = props
  useRealtimeRooms([stationRoom(workCenterId)])

  const workCenters = useQuery(visibleWorkCentersQuery(api))
  const runningJobOrder = useQuery(stationJobOrderQuery(api, workCenterId))
  const workCenter = workCenters.data?.data.find(candidate => candidate._id === workCenterId)
  // Archived, or no longer assigned to the user: the operator chooses again.
  const gone = workCenters.isSuccess && workCenter === undefined

  useEffect(() => {
    if (gone) onStationGone()
  }, [gone, onStationGone])

  const nameProblem = workCenter ? null : queryProblem(workCenters)
  const jobOrderProblem = runningJobOrder.data === undefined ? queryProblem(runningJobOrder) : null
  const unreachable = nameProblem === 'unavailable' || jobOrderProblem === 'unavailable'

  return (
    <main className='flex flex-1 flex-col gap-6 p-6'>
      <header className='flex flex-wrap items-center justify-between gap-4'>
        {workCenter ? (
          <h1 className='font-display text-3xl leading-tight font-semibold'>{workCenter.name}</h1>
        ) : nameProblem === 'failed' ? (
          <p className='text-lg text-text-2'>{t('station.workCenterFailed')}</p>
        ) : (
          <Skeleton className='h-8 w-60' />
        )}
        <StationConnection />
      </header>
      {unreachable && (
        <p className='font-display text-lg font-semibold text-text-2'>{t('common.unreachable')}</p>
      )}
      {runningJobOrder.data !== undefined ? (
        <CurrentJobOrder jobOrder={runningJobOrder.data} />
      ) : jobOrderProblem === 'failed' ? (
        <p className='text-lg text-text-2'>{t('station.jobOrderFailed')}</p>
      ) : (
        jobOrderProblem !== 'unavailable' && <Skeleton className='h-36 w-full' />
      )}
    </main>
  )
}
