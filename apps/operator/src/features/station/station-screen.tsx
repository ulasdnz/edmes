import { useAppCore, useConnection, useRealtimeRooms, useSession } from '@mes/frontend/core'
import { runningJobOrderOptions } from '@mes/frontend/data/production/job-orders'
import { workCentersListOptions } from '@mes/frontend/data/work-center/work-centers'
import { formatInstant } from '@mes/frontend/time'
import { ConnectionIndicator } from '@mes/ui/components/connection-indicator'
import { Skeleton } from '@mes/ui/components/skeleton'
import { useQuery } from '@tanstack/react-query'
import { type ReactNode, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
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

  const workCenters = useQuery(workCentersListOptions(api, { status: 'active' }))
  const runningJobOrder = useQuery(runningJobOrderOptions(api, workCenterId))
  const workCenter = workCenters.data?.data.find(candidate => candidate._id === workCenterId)
  // Archived, or no longer assigned to the user: the operator chooses again.
  const gone = workCenters.isSuccess && workCenter === undefined

  useEffect(() => {
    if (gone) onStationGone()
  }, [gone, onStationGone])

  return (
    <main className='flex flex-1 flex-col gap-6 p-6'>
      <header className='flex flex-wrap items-center justify-between gap-4'>
        {workCenter ? (
          <h1 className='font-display text-3xl leading-tight font-semibold'>{workCenter.name}</h1>
        ) : (
          <Skeleton className='h-8 w-60' />
        )}
        <StationConnection />
      </header>
      {runningJobOrder.data !== undefined ? (
        <CurrentJobOrder jobOrder={runningJobOrder.data} />
      ) : runningJobOrder.isError ? (
        <p className='text-lg text-text-2'>{t('station.jobOrderFailed')}</p>
      ) : (
        <Skeleton className='h-36 w-full' />
      )}
    </main>
  )
}
