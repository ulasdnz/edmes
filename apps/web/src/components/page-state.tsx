import type { ApiError } from '@mes/api-client'
import { formatInstant } from '@mes/frontend/time'
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
import { type ReactNode, useEffect, useState } from 'react'
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

export interface ErrorDetails {
  code: string
  status?: number
  // When the error happened, as a UTC instant in server time, shown in the plant's zone
  occurredAt: string
  timeZone: string
}

const COPIED_MS = 2000

// For support, so the labels stay English whatever the language of the page
function errorDetailsText(
  props: { title: string; message: string; traceId?: string; details: ErrorDetails },
  locale: string,
): string {
  const { details } = props
  const time = formatInstant(details.occurredAt, {
    timeZone: details.timeZone,
    locale,
    style: 'dateTime',
  })
  return [
    props.title,
    props.message,
    `code: ${details.code}`,
    `HTTP status: ${details.status ?? 'none'}`,
    `trace id: ${props.traceId || 'none'}`,
    `time: ${time} ${details.timeZone}`,
  ].join('\n')
}

async function writeToClipboard(text: string): Promise<boolean> {
  try {
    // undefined outside a secure context
    if (!navigator.clipboard) return false
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function CopyErrorDetails(props: { text: string }): ReactNode {
  const { t } = useTranslation()
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  useEffect(() => {
    if (state !== 'copied') return
    const timer = setTimeout(() => setState('idle'), COPIED_MS)
    return () => clearTimeout(timer)
  }, [state])
  const label = {
    idle: t('errors.copyDetails'),
    copied: t('errors.copied'),
    failed: t('errors.copyFailed'),
  }[state]
  return (
    <>
      <Button
        className='mt-1.5'
        onClick={async () => setState((await writeToClipboard(props.text)) ? 'copied' : 'failed')}
      >
        {label}
      </Button>
      {state === 'failed' && (
        <pre className='mt-1 max-w-full basis-full overflow-x-auto rounded-control border border-line bg-surface-2 px-3 py-2 text-left font-mono text-xs whitespace-pre-wrap text-text-2 select-all'>
          {props.text}
        </pre>
      )}
    </>
  )
}

export function PageError(props: {
  title: string
  message: string
  traceId?: string
  details?: ErrorDetails
  onRetry: () => void
}): ReactNode {
  const { t, i18n } = useTranslation()
  const { details } = props
  return (
    <StateLayout
      icon={TriangleAlertIcon}
      tone='error'
      role='alert'
      title={props.title}
      message={props.message}
    >
      <div className='flex flex-wrap justify-center gap-2'>
        <Button variant='primary' className='mt-1.5' onClick={props.onRetry}>
          <RefreshCwIcon aria-hidden='true' />
          {t('common.tryAgain')}
        </Button>
        {details && (
          <CopyErrorDetails text={errorDetailsText({ ...props, details }, i18n.language)} />
        )}
      </div>
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
