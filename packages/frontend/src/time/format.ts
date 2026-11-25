import { tzOffset } from '@date-fns/tz'

const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/
const PLANT_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/
const DAY_MS = 24 * 60 * 60 * 1000
const MINUTE_MS = 60 * 1000

export function isUtcInstant(value: string): boolean {
  return UTC_INSTANT.test(value) && !Number.isNaN(Date.parse(value))
}

const STYLES: Record<'date' | 'time' | 'dateTime', Intl.DateTimeFormatOptions> = {
  date: { year: 'numeric', month: '2-digit', day: '2-digit' },
  time: { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
  dateTime: {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  },
}

export function formatInstant(
  iso: string,
  options: { timeZone: string; locale: string; style: 'date' | 'time' | 'dateTime' },
): string {
  return new Intl.DateTimeFormat(options.locale, {
    ...STYLES[options.style],
    timeZone: options.timeZone,
  }).format(new Date(iso))
}

// Resolved with explicit rules, not the machine's: a local time that does not exist (clocks go
// forward) uses the offset before the change, so it lands after it; a local time that happens
// twice (clocks go back) resolves to the first occurrence.
export function plantLocalToInstant(local: string, timeZone: string): string {
  const match = PLANT_LOCAL.exec(local)
  if (!match) throw new RangeError(`Not a plant-local time (YYYY-MM-DDTHH:mm): ${local}`)
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ]
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute)
  const offsetBefore = tzOffset(timeZone, new Date(localAsUtc - DAY_MS))
  const offsetAfter = tzOffset(timeZone, new Date(localAsUtc + DAY_MS))
  if (Number.isNaN(offsetBefore) || Number.isNaN(offsetAfter)) {
    throw new RangeError(`Unknown time zone: ${timeZone}`)
  }
  const valid = [offsetBefore, offsetAfter]
    .map(offset => localAsUtc - offset * MINUTE_MS)
    .filter(instant => tzOffset(timeZone, new Date(instant)) * MINUTE_MS === localAsUtc - instant)
  const instant = valid.length > 0 ? Math.min(...valid) : localAsUtc - offsetBefore * MINUTE_MS
  return new Date(instant).toISOString()
}
