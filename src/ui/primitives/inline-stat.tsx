import type { Currency, TracedValue } from '../../schema/traced'
import { formatNumber, isRounded } from '../format'
import { ConfidenceBadge, type Basis } from './confidence-badge'

// A figure on one line: number, unit and what it rests on. The props make a bare number
// unrepresentable: a captured figure brings its source, a computed one its confidence.
export type InlineStatProps =
  | { traced: TracedValue | null }
  | { value: number | null; unit: string; currency?: Currency; confidence: number }

interface Figure {
  value: number
  unit: string
  currency: Currency | undefined
  basis: Basis
}

function figureOf(props: InlineStatProps): Figure | null {
  if ('traced' in props) {
    const { traced } = props
    if (traced === null) return null
    return { value: traced.value, unit: traced.unit, currency: traced.currency, basis: { source: traced.source, note: traced.note } }
  }
  if (props.value === null) return null
  return { value: props.value, unit: props.unit, currency: props.currency, basis: { confidence: props.confidence } }
}

export function InlineStat(props: InlineStatProps) {
  const figure = figureOf(props)
  if (figure === null) {
    const reason = 'traced' in props ? 'Not captured' : 'No figure'
    return (
      <span className="num text-muted" title={reason}>
        <span aria-hidden="true">—</span>
        <span className="sr-only">{reason}</span>
      </span>
    )
  }
  const rounded = isRounded(figure.value, figure.currency)
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className="num" title={rounded ? `Exact value: ${String(figure.value)}` : undefined}>
        {formatNumber(figure.value, figure.currency)}
      </span>
      <span className="num text-muted">{figure.unit}</span>
      <ConfidenceBadge {...figure.basis} />
    </span>
  )
}
