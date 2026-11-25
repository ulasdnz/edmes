import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export function FullScreen(props: { children: ReactNode }): ReactNode {
  return (
    <div className='grid min-h-screen place-items-center p-6'>
      <div className='flex max-w-120 flex-col items-center gap-3 text-center'>{props.children}</div>
    </div>
  )
}

export function ScreenLoading(): ReactNode {
  const { t } = useTranslation()
  return (
    <FullScreen>
      <output className='text-base text-text-2'>{t('common.loading')}</output>
    </FullScreen>
  )
}

export function ScreenTitle(props: { children: ReactNode }): ReactNode {
  return <h1 className='font-display text-2xl leading-tight font-semibold'>{props.children}</h1>
}
