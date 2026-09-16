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

// Today on the clock of the machine in front of Alex, as YYYY-MM-DD. Due dates are calendar dates in
// his time zone, so "due today" must not flip over at midnight UTC.
export function localToday(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}
