import { useAppCore } from '@mes/frontend/core'
import { Button } from '@mes/ui/components/button'
import { useQuery } from '@tanstack/react-query'
import { type ReactNode, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  FullScreen,
  ScreenLoading,
  ScreenTitle,
  ServerUnreachable,
} from '../../components/screen-state'
import { queryProblem } from '../../recovery'
import { visibleWorkCentersQuery } from '../../station/station-queries'
import type { StationStore } from '../../station/station-store'
import { WorkCenterPicker } from './work-center-picker'

// Reconciles the stored station with every fresh list of the user's work centers: on to the
// station when it is still theirs or is the only one, else the picker.
export function SelectStation(props: {
  station: StationStore
  onStation: () => void
  onSignOut: () => void
}): ReactNode {
  const { t } = useTranslation()
  const { api } = useAppCore()
  const { station, onStation } = props
  // Fresh, not cached: a station whose room was just refused must not be chosen again from an
  // older list.
  const list = useQuery({ ...visibleWorkCentersQuery(api), staleTime: 0 })
  const ids = list.isFetching ? undefined : list.data?.data.map(workCenter => workCenter._id).join()
  const [reconciled, setReconciled] = useState(false)

  useEffect(() => {
    if (ids === undefined) return
    const result = station.reconcile(ids ? ids.split(',') : [])
    if (result === 'kept' || result === 'auto-selected') onStation()
    else setReconciled(true)
  }, [ids, station, onStation])

  if (list.data && reconciled) {
    return (
      <WorkCenterPicker
        workCenters={list.data.data}
        onSelect={workCenterId => {
          station.select(workCenterId)
          onStation()
        }}
        onSignOut={props.onSignOut}
      />
    )
  }
  const problem = queryProblem(list)
  if (problem === 'unavailable') return <ServerUnreachable />
  if (problem === 'failed') {
    return (
      <FullScreen>
        <ScreenTitle>{t('picker.loadFailed')}</ScreenTitle>
        <div className='flex flex-wrap justify-center gap-3'>
          <Button variant='primary' onClick={() => void list.refetch()}>
            {t('common.tryAgain')}
          </Button>
          <Button onClick={props.onSignOut}>{t('common.signOut')}</Button>
        </div>
      </FullScreen>
    )
  }
  return <ScreenLoading />
}
