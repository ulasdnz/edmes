import { usersListSearchSchema } from '@mes/frontend/data/user/users'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { NoPermission } from '../../../components/page-state'
import { UsersPage } from '../../../features/users/users-page'

export const Route = createFileRoute('/_app/users/')({
  validateSearch: usersListSearchSchema,
  beforeLoad: ({ context }) => ({ canReadUsers: context.core.session.can('readUsers') }),
  component: Users,
})

function Users() {
  const { t } = useTranslation()
  const { canReadUsers } = Route.useRouteContext()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()

  if (!canReadUsers) {
    return (
      <NoPermission
        title={t('access.noPageTitle', { page: t('nav.users') })}
        message={t('access.noPage')}
      />
    )
  }
  return (
    <UsersPage
      search={search}
      onSearchChange={next => void navigate({ search: previous => ({ ...previous, ...next }) })}
    />
  )
}
