import { useCan } from '@mes/frontend/core'
import markUrl from '@mes/ui/brand/mark.png'
import wordmarkUrl from '@mes/ui/brand/wordmark.png'
import { cn } from '@mes/ui/lib/utils'
import { Link, useRouterState } from '@tanstack/react-router'
import { ChevronDownIcon, PanelLeftCloseIcon, PanelLeftOpenIcon } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type NavGroup, visibleNavigation } from '../navigation'
import { readPrefs, type WebPrefs, writePrefs } from '../prefs'

const NARROW_PX = 1100

function initialMode(userId: string): WebPrefs['sidebar'] {
  if (window.innerWidth < NARROW_PX) return 'rail'
  try {
    return readPrefs(localStorage, userId).sidebar
  } catch {
    return 'full'
  }
}

function saveMode(userId: string, sidebar: WebPrefs['sidebar']) {
  try {
    writePrefs(localStorage, userId, { sidebar })
  } catch {
    // the choice lasts for this page when the device keeps nothing
  }
}

const isWithin = (pathname: string, to: string) => pathname === to || pathname.startsWith(`${to}/`)

export function AppSidebar(props: { userId: string }): ReactNode {
  const { t } = useTranslation()
  const can = useCan()
  const pathname = useRouterState({ select: state => state.location.pathname })
  const [mode, setMode] = useState(() => initialMode(props.userId))
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set())
  const groups = visibleNavigation(can)
  const rail = mode === 'rail'

  function toggleMode() {
    const next = rail ? 'full' : 'rail'
    setMode(next)
    saveMode(props.userId, next)
  }

  function toggleGroup(id: string) {
    setClosed(current => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }

  const ToggleIcon = rail ? PanelLeftOpenIcon : PanelLeftCloseIcon
  const toggleLabel = rail ? t('nav.expand') : t('nav.collapse')

  return (
    <nav
      aria-label={t('nav.main')}
      className={cn(
        'sticky top-0 flex h-screen shrink-0 flex-col overflow-y-auto bg-ink text-[13.5px] text-ink-text',
        rail ? 'w-16 items-center gap-1.5 pb-4' : 'w-58 gap-px px-2.5 pb-5',
      )}
    >
      <div className={cn('flex items-center gap-1.5', rail && 'flex-col')}>
        <Link
          to='/'
          aria-label={rail ? 'EDMES' : undefined}
          className={cn(
            'flex h-14 items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent',
            !rail && 'min-w-0 flex-1 gap-2.5 px-2',
          )}
        >
          <img src={markUrl} alt='' className='block size-9.5 flex-none' />
          {!rail && <img src={wordmarkUrl} alt='EDMES' className='block h-5 w-auto flex-none' />}
        </Link>
        <button
          type='button'
          onClick={toggleMode}
          aria-label={toggleLabel}
          title={toggleLabel}
          aria-expanded={!rail}
          className='inline-flex size-8.5 flex-none items-center justify-center rounded-lg bg-[#1a2a42] text-ink-text outline-none hover:bg-ink-2 hover:text-white focus-visible:ring-2 focus-visible:ring-accent'
        >
          <ToggleIcon aria-hidden='true' className='size-4.5' />
        </button>
      </div>
      {groups.map(group =>
        rail ? (
          <RailGroup key={group.id} group={group} pathname={pathname} />
        ) : (
          <FullGroup
            key={group.id}
            group={group}
            open={!closed.has(group.id)}
            onToggle={() => toggleGroup(group.id)}
          />
        ),
      )}
    </nav>
  )
}

function FullGroup(props: { group: NavGroup; open: boolean; onToggle: () => void }): ReactNode {
  const { t } = useTranslation()
  const Icon = props.group.icon
  return (
    <>
      <button
        type='button'
        onClick={props.onToggle}
        aria-expanded={props.open}
        className='mt-1 flex h-9 w-full items-center gap-2.5 rounded-md px-2 text-left text-[13px] font-semibold text-ink-text outline-none hover:bg-ink-2 focus-visible:ring-2 focus-visible:ring-accent'
      >
        <Icon aria-hidden='true' className='size-4.5' />
        <span className='flex-1'>{t(props.group.labelKey)}</span>
        <ChevronDownIcon
          aria-hidden='true'
          className={cn('size-4 transition-transform', !props.open && '-rotate-90')}
        />
      </button>
      {props.open &&
        props.group.items.map(item => (
          <Link
            key={item.id}
            to={item.to}
            className='block h-8 truncate rounded-md pr-2.5 pl-9 leading-8 text-ink-text outline-none hover:bg-ink-2 focus-visible:ring-2 focus-visible:ring-accent'
            activeProps={{ className: 'bg-ink-2 font-semibold text-white' }}
          >
            {t(item.labelKey)}
          </Link>
        ))}
    </>
  )
}

function RailGroup(props: { group: NavGroup; pathname: string }): ReactNode {
  const { t } = useTranslation()
  const Icon = props.group.icon
  const first = props.group.items[0]
  if (!first) return null
  const active = props.group.items.some(item => isWithin(props.pathname, item.to))
  const label = t(props.group.labelKey)
  return (
    <Link
      to={first.to}
      aria-label={label}
      title={label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex size-11 items-center justify-center rounded-lg text-ink-text outline-none hover:bg-ink-2 focus-visible:ring-2 focus-visible:ring-accent',
        active && 'bg-ink-2 text-white',
      )}
    >
      <Icon aria-hidden='true' className='size-4.5' />
    </Link>
  )
}
