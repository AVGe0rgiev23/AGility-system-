import { LOW_CONFIDENCE_THRESHOLD } from '../../engines/scoring'
import type { Source } from '../../schema/traced'

// What a displayed number rests on: the source of a captured figure, or the confidence of a
// computed one. Every number on screen carries one of these.
export type Basis = { source: Source; note?: string } | { confidence: number }

const SOURCE_CODES: Record<Source, string> = {
  'client-stated': 'CLIENT',
  measured: 'MEASURED',
  estimated: 'EST',
  default: 'DEFAULT',
}

const BADGE = 'inline-flex h-4 shrink-0 items-center rounded-sm border px-1 num text-xs leading-none'

export function ConfidenceBadge(props: Basis) {
  if ('confidence' in props) {
    const low = props.confidence < LOW_CONFIDENCE_THRESHOLD
    const label = low
      ? `Confidence ${props.confidence} of 100, below ${LOW_CONFIDENCE_THRESHOLD}: warn before it reaches a proposal`
      : `Confidence ${props.confidence} of 100`
    return (
      <span className={`${BADGE} ${low ? 'text-warn' : 'text-muted'}`} title={label}>
        <span aria-hidden="true">CONF {props.confidence}</span>
        <span className="sr-only">{label}</span>
      </span>
    )
  }

  const hasNote = props.note !== undefined && props.note.trim() !== ''
  const label = hasNote ? `Source: ${props.source}. Note: ${props.note}` : `Source: ${props.source}`
  // A default is a made-up figure (ENGINES §1.3 penalises it hardest), so it stands out.
  const tone = props.source === 'default' ? 'text-warn' : props.source === 'estimated' ? 'text-muted' : 'text-fg'
  return (
    <span className={`${BADGE} ${tone}`} title={label}>
      <span aria-hidden="true">
        {SOURCE_CODES[props.source]}
        {hasNote ? '*' : ''}
      </span>
      <span className="sr-only">{label}</span>
    </span>
  )
}
