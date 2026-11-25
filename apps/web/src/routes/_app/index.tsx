import { createFileRoute, redirect } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '../../components/page-state'
import { visibleNavigation } from '../../navigation'

export const Route = createFileRoute('/_app/')({
  beforeLoad: ({ context }) => {
    const first = visibleNavigation(code => context.core.session.can(code))[0]?.items[0]
    if (first) throw redirect({ href: first.to, replace: true })
  },
  component: Home,
})

function Home() {
  const { t } = useTranslation()
  return <EmptyState title={t('home.emptyTitle')} message={t('home.emptyMessage')} />
}
