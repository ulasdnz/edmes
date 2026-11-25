import { toApiError } from '@mes/api-client'
import { useAppCore, useRealtimeRooms } from '@mes/frontend/core'
import { type UsersListSearch, usersListOptions } from '@mes/frontend/data/user/users'
import { Input } from '@mes/ui/components/input'
import { useQuery } from '@tanstack/react-query'
import { SearchIcon } from 'lucide-react'
import { type ReactNode, useEffect, useEffectEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DataTableSkeleton } from '../../components/data-table'
import { apiErrorMessage, PageError } from '../../components/page-state'
import { UsersTable } from './users-table'

const SEARCH_DELAY_MS = 300

function SearchBox(props: {
  value: string | undefined
  onChange: (value: string | undefined) => void
}): ReactNode {
  const { t } = useTranslation()
  const [text, setText] = useState(props.value ?? '')
  const [previous, setPrevious] = useState(props.value)
  if (props.value !== previous) {
    setPrevious(props.value)
    if ((props.value ?? '') !== text.trim()) setText(props.value ?? '')
  }

  const commit = useEffectEvent((value: string) => props.onChange(value || undefined))
  useEffect(() => {
    const value = text.trim()
    if (value === (props.value ?? '')) return
    const timer = setTimeout(() => commit(value), SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [text, props.value])

  return (
    <div className='relative w-full max-w-75'>
      <SearchIcon
        aria-hidden='true'
        className='pointer-events-none absolute top-2.5 left-2.5 size-4 text-text-3'
      />
      <Input
        type='search'
        aria-label={t('users.search')}
        placeholder={t('users.searchPlaceholder')}
        maxLength={100}
        value={text}
        onChange={event => setText(event.target.value)}
        className='pl-8'
      />
    </div>
  )
}

export function UsersPage(props: {
  search: UsersListSearch
  onSearchChange: (next: Partial<UsersListSearch>) => void
}): ReactNode {
  const { t } = useTranslation()
  const { api } = useAppCore()
  useRealtimeRooms(['user'])
  const query = useQuery(usersListOptions(api, props.search))
  const totalPages = query.data?.pagination.totalPages ?? 0

  const goToLastPage = useEffectEvent(() => props.onSearchChange({ page: totalPages }))
  useEffect(() => {
    if (totalPages > 0 && props.search.page > totalPages) goToLastPage()
  }, [totalPages, props.search.page])

  let body: ReactNode
  if (query.data) {
    body = (
      <UsersTable
        rows={query.data.data}
        pagination={query.data.pagination}
        onPageChange={page => props.onSearchChange({ page })}
        onSizeChange={size => props.onSearchChange({ size, page: 1 })}
        busy={query.isPlaceholderData}
      />
    )
  } else if (query.isError) {
    const error = toApiError(query.error)
    body = (
      <PageError
        title={t('users.loadFailed')}
        message={apiErrorMessage(error, t)}
        traceId={error.traceId}
        onRetry={() => void query.refetch()}
      />
    )
  } else {
    body = <DataTableSkeleton columns={5} label={t('users.loading')} />
  }

  return (
    <>
      <div className='flex flex-wrap items-end gap-x-4 gap-y-3'>
        <div className='flex flex-col gap-1'>
          <h1 className='font-display text-[28px] leading-[1.15] font-semibold'>
            {t('users.title')}
          </h1>
          {query.data && (
            <p className='text-[13px] text-text-3'>
              {t('users.count', { count: query.data.pagination.total })}
            </p>
          )}
        </div>
      </div>
      <section aria-label={t('users.table')} className='rounded-lg border border-line bg-surface'>
        <div className='flex min-h-13 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-2 px-4 py-3'>
          <SearchBox
            value={props.search.search}
            onChange={search => props.onSearchChange({ search, page: 1 })}
          />
        </div>
        {body}
      </section>
    </>
  )
}
