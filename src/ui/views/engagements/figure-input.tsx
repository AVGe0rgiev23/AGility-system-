import { figureMeasure, type FigureField } from '../../../hooks/process-rules'
import type { Currency, TracedValue } from '../../../schema/traced'
import { TracedInput } from '../../primitives/traced-input'

// A figure on the process and opportunity screens, recorded in the unit its field fixes. The unit and
// any bound come from figureMeasure, which reads MAPPING_TARGETS, so a figure typed here and one given
// in a discovery session are recorded the same way and no screen restates a unit of its own.
//
// Written as four explicit branches: TracedInput's props are a union over money and requiredness, and
// spreading a computed one would trade that check for a cast.

interface Shared {
  field: FigureField
  label: string
  hint?: string
  path?: string
  value: TracedValue | null
  // Where a money figure starts: the company's currency, changeable in the field.
  currency: Currency
  onPendingChange?: (pending: boolean) => void
}

export type FigureInputProps = Shared & ({ required: true; onChange: (next: TracedValue) => void } | { required?: false; onChange: (next: TracedValue | null) => void })

export function FigureInput(props: FigureInputProps) {
  const measure = figureMeasure(props.field)
  const shared = { label: props.label, hint: props.hint, path: props.path, value: props.value, onPendingChange: props.onPendingChange }
  if (props.required === true) {
    return measure.money === true ? (
      <TracedInput {...shared} currency={props.currency} per={measure.per} required onChange={props.onChange} />
    ) : (
      <TracedInput {...shared} unit={measure.unit} max={measure.max} required onChange={props.onChange} />
    )
  }
  return measure.money === true ? (
    <TracedInput {...shared} currency={props.currency} per={measure.per} onChange={props.onChange} />
  ) : (
    <TracedInput {...shared} unit={measure.unit} max={measure.max} onChange={props.onChange} />
  )
}
