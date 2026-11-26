import type { AppCore } from '@mes/frontend/core'
import { createRootRouteWithContext } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '../components/page-state'

export interface RouterContext {
  core: AppCore
}

export const Route = createRootRouteWithContext<RouterContext>()({
  notFoundComponent: NotFound,
})

function NotFound() {
  const { t } = useTranslation()
  return <EmptyState title={t('notFound.title')} message={t('notFound.message')} />
}
