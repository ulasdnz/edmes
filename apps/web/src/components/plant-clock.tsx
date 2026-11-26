import { formatInstant, type ServerClock } from '@mes/frontend/time'
import { cn } from '@mes/ui/lib/utils'
import { type ReactNode, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const MINUTE_MS = 60_000

const minuteOf = (clock: ServerClock) => Math.floor(clock.now().getTime() / MINUTE_MS)

// Checked every second, drawn again only when the minute changes
export function PlantClock(props: {
  clock: ServerClock
  timeZone: string
  className?: string
  timeClassName?: string
}): ReactNode {
  const { t, i18n } = useTranslation()
  const [minute, setMinute] = useState(() => minuteOf(props.clock))
  useEffect(() => {
    setMinute(minuteOf(props.clock))
    const timer = setInterval(() => setMinute(minuteOf(props.clock)), 1000)
    return () => clearInterval(timer)
  }, [props.clock])
  const time = formatInstant(new Date(minute * MINUTE_MS).toISOString(), {
    timeZone: props.timeZone,
    locale: i18n.language,
    style: 'time',
  })
  return (
    <span className={cn('whitespace-nowrap', props.className)}>
      {t('topbar.plantTime')} <span className={props.timeClassName}>{time}</span> · {props.timeZone}
    </span>
  )
}
