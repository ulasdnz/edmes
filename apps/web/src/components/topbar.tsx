import { useAppCore, useRealtimeStatus, useSession } from '@mes/frontend/core'
import type { RealtimeStatus } from '@mes/frontend/realtime'
import type { SessionStatus } from '@mes/frontend/session'
import { formatInstant, type ServerClock } from '@mes/frontend/time'
import { ConnectionIndicator } from '@mes/ui/components/connection-indicator'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@mes/ui/components/dropdown-menu'
import { ChevronDownIcon, LogOutIcon } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

type Indicator = 'live' | 'reconnecting' | 'offline'

function indicatorFor(session: SessionStatus, realtime: RealtimeStatus): Indicator {
  if (session === 'unreachable' || realtime === 'unavailable') return 'offline'
  if (realtime === 'connecting' || realtime === 'reconnecting') return 'reconnecting'
  return 'live'
}

// The moment the session found the server unreachable; the realtime client keeps its own.
function useUnreachableSince(status: SessionStatus): Date | null {
  const unreachable = status === 'unreachable'
  const [since, setSince] = useState<Date | null>(() => (unreachable ? new Date() : null))
  useEffect(() => {
    setSince(current => (unreachable ? (current ?? new Date()) : null))
  }, [unreachable])
  return unreachable ? since : null
}

function PlantClock(props: { clock: ServerClock; timeZone: string }): ReactNode {
  const { t, i18n } = useTranslation()
  const [now, setNow] = useState(() => props.clock.toIso())
  useEffect(() => {
    const timer = setInterval(() => setNow(props.clock.toIso()), 1000)
    return () => clearInterval(timer)
  }, [props.clock])
  const time = formatInstant(now, {
    timeZone: props.timeZone,
    locale: i18n.language,
    style: 'time',
  })
  return (
    <span className='text-[13px] whitespace-nowrap text-text-3'>
      {t('topbar.plantTime')} <span className='font-semibold text-text-2'>{time}</span> ·{' '}
      {props.timeZone}
    </span>
  )
}

function initials(name: string, surname: string): string {
  return `${name.charAt(0)}${surname.charAt(0)}`.toLocaleUpperCase()
}

export function Topbar(): ReactNode {
  const { t, i18n } = useTranslation()
  const { session } = useAppCore()
  const { status, user, plantTimezone, serverClock } = useSession()
  const realtime = useRealtimeStatus()
  const unreachableSince = useUnreachableSince(status)

  const indicator = indicatorFor(status, realtime.status)
  let label = t('common.live')
  if (indicator === 'reconnecting') label = t('common.reconnecting')
  if (indicator === 'offline') {
    const candidates = [unreachableSince, realtime.status === 'unavailable' ? realtime.since : null]
    const since =
      candidates.reduce<Date | null>(
        (earliest, value) => (value && (!earliest || value < earliest) ? value : earliest),
        null,
      ) ?? new Date()
    const time = formatInstant(since.toISOString(), {
      timeZone: plantTimezone ?? 'UTC',
      locale: i18n.language,
      style: 'time',
    })
    label = t('common.offlineSince', { time })
  }

  return (
    <header className='flex min-h-14 flex-wrap items-center gap-x-3.5 gap-y-2 border-b border-line bg-surface px-6 py-2'>
      <ConnectionIndicator status={indicator} label={label} />
      {serverClock && plantTimezone && <PlantClock clock={serverClock} timeZone={plantTimezone} />}
      <span className='flex-1' />
      {user && (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={t('topbar.userMenu')}
            className='inline-flex h-9 items-center gap-2 rounded-[18px] pr-2 pl-1 text-[13.5px] font-medium text-text outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent'
          >
            <span
              aria-hidden='true'
              className='inline-flex size-6.5 items-center justify-center rounded-full bg-accent-bg text-[11px] font-semibold text-accent-hover'
            >
              {initials(user.name, user.surname)}
            </span>
            <span>
              {user.name} {user.surname}
            </span>
            <ChevronDownIcon aria-hidden='true' className='size-4 text-text-3' />
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' className='w-56'>
            <div className='px-3 pt-2 pb-2.5'>
              <div className='font-semibold'>
                {user.name} {user.surname}
              </div>
              <div className='text-[13px] text-text-3'>{user.email}</div>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={session.logout}>
              <LogOutIcon aria-hidden='true' />
              {t('topbar.logOut')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </header>
  )
}
