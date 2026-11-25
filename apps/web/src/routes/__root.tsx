import type { AppCore } from '@mes/frontend/core'
import { Toaster } from '@mes/ui/components/sonner'
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '../components/page-state'

export interface RouterContext {
  core: AppCore
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: Root,
  notFoundComponent: NotFound,
})

function Root() {
  return (
    <>
      <Outlet />
      <Toaster position='bottom-right' />
    </>
  )
}

function NotFound() {
  const { t } = useTranslation()
  return <EmptyState title={t('notFound.title')} message={t('notFound.message')} />
}
