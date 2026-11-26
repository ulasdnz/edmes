import { useAppCore, useConnection, useSession } from '@mes/frontend/core'
import { myProfileOptions } from '@mes/frontend/data/user/me'
import { formatInstant } from '@mes/frontend/time'
import { ConnectionIndicator } from '@mes/ui/components/connection-indicator'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@mes/ui/components/dropdown-menu'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ChevronDownIcon, LogOutIcon, UserIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { PlantClock } from './plant-clock'
import { UserAvatar } from './user-avatar'

// The names of the user's roles, once they are read; nothing while they load or fail
function RoleLine(): ReactNode {
  const { api } = useAppCore()
  const profile = useQuery(myProfileOptions(api))
  const names = profile.data?.roles.map(role => role.name) ?? []
  if (names.length === 0) return null
  return <div className='text-[12.5px] text-text-3'>{names.join(', ')}</div>
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
            <UserAvatar
              name={user.name}
              surname={user.surname}
              photoUrl={user.photoUrl}
              className='size-6.5 text-[11px]'
            />
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
              <RoleLine />
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link to='/profile' />}>
              <UserIcon aria-hidden='true' />
              {t('topbar.profile')}
            </DropdownMenuItem>
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
