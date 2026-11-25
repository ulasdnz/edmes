import { Button } from '@mes/ui/components/button'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ScreenTitle } from '../../components/screen-state'

export function WorkCenterPicker(props: {
  workCenters: readonly { _id: string; code: string; name: string }[]
  onSelect: (workCenterId: string) => void
  onSignOut: () => void
}): ReactNode {
  const { t } = useTranslation()

  return (
    <main className='flex min-h-screen flex-col gap-6 p-6'>
      {props.workCenters.length === 0 ? (
        <div className='flex flex-1 flex-col items-center justify-center gap-3 text-center'>
          <ScreenTitle>{t('picker.none')}</ScreenTitle>
          <p className='text-base text-text-2'>{t('picker.noneMessage')}</p>
        </div>
      ) : (
        <>
          <ScreenTitle>{t('picker.title')}</ScreenTitle>
          <ul className='grid flex-1 content-start gap-3 sm:grid-cols-2'>
            {props.workCenters.map(workCenter => (
              <li key={workCenter._id}>
                <Button
                  className='h-auto min-h-(--control-h) w-full flex-col items-start gap-1 py-3 text-left whitespace-normal'
                  onClick={() => props.onSelect(workCenter._id)}
                >
                  <span className='text-lg font-semibold'>{workCenter.name}</span>
                  <span className='font-mono text-sm text-text-2'>{workCenter.code}</span>
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
      <Button className='self-start' onClick={props.onSignOut}>
        {t('common.signOut')}
      </Button>
    </main>
  )
}
