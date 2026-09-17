import type { Currency, TracedValue } from '../schema/traced'

// Display only. A fixed locale, so every screen and every test prints the same text whatever the
// browser's language. Its grouping commas are deliberate: editable fields never show this output.
// They show String(value), because typed input refuses '1,200' as ambiguous (use-traced-draft).
const MONEY = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const PLAIN = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 })

// Money is told by its currency alone, as in the engines.
export function formatNumber(value: number, currency?: Currency): string {
  return (currency === undefined ? PLAIN : MONEY).format(value)
}

export function formatTraced(traced: TracedValue): string {
  return `${formatNumber(traced.value, traced.currency)} ${traced.unit}`
}

// True when the display drops digits the stored number has, so the exact value must be one hover away.
export function isRounded(value: number, currency?: Currency): boolean {
  return Number(formatNumber(value, currency).replace(/,/g, '')) !== value
}

// A moment as the calendar date on the machine in front of Alex, YYYY-MM-DD; today by default. Due
// dates are calendar dates in his time zone, so "due today" must not flip over at midnight UTC.
export function localDate(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

// The same moment as a datetime-local box writes it, to the minute. A session is held at a wall-clock
// time in the room, and stored as the instant it names.
export function localDateTime(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${localDate(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}`
}

const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

// The instant such a box now names, or null while it names none. Text without a zone is local time,
// which is what the box means. Read part by part, because Date rolls the 30th of February over into
// March rather than refusing it.
export function fromLocalDateTime(text: string): string | null {
  const match = LOCAL_DATE_TIME.exec(text)
  if (match === null) return null
  const [year, month, day, hour, minute] = [1, 2, 3, 4, 5].map((group) => Number(match[group]))
  const at = new Date(year ?? NaN, (month ?? NaN) - 1, day ?? NaN, hour ?? NaN, minute ?? NaN)
  if (Number.isNaN(at.getTime())) return null
  // A wall-clock time that does not exist, such as the hour a clock skips forward, keeps the moment it
  // rolls to. A calendar date that does not exist is refused.
  return at.getFullYear() === year && at.getMonth() === (month ?? NaN) - 1 && at.getDate() === day ? at.toISOString() : null
}
