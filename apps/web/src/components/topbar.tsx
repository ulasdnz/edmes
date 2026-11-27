import { useAppCore, useConnection, useSession } from '@mes/frontend/core'
import { formatInstant } from '@mes/frontend/time'
import { ConnectionIndicator } from '@mes/ui/components/connection-indicator'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@mes/ui/components/dropdown-menu'
import { ChevronDownIcon, LogOutIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { PlantClock } from './plant-clock'

function initials(name: string, surname: string): string {
  return `${name.charAt(0)}${surname.charAt(0)}`.toLocaleUpperCase()
}

export function Topbar(): ReactNode {
  const { t, i18n } = useTranslation()
  const { session } = useAppCore()
  const { user, plantTimezone, serverClock } = useSession()
  const connection = useConnection()

  let label = t('common.live')
  if (connection.status === 'reconnecting') label = t('common.reconnecting')
  if (connection.status === 'offline') {
    const time = formatInstant((connection.since ?? new Date()).toISOString(), {
      timeZone: plantTimezone ?? 'UTC',
      locale: i18n.language,
      style: 'time',
    })
    label = t('common.offlineSince', { time })
  }

  return (
    <header className='flex min-h-14 flex-wrap items-center gap-x-3.5 gap-y-2 border-b border-line bg-surface px-6 py-2'>
      <ConnectionIndicator status={connection.status} label={label} />
      {serverClock && plantTimezone && (
        <PlantClock
          clock={serverClock}
          timeZone={plantTimezone}
          className='text-[13px] text-text-3'
          timeClassName='font-semibold text-text-2'
        />
      )}
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
