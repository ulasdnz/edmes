import type { User } from '@mes/frontend/data/user/users'
import { cn } from '@mes/ui/lib/utils'
import { createColumnHelper } from '@tanstack/react-table'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DataTable,
  type DataTableFeatures,
  type PageSize,
  type Pagination,
} from '../../components/data-table'
import { EmptyState } from '../../components/page-state'

const column = createColumnHelper<DataTableFeatures, User>()

// The canvas's status pill: a mark and a tone, never colour alone
function ActivePill(props: { active: boolean; children: ReactNode }): ReactNode {
  return (
    <span
      data-slot='status-pill'
      className={cn(
        'inline-flex h-6 items-center gap-1.5 rounded-xl pr-[9px] pl-2 text-[12.5px] font-semibold whitespace-nowrap',
        props.active
          ? 'bg-state-running-bg text-state-running-fg'
          : 'bg-surface text-state-idle-fg shadow-[inset_0_0_0_1px_var(--color-border)]',
      )}
    >
      <span
        aria-hidden='true'
        data-mark={props.active ? 'check' : 'cross'}
        className={cn(
          'size-2.5 flex-none',
          props.active
            ? 'bg-current [clip-path:polygon(6%_52%,20%_38%,40%_58%,80%_14%,94%_28%,40%_86%)]'
            : 'bg-[linear-gradient(45deg,transparent_41%,currentColor_41%_59%,transparent_59%),linear-gradient(-45deg,transparent_41%,currentColor_41%_59%,transparent_59%)]',
        )}
      />
      {props.children}
    </span>
  )
}

function initials(user: User): string {
  return `${user.name.charAt(0)}${user.surname.charAt(0)}`.toLocaleUpperCase()
}

export function UsersTable(props: {
  rows: readonly User[]
  pagination: Pagination
  onPageChange: (page: number) => void
  onSizeChange: (size: PageSize) => void
  busy?: boolean
}): ReactNode {
  const { t } = useTranslation()

  const columns = column.columns([
    column.accessor(user => `${user.name} ${user.surname}`, {
      id: 'name',
      header: () => t('users.name'),
      cell: info => (
        <span className='flex items-center gap-2.5'>
          <span
            aria-hidden='true'
            className='inline-flex size-6.5 flex-none items-center justify-center rounded-full bg-accent-bg text-[11px] font-semibold text-accent-hover'
          >
            {initials(info.row.original)}
          </span>
          <span className='font-semibold'>{info.getValue()}</span>
        </span>
      ),
    }),
    column.accessor('username', {
      header: () => t('users.username'),
      cell: info => <span className='font-mono text-[13px]'>{info.getValue()}</span>,
    }),
    column.accessor('email', { header: () => t('users.email') }),
    column.accessor(user => user.workCenterIds.length, {
      id: 'workCenters',
      header: () => t('users.workCenters'),
    }),
    column.accessor('isActivated', {
      header: () => t('users.active'),
      cell: info => (
        <ActivePill active={info.getValue()}>
          {info.getValue() ? t('users.isActive') : t('users.isInactive')}
        </ActivePill>
      ),
    }),
  ])

  return (
    <DataTable
      label={t('users.table')}
      columns={columns}
      rows={props.rows}
      getRowId={user => user._id}
      pagination={props.pagination}
      onPageChange={props.onPageChange}
      onSizeChange={props.onSizeChange}
      busy={props.busy}
      empty={<EmptyState title={t('users.empty')} message={t('users.emptyMessage')} />}
    />
  )
}
