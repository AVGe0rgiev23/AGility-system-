import { InlineStat, type InlineStatProps } from './inline-stat'

export type StatProps = { label: string } & InlineStatProps

// A headline figure: a label above an InlineStat at a larger size. Not a card: one rule on the left.
export function Stat({ label, ...figure }: StatProps) {
  return (
    <div role="group" aria-label={label} className="flex min-w-0 flex-col gap-0.5 border-l px-3 py-1">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-lg">
        <InlineStat {...figure} />
      </span>
    </div>
  )
}
