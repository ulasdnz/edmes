import type { ApiError } from '@mes/api-client'
import { Button } from '@mes/ui/components/button'
import { cn } from '@mes/ui/lib/utils'
import type { TFunction } from 'i18next'
import {
  Loader2Icon,
  LockIcon,
  type LucideIcon,
  RefreshCwIcon,
  SearchIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export function PageLoading(): ReactNode {
  const { t } = useTranslation()
  return (
    <div className='grid min-h-screen place-items-center p-6'>
      <output className='flex items-center gap-2 text-[13.5px] text-text-2'>
        <Loader2Icon
          aria-hidden='true'
          className='size-4 animate-spin motion-reduce:animate-none'
        />
        {t('common.loading')}
      </output>
    </div>
  )
}

export function apiErrorMessage(error: ApiError, t: TFunction): string {
  if (error.kind === 'network') return t('errors.network')
  if (error.kind === 'timeout') return t('errors.timeout')
  // nginx answers it and cannot translate
  if (error.code === 'gateway.unavailable') return t('common.serviceUnavailable')
  if (error.kind === 'http' && error.message !== error.code) return error.message
  return t('errors.unexpected')
}

function StateLayout(props: {
  icon: LucideIcon
  tone?: 'neutral' | 'error'
  role?: 'alert'
  title: string
  message: string
  children?: ReactNode
}): ReactNode {
  const Icon = props.icon
  return (
    <div role={props.role} className='flex flex-col items-center gap-2 px-6 py-12 text-center'>
      <span
        aria-hidden='true'
        className={cn(
          'flex size-11 items-center justify-center rounded-full',
          props.tone === 'error'
            ? 'bg-state-unplanned-bg text-state-unplanned-fg'
            : 'bg-state-idle-bg text-text-2',
        )}
      >
        <Icon className='size-5' />
      </span>
      <h2 className='font-display text-lg leading-tight font-semibold'>{props.title}</h2>
      <p className='max-w-100 text-[13px] text-text-2'>{props.message}</p>
      {props.children}
    </div>
  )
}

export function PageError(props: {
  title: string
  message: string
  traceId?: string
  onRetry: () => void
}): ReactNode {
  const { t } = useTranslation()
  return (
    <StateLayout
      icon={TriangleAlertIcon}
      tone='error'
      role='alert'
      title={props.title}
      message={props.message}
    >
      <Button variant='primary' className='mt-1.5' onClick={props.onRetry}>
        <RefreshCwIcon aria-hidden='true' />
        {t('common.tryAgain')}
      </Button>
      {props.traceId && (
        <p className='text-xs text-text-3'>
          {t('common.reference')} <span className='font-mono'>{props.traceId}</span>
        </p>
      )}
    </StateLayout>
  )
}

export function NoPermission(props: {
  title: string
  message: string
  onSignOut?: () => void
}): ReactNode {
  const { t } = useTranslation()
  return (
    <StateLayout icon={LockIcon} title={props.title} message={props.message}>
      {props.onSignOut && (
        <Button variant='primary' className='mt-1.5' onClick={props.onSignOut}>
          {t('common.signOut')}
        </Button>
      )}
    </StateLayout>
  )
}

export function EmptyState(props: {
  title: string
  message: string
  action?: ReactNode
}): ReactNode {
  return (
    <StateLayout icon={SearchIcon} title={props.title} message={props.message}>
      {props.action && <div className='mt-1.5'>{props.action}</div>}
    </StateLayout>
  )
}
