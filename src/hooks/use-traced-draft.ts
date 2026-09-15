import { useState } from 'react'
import { TracedValueSchema, type Currency, type Source, type TracedValue } from '../schema/traced'

// The editing model behind TracedInput. Every numeric input in the app goes through it, so the rules
// live here as pure functions and the component only renders them.
//
// - The field fixes the unit, never the person typing. Engines read the number as whatever the field
//   means and never parse the unit, so a minutes field saved as 'hours' would skew every figure.
// - Money is told by `currency` being set, as in the engines. A money field builds its unit from the
//   chosen currency, so unit and currency agree by construction; any other field never has one.
// - There is no default source. A silent 'client-stated' would inflate confidence and a silent
//   'default' would raise DEFAULT_COST, so nothing leaves until a source is chosen.
// - Only values that pass TracedValueSchema leave, and its messages are what is shown. This module
//   decides text syntax only.
// - Parsing keeps the exact number. Only display rounds, and the editable text is String(value),
//   never formatted output, so any stored value can be edited and read back unchanged.

export type TracedField =
  | { unit: string; currency?: undefined; per?: undefined }
  // A money field: its unit is the currency code, or `<code>/<per>`, e.g. 'EUR/hour'.
  | { currency: Currency; per?: string; unit?: undefined }

export interface TracedDraft {
  text: string
  // Set only on a money field.
  currency: Currency | null
  source: Source | null
  note: string
}

export const AMBIGUOUS_NUMBER =
  'Ambiguous number: use one decimal separator and no thousands separators, as in 1200.50 or 1200,50'
export const NOT_A_NUMBER = 'Not a number: use digits with one decimal separator, as in 1200.50 or 1200,50'
export const VALUE_REQUIRED = 'A value is required'
export const SOURCE_REQUIRED = 'Choose where this figure comes from'

// `warning` is set when the text was read one way and could have been meant another. The number
// is accepted all the same: the warning is shown beside it and never blocks.
export type ParsedNumber =
  | { kind: 'empty' }
  | { kind: 'number'; value: number; warning: string | null }
  | { kind: 'invalid'; message: string }

// The form String(value) produces for every finite number, so stored values always read back.
const DOT_FORM = /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i
const COMMA_FORM = /^-?(\d+,\d*|,\d+)$/
const SEPARATED_DIGITS = /^-?[\d.,]+$/
// One to three whole digits, not starting with zero, a dot and exactly three digits: the only shape a
// German thousands group can take ('1.200', '999.999'). '0.125' and '1234.567' cannot be one.
const DOT_GROUP_LIKE = /^-?[1-9]\d{0,2}\.\d{3}$/

export function dotReadingWarning(value: number, grouped: number): string {
  return `Read as ${String(value)}, not ${String(grouped)}. Use ${String(grouped)} or ${String(grouped)}.00 if the dot was a thousands separator.`
}

export function parseNumberText(text: string): ParsedNumber {
  const trimmed = text.trim()
  if (trimmed === '') return { kind: 'empty' }
  let normalised = trimmed
  if (trimmed.includes(',')) {
    if (!SEPARATED_DIGITS.test(trimmed)) return { kind: 'invalid', message: NOT_A_NUMBER }
    // A comma is a decimal point only when nothing else could be meant. '1.200,50' and '1,200.50'
    // mix separators, and '1,200' reads as 1200 in English but 1.2 across most of Europe: guessing
    // either risks a thousandfold error in a client's figure, so they are refused.
    if (trimmed.indexOf(',') !== trimmed.lastIndexOf(',') || trimmed.includes('.')) {
      return { kind: 'invalid', message: AMBIGUOUS_NUMBER }
    }
    if (!COMMA_FORM.test(trimmed)) return { kind: 'invalid', message: NOT_A_NUMBER }
    if (trimmed.length - trimmed.indexOf(',') - 1 === 3) return { kind: 'invalid', message: AMBIGUOUS_NUMBER }
    normalised = trimmed.replace(',', '.')
  } else if (!DOT_FORM.test(trimmed)) {
    return { kind: 'invalid', message: NOT_A_NUMBER }
  }
  const value = Number(normalised)
  // '1.200' is always the decimal 1.2, whether typed into a blank field or over a stored value, so
  // the same keystrokes always mean the same number. Refusing it would also refuse editing a stored
  // 1.125, and deciding by context would let the wrong reading slip into a proposal. So it is
  // accepted and the thousands reading is named beside it, from the text alone.
  const warning = DOT_GROUP_LIKE.test(trimmed) ? dotReadingWarning(value, Number(trimmed.replace('.', ''))) : null
  // '-0' is zero; a signed zero would survive as a distinct value until JSON silently dropped the sign.
  return { kind: 'number', value: value === 0 ? 0 : value, warning }
}

export function unitFor(field: TracedField, currency: Currency | null): string {
  if (field.currency === undefined) return field.unit
  const code = currency ?? field.currency
  return field.per === undefined ? code : `${code}/${field.per}`
}

export function draftFromValue(value: TracedValue | null, field: TracedField): TracedDraft {
  return {
    text: value === null ? '' : String(value.value),
    currency: field.currency === undefined ? null : (value?.currency ?? field.currency),
    source: value?.source ?? null,
    note: value?.note ?? '',
  }
}

export type Assembled = { kind: 'value'; value: TracedValue } | { kind: 'empty' } | { kind: 'invalid'; issues: string[] }

// `previous` is the stored value being edited: its capturedAt and answerId are kept as they were.
export function assembleDraft(draft: TracedDraft, field: TracedField, previous: TracedValue | null, required: boolean): Assembled {
  const parsed = parseNumberText(draft.text)
  if (parsed.kind === 'empty') return required ? { kind: 'invalid', issues: [VALUE_REQUIRED] } : { kind: 'empty' }
  const issues: string[] = []
  if (parsed.kind === 'invalid') issues.push(parsed.message)
  if (draft.source === null) issues.push(SOURCE_REQUIRED)
  if (parsed.kind !== 'number' || draft.source === null) return { kind: 'invalid', issues }

  const candidate: TracedValue = { value: parsed.value, unit: unitFor(field, draft.currency), source: draft.source }
  if (field.currency !== undefined) candidate.currency = draft.currency ?? field.currency
  // A note is kept exactly as typed, since it may quote the client; one of only spaces says nothing.
  if (draft.note.trim() !== '') candidate.note = draft.note
  if (previous?.capturedAt !== undefined) candidate.capturedAt = previous.capturedAt
  if (previous?.answerId !== undefined) candidate.answerId = previous.answerId

  const result = TracedValueSchema.safeParse(candidate)
  if (!result.success) {
    return { kind: 'invalid', issues: result.error.issues.map((issue) => `${issue.path.map(String).join('.')}: ${issue.message}`) }
  }
  return { kind: 'value', value: result.data }
}

export function sameTraced(a: TracedValue | null, b: TracedValue | null): boolean {
  if (a === null || b === null) return a === b
  return (
    a.value === b.value &&
    a.unit === b.unit &&
    a.currency === b.currency &&
    a.source === b.source &&
    a.note === b.note &&
    a.capturedAt === b.capturedAt &&
    a.answerId === b.answerId
  )
}

// A stored value whose unit is not the one this field records. It is shown, never silently
// reinterpreted; the number is used as the field's unit either way, and the next edit saves that unit.
export function unitMismatch(value: TracedValue | null, field: TracedField): string | null {
  if (value === null) return null
  const expected = unitFor(field, value.currency ?? null)
  if (value.unit === expected) return null
  return `Stored with unit '${value.unit}', but this field records '${expected}'. The number is used as ${expected}, and the next edit saves that unit.`
}

// Everything worth seeing about a field that does not stop it saving: a stored unit it does not record,
// and a number read one of two ways. Both come from what is there now, typed or loaded alike, and show
// at once, since the value is already in use.
export function draftWarnings(text: string, value: TracedValue | null, field: TracedField): string[] {
  const parsed = parseNumberText(text)
  const reading = parsed.kind === 'number' ? parsed.warning : null
  return [unitMismatch(value, field), reading].filter((warning): warning is string => warning !== null)
}

export interface DraftState {
  draft: TracedDraft
  touched: boolean
  // The value most recently received from the parent.
  seen: TracedValue | null
  // The value the draft stands for: the one loaded into it, or the last one it produced.
  represented: TracedValue | null
}

export function initialDraftState(value: TracedValue | null, field: TracedField): DraftState {
  return { draft: draftFromValue(value, field), touched: false, seen: value, represented: value }
}

// Called with the parent's value on every render. The draft is replaced only when that value changes
// to something the draft does not stand for, so a parent echoing back what it was sent never resets
// the text ('1200,50' stays as typed), and an invalid draft is never overwritten while being typed.
// This assumes the parent applies onChange before the next keystroke, as synchronous React state does.
// Returns the same object when nothing changes.
export function receiveValue(state: DraftState, value: TracedValue | null, field: TracedField): DraftState {
  if (sameTraced(value, state.seen)) return state
  if (sameTraced(value, state.represented)) return { ...state, seen: value }
  return { draft: draftFromValue(value, field), touched: false, seen: value, represented: value }
}

// `emit` is what to hand to onChange: a value, null for a cleared optional field, or undefined when
// the draft is invalid or stands for what the parent already holds.
export function editDraft(
  state: DraftState,
  patch: Partial<TracedDraft>,
  field: TracedField,
  value: TracedValue | null,
  required: boolean,
): { state: DraftState; emit: TracedValue | null | undefined } {
  const draft = { ...state.draft, ...patch }
  const assembled = assembleDraft(draft, field, value, required)
  if (assembled.kind === 'invalid') return { state: { ...state, draft }, emit: undefined }
  const next = assembled.kind === 'value' ? assembled.value : null
  return { state: { ...state, draft, represented: next }, emit: sameTraced(next, value) ? undefined : next }
}

export interface TracedDraftOptions {
  value: TracedValue | null
  field: TracedField
  required: boolean
  onChange: (next: TracedValue | null) => void
}

export function useTracedDraft({ value, field, required, onChange }: TracedDraftOptions) {
  const [stored, setStored] = useState(() => initialDraftState(value, field))
  const state = receiveValue(stored, value, field)
  if (state !== stored) setStored(state)

  const edit = (patch: Partial<TracedDraft>) => {
    const result = editDraft(state, patch, field, value, required)
    setStored(result.state)
    if (result.emit !== undefined) onChange(result.emit)
  }

  const assembled = assembleDraft(state.draft, field, value, required)
  return {
    draft: state.draft,
    unit: unitFor(field, state.draft.currency),
    // Shown once the field has been left, so a half-typed number is not an error mid-keystroke.
    issues: state.touched && assembled.kind === 'invalid' ? assembled.issues : [],
    warnings: draftWarnings(state.draft.text, value, field),
    setText: (text: string) => edit({ text }),
    setCurrency: (currency: Currency) => edit({ currency }),
    setSource: (source: Source) => edit({ source }),
    setNote: (note: string) => edit({ note }),
    touch: () => {
      if (!state.touched) setStored({ ...state, touched: true })
    },
  }
}
