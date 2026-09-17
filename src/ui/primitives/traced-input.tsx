import { useEffect, useId, useRef, type FocusEvent } from 'react'
import { useTracedDraft, type TracedField } from '../../hooks/use-traced-draft'
import { CurrencySchema, SourceSchema, type Currency, type TracedValue } from '../../schema/traced'
import { Field, fieldDescriptionId } from './field'

// What the field measures. `unit` for anything that is not money; `currency` (the default for a new
// value, usually the company's) with an optional `per` for money, e.g. currency="EUR" per="hour".
type Measure = { unit: string; currency?: undefined; per?: undefined } | { currency: Currency; per?: string; unit?: undefined }

// A required field can never be cleared to null, so its callback never receives one.
type Requirement = { required: true; onChange: (next: TracedValue) => void } | { required?: false; onChange: (next: TracedValue | null) => void }

export type TracedInputProps = {
  label: string
  value: TracedValue | null
  hint?: string
  // True while the text on screen is invalid and so has not reached onChange; see useTracedDraft.
  onPendingChange?: (pending: boolean) => void
  // Written on the value box as data-config-path, for a form that places issues by path.
  path?: string
} & Measure &
  Requirement

const CONTROL = 'h-6 rounded-sm border bg-bg px-1.5 text-sm text-fg'

// Every numeric input in the app: value, currency, source and note in one row. The rules are in
// use-traced-draft; this renders them. The value box shows raw editable text, never formatted output.
export function TracedInput(props: TracedInputProps) {
  const id = useId()
  const valueId = `${id}-value`
  const field: TracedField = props.currency === undefined ? { unit: props.unit } : { currency: props.currency, per: props.per }
  const required = props.required === true

  const emit = (next: TracedValue | null) => {
    if (props.required === true) {
      if (next !== null) props.onChange(next)
    } else {
      props.onChange(next)
    }
  }
  const { draft, unit, issues, warnings, setText, setCurrency, setSource, setNote, touch } = useTracedDraft({
    value: props.value,
    field,
    required,
    onChange: emit,
    onPendingChange: props.onPendingChange,
  })
  const invalid = issues.length > 0

  // A box that is gone disagrees with nothing: it takes its half-typed text with it, so it stops
  // blocking Save. Otherwise leaving the tab, or answering a question that hides this one, would leave
  // the form refusing to save with no field on screen to fix.
  const told = useRef(props.onPendingChange)
  told.current = props.onPendingChange
  useEffect(() => () => told.current?.(false), [])

  // Issues appear once focus leaves the whole row, not when moving from the value to its source.
  const leaveRow = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget
    if (!(next instanceof Node) || !event.currentTarget.contains(next)) touch()
  }

  return (
    <Field label={props.label} htmlFor={valueId} hint={props.hint} warnings={warnings} issues={issues} required={required}>
      <div className="flex min-w-0 items-center gap-1.5" onBlur={leaveRow}>
        <input
          id={valueId}
          data-config-path={props.path}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={draft.text}
          onChange={(event) => setText(event.target.value)}
          aria-invalid={invalid}
          aria-required={required}
          aria-describedby={fieldDescriptionId(valueId)}
          className={`${CONTROL} num w-28 text-right ${invalid ? 'border-danger' : ''}`}
        />
        {field.currency === undefined ? (
          <span className="num text-sm text-muted">{unit}</span>
        ) : (
          <>
            <select
              aria-label={`${props.label} currency`}
              value={draft.currency ?? field.currency}
              onChange={(event) => {
                const parsed = CurrencySchema.safeParse(event.target.value)
                if (parsed.success) setCurrency(parsed.data)
              }}
              className={`${CONTROL} num`}
            >
              {CurrencySchema.options.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </select>
            {field.per === undefined ? null : <span className="num text-sm text-muted">/{field.per}</span>}
          </>
        )}
        <select
          aria-label={`${props.label} source`}
          value={draft.source ?? ''}
          onChange={(event) => {
            const parsed = SourceSchema.safeParse(event.target.value)
            if (parsed.success) setSource(parsed.data)
          }}
          className={`${CONTROL} ${draft.source === null ? 'text-muted' : ''}`}
        >
          <option value="" disabled>
            source
          </option>
          {SourceSchema.options.map((source) => (
            <option key={source} value={source}>
              {source}
            </option>
          ))}
        </select>
        <input
          type="text"
          aria-label={`${props.label} note`}
          placeholder="note: what the client said"
          value={draft.note}
          onChange={(event) => setNote(event.target.value)}
          className={`${CONTROL} min-w-0 flex-1`}
        />
      </div>
    </Field>
  )
}
