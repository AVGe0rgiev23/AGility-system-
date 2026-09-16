import { useId } from 'react'
import { Field, fieldDescriptionId } from './field'

// A plain number, for the values Alex defines in Config: rates, bands, factors. A figure that came
// from a client goes through TracedInput instead, since it needs a source. This one parses nothing:
// the parent parses the text with parseNumberText and passes back the warnings and issues, so both
// inputs read the same keystrokes as the same number.

export interface NumberInputProps {
  label: string
  // The Config path this edits. Written on the control as data-config-path, so every issue can be
  // traced to the control that fixes it.
  path: string
  // Raw editable text, never display output, so any stored value reads back unchanged.
  text: string
  unit?: string
  hint?: string
  warnings?: readonly string[]
  issues?: readonly string[]
  required?: boolean
  layout?: 'row' | 'cell'
  onText: (text: string) => void
}

const CONTROL = 'h-6 rounded-sm border bg-bg px-1.5 text-sm text-fg'

export function NumberInput({ label, path, text, unit, hint, warnings, issues = [], required = false, layout = 'row', onText }: NumberInputProps) {
  const id = useId()
  const invalid = issues.length > 0
  return (
    <Field label={label} htmlFor={id} hint={hint} warnings={warnings} issues={issues} required={required} layout={layout}>
      <div className="flex min-w-0 items-center gap-1.5">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          data-config-path={path}
          value={text}
          onChange={(event) => onText(event.target.value)}
          aria-invalid={invalid}
          aria-required={required}
          aria-describedby={fieldDescriptionId(id)}
          className={`${CONTROL} num w-24 text-right ${invalid ? 'border-danger' : ''}`}
        />
        {unit === undefined ? null : <span className="num text-sm whitespace-nowrap text-muted">{unit}</span>}
      </div>
    </Field>
  )
}
