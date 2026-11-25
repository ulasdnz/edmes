import type { AppCore } from '@mes/frontend/core'
import { Button } from '@mes/ui/components/button'
import { createRootRouteWithContext, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { FullScreen, ScreenTitle } from '../components/screen-state'
import type { StationStore } from '../station/station-store'

export interface RouterContext {
  core: AppCore
  station: StationStore
}

export const Route = createRootRouteWithContext<RouterContext>()({
  notFoundComponent: NotFound,
})

function NotFound() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  return (
    <FullScreen>
      <ScreenTitle>{t('notFound.title')}</ScreenTitle>
      <Button variant='primary' onClick={() => void navigate({ to: '/', replace: true })}>
        {t('notFound.back')}
      </Button>
    </FullScreen>
  )
}
