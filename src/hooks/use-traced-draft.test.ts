import { describe, expect, it } from 'vitest'
import { CURRENCIES, mulberry32, pick, randomInt, randomNumber, SOURCES, type Random } from '../engines/__fixtures__/engine-fixtures'
import { TracedValueSchema, type TracedValue } from '../schema/traced'
import {
  AMBIGUOUS_NUMBER,
  assembleDraft,
  dotReadingWarning,
  draftFromValue,
  draftWarnings,
  editDraft,
  initialDraftState,
  NOT_A_NUMBER,
  parseNumberText,
  receiveValue,
  sameTraced,
  SOURCE_REQUIRED,
  unitFor,
  unitMismatch,
  VALUE_REQUIRED,
  type TracedDraft,
  type TracedField,
} from './use-traced-draft'

const MINUTES: TracedField = { unit: 'minutes' }
const HOURLY_EUR: TracedField = { currency: 'EUR', per: 'hour' }
const COST_EUR: TracedField = { currency: 'EUR' }

function parsedValue(text: string): number {
  const parsed = parseNumberText(text)
  if (parsed.kind !== 'number') throw new Error(`'${text}' did not parse: ${JSON.stringify(parsed)}`)
  return parsed.value
}

function draft(patch: Partial<TracedDraft> = {}): TracedDraft {
  return { text: '', currency: null, source: null, note: '', ...patch }
}

describe('parseNumberText, dot form', () => {
  it('treats blank text as empty', () => {
    expect(parseNumberText('')).toEqual({ kind: 'empty' })
    expect(parseNumberText('   ')).toEqual({ kind: 'empty' })
  })

  it('reads plain decimals, including a trailing or leading point mid-typing', () => {
    expect(parsedValue('12')).toBe(12)
    expect(parsedValue('12.5')).toBe(12.5)
    expect(parsedValue('1.')).toBe(1)
    expect(parsedValue('.5')).toBe(0.5)
    expect(parsedValue(' 7 ')).toBe(7)
    expect(parsedValue('007')).toBe(7)
  })

  it('reads the exponent form String(value) produces for very large and very small numbers', () => {
    expect(parsedValue('1e+21')).toBe(1e21)
    expect(parsedValue('1.5E-7')).toBe(1.5e-7)
    expect(parsedValue('5e-324')).toBe(5e-324)
  })

  it('passes a negative number through for the schema to refuse', () => {
    expect(parsedValue('-3')).toBe(-3)
  })

  it('reads negative zero as zero', () => {
    expect(Object.is(parsedValue('-0'), 0)).toBe(true)
    expect(Object.is(parsedValue('-0,0'), 0)).toBe(true)
  })
})

describe('parseNumberText, a dot before three digits', () => {
  it('reads it as the decimal point, accepts it, and warns with the thousands reading', () => {
    expect(parseNumberText('1.200')).toEqual({
      kind: 'number',
      value: 1.2,
      warning: 'Read as 1.2, not 1200. Use 1200 or 1200.00 if the dot was a thousands separator.',
    })
    expect(parseNumberText('12.345')).toEqual({ kind: 'number', value: 12.345, warning: dotReadingWarning(12.345, 12345) })
    expect(parseNumberText('999.999')).toEqual({ kind: 'number', value: 999.999, warning: dotReadingWarning(999.999, 999999) })
    expect(parseNumberText(' -1.200 ')).toEqual({ kind: 'number', value: -1.2, warning: dotReadingWarning(-1.2, -1200) })
    expect(parseNumberText('1.125')).toEqual({ kind: 'number', value: 1.125, warning: dotReadingWarning(1.125, 1125) })
  })

  it('does not warn where the dot cannot be a thousands group', () => {
    for (const text of ['0.125', '1234.567', '1.2', '1.20', '1.2000', '1200', '.125', '1.5E-7', '1e+21', '1200.50']) {
      expect(parseNumberText(text), text).toMatchObject({ kind: 'number', warning: null })
    }
  })

  it('still refuses a comma before three digits', () => {
    expect(parseNumberText('1,200')).toEqual({ kind: 'invalid', message: AMBIGUOUS_NUMBER })
  })
})

describe('parseNumberText, comma decimal', () => {
  it('reads one comma as a decimal point when nothing else could be meant', () => {
    expect(parsedValue('1200,50')).toBe(1200.5)
    expect(parsedValue('0,5')).toBe(0.5)
    expect(parsedValue('1,')).toBe(1)
    expect(parsedValue(',5')).toBe(0.5)
    expect(parsedValue('1,2')).toBe(1.2)
    expect(parsedValue('1,20')).toBe(1.2)
    expect(parsedValue(' 16,75 ')).toBe(16.75)
    expect(parsedValue('-3,5')).toBe(-3.5)
  })

  it('keeps the exact number, never truncating to two decimals', () => {
    expect(parsedValue('1,2000')).toBe(1.2)
    expect(parsedValue('1,2000')).toBe(Number('1.2000'))
    expect(parsedValue('0,123456789')).toBe(0.123456789)
    expect(parsedValue('1200,5099')).toBe(1200.5099)
    expect(parsedValue('3,14159265358979')).toBe(3.14159265358979)
  })

  it('refuses a comma followed by exactly three digits, which reads as a thousands separator in English', () => {
    for (const text of ['1,200', '0,125', '12,345', '-1,200', '999,999']) {
      expect(parseNumberText(text), text).toEqual({ kind: 'invalid', message: AMBIGUOUS_NUMBER })
    }
  })

  it('refuses more than one comma', () => {
    for (const text of ['1,200,000', '1,2,3', '1,,2']) {
      expect(parseNumberText(text), text).toEqual({ kind: 'invalid', message: AMBIGUOUS_NUMBER })
    }
  })

  it('refuses a comma and a dot together, in either order', () => {
    for (const text of ['1.200,50', '1,200.50', '1,5.0']) {
      expect(parseNumberText(text), text).toEqual({ kind: 'invalid', message: AMBIGUOUS_NUMBER })
    }
  })
})

describe('parseNumberText, not a number', () => {
  it('refuses anything else with the not-a-number message', () => {
    const texts = ['abc', '1 200', '1.200.000', '+5', '0x10', '.', '-', ',', '-,', 'e5', '1e', '12,5e3', '€12', 'Infinity', 'NaN', '1_000']
    for (const text of texts) {
      expect(parseNumberText(text), text).toEqual({ kind: 'invalid', message: NOT_A_NUMBER })
    }
  })
})

describe('unitFor and draftFromValue', () => {
  it('uses a non-money field unit as it is, and builds a money unit from the chosen currency', () => {
    expect(unitFor(MINUTES, 'GBP')).toBe('minutes')
    expect(unitFor(HOURLY_EUR, 'GBP')).toBe('GBP/hour')
    expect(unitFor(HOURLY_EUR, null)).toBe('EUR/hour')
    expect(unitFor(COST_EUR, 'USD')).toBe('USD')
  })

  it('starts a new money value in the field currency, with no source', () => {
    expect(draftFromValue(null, HOURLY_EUR)).toEqual({ text: '', currency: 'EUR', source: null, note: '' })
    expect(draftFromValue(null, MINUTES)).toEqual({ text: '', currency: null, source: null, note: '' })
  })

  it('loads a stored value as raw editable text, keeping its own currency', () => {
    const stored: TracedValue = { value: 1234.5, unit: 'GBP/hour', currency: 'GBP', source: 'client-stated', note: 'from the invoice' }
    expect(draftFromValue(stored, HOURLY_EUR)).toEqual({ text: '1234.5', currency: 'GBP', source: 'client-stated', note: 'from the invoice' })
  })
})

describe('assembleDraft', () => {
  it('builds a money value whose unit and currency follow the chosen currency', () => {
    expect(assembleDraft(draft({ text: '16,50', currency: 'GBP', source: 'client-stated' }), HOURLY_EUR, null, true)).toEqual({
      kind: 'value',
      value: { value: 16.5, unit: 'GBP/hour', currency: 'GBP', source: 'client-stated' },
    })
    expect(assembleDraft(draft({ text: '40', currency: null, source: 'estimated' }), COST_EUR, null, true)).toEqual({
      kind: 'value',
      value: { value: 40, unit: 'EUR', currency: 'EUR', source: 'estimated' },
    })
  })

  it('never gives a non-money field a currency, even from a stray draft currency or a stored one', () => {
    const stored: TracedValue = { value: 30, unit: 'EUR', currency: 'EUR', source: 'measured' }
    const result = assembleDraft(draft({ text: '12', currency: 'EUR', source: 'measured' }), MINUTES, stored, true)
    expect(result).toEqual({ kind: 'value', value: { value: 12, unit: 'minutes', source: 'measured' } })
  })

  it('keeps capturedAt and answerId from the stored value', () => {
    const stored: TracedValue = { value: 4, unit: 'minutes', source: 'client-stated', capturedAt: '2026-09-10T10:00:00.000Z', answerId: 'ans-3' }
    expect(assembleDraft(draft({ text: '5', source: 'client-stated' }), MINUTES, stored, true)).toEqual({
      kind: 'value',
      value: { value: 5, unit: 'minutes', source: 'client-stated', capturedAt: '2026-09-10T10:00:00.000Z', answerId: 'ans-3' },
    })
  })

  it('keeps a note exactly as typed and drops one of only whitespace', () => {
    const quoted = assembleDraft(draft({ text: '4', source: 'client-stated', note: ' "about 4, most weeks" ' }), MINUTES, null, true)
    expect(quoted).toMatchObject({ kind: 'value', value: { note: ' "about 4, most weeks" ' } })
    const blank = assembleDraft(draft({ text: '4', source: 'client-stated', note: '   ' }), MINUTES, null, true)
    expect(blank.kind === 'value' && 'note' in blank.value).toBe(false)
  })

  it('treats blank text as no value on an optional field and as missing on a required one', () => {
    expect(assembleDraft(draft({ source: 'measured' }), MINUTES, null, false)).toEqual({ kind: 'empty' })
    expect(assembleDraft(draft({ source: 'measured' }), MINUTES, null, true)).toEqual({ kind: 'invalid', issues: [VALUE_REQUIRED] })
  })

  it('refuses a value with no source', () => {
    expect(assembleDraft(draft({ text: '4' }), MINUTES, null, true)).toEqual({ kind: 'invalid', issues: [SOURCE_REQUIRED] })
    expect(assembleDraft(draft({ text: '1,200' }), MINUTES, null, true)).toEqual({ kind: 'invalid', issues: [AMBIGUOUS_NUMBER, SOURCE_REQUIRED] })
  })

  it("shows the schema's own message for a negative value", () => {
    const schemaIssue = TracedValueSchema.safeParse({ value: -1, unit: 'minutes', source: 'measured' }).error?.issues[0]
    expect(schemaIssue).toBeDefined()
    expect(assembleDraft(draft({ text: '-1', source: 'measured' }), MINUTES, null, true)).toEqual({
      kind: 'invalid',
      issues: [`value: ${schemaIssue?.message}`],
    })
  })

  it('refuses a field wrongly declared with a money unit and no currency, through the schema', () => {
    const result = assembleDraft(draft({ text: '4', source: 'measured' }), { unit: 'EUR/hour' }, null, true)
    expect(result).toEqual({ kind: 'invalid', issues: ["currency: currency is required for money unit 'EUR/hour'"] })
  })
})

describe('sameTraced', () => {
  const base: TracedValue = { value: 4, unit: 'minutes', source: 'measured', note: 'n', capturedAt: 'c', answerId: 'a' }

  it('compares content, not identity', () => {
    expect(sameTraced(base, { ...base })).toBe(true)
    expect(sameTraced(null, null)).toBe(true)
    expect(sameTraced(base, null)).toBe(false)
  })

  it('tells apart values that differ in any field', () => {
    const changes: Partial<TracedValue>[] = [
      { value: 5 },
      { unit: 'hours' },
      { currency: 'EUR' },
      { source: 'estimated' },
      { note: 'm' },
      { capturedAt: 'd' },
      { answerId: 'b' },
    ]
    for (const change of changes) expect(sameTraced(base, { ...base, ...change }), JSON.stringify(change)).toBe(false)
  })
})

describe('unitMismatch', () => {
  it('says nothing when the stored unit is the one the field records, in whichever currency', () => {
    expect(unitMismatch(null, MINUTES)).toBeNull()
    expect(unitMismatch({ value: 4, unit: 'minutes', source: 'measured' }, MINUTES)).toBeNull()
    expect(unitMismatch({ value: 30, unit: 'GBP/hour', currency: 'GBP', source: 'measured' }, HOURLY_EUR)).toBeNull()
  })

  it('reports a stored unit the field does not record', () => {
    expect(unitMismatch({ value: 4, unit: 'hours', source: 'measured' }, MINUTES)).toBe(
      "Stored with unit 'hours', but this field records 'minutes'. The number is used as minutes, and the next edit saves that unit.",
    )
    expect(unitMismatch({ value: 30, unit: 'hours/week', source: 'measured' }, HOURLY_EUR)).toContain("records 'EUR/hour'")
    expect(unitMismatch({ value: 30, unit: 'GBP', currency: 'GBP', source: 'measured' }, HOURLY_EUR)).toContain("records 'GBP/hour'")
    expect(unitMismatch({ value: 30, unit: 'EUR', currency: 'EUR', source: 'measured' }, MINUTES)).toContain("records 'minutes'")
  })

  it("is resolved by the next edit, which saves the field's unit", () => {
    const stored: TracedValue = { value: 4, unit: 'hours', source: 'measured' }
    const edited = assembleDraft(draftFromValue(stored, MINUTES), MINUTES, stored, true)
    expect(edited).toEqual({ kind: 'value', value: { value: 4, unit: 'minutes', source: 'measured' } })
    expect(edited.kind === 'value' && unitMismatch(edited.value, MINUTES)).toBeNull()
  })
})

describe('draftWarnings', () => {
  it('lists a stored-unit mismatch and a number read one of two ways, and nothing otherwise', () => {
    const hours: TracedValue = { value: 2, unit: 'hours', source: 'measured' }
    expect(draftWarnings('2', null, MINUTES)).toEqual([])
    expect(draftWarnings('1.200', null, MINUTES)).toEqual([dotReadingWarning(1.2, 1200)])
    expect(draftWarnings('2', hours, MINUTES)).toEqual([unitMismatch(hours, MINUTES)])
    expect(draftWarnings('1.200', hours, MINUTES)).toEqual([unitMismatch(hours, MINUTES), dotReadingWarning(1.2, 1200)])
    expect(draftWarnings('abc', null, MINUTES)).toEqual([])
  })

  it('warns on a stored 1.125 every time its field is opened, exactly as if it were typed', () => {
    // Deliberate: the warning depends on the text alone, never on whether the field was pre-filled.
    const stored: TracedValue = { value: 1.125, unit: 'minutes', source: 'measured' }
    const loaded = draftFromValue(stored, MINUTES).text
    expect(loaded).toBe('1.125')
    expect(draftWarnings(loaded, stored, MINUTES)).toEqual(draftWarnings('1.125', null, MINUTES))
    expect(draftWarnings(loaded, stored, MINUTES)).toEqual([dotReadingWarning(1.125, 1125)])
    const plain: TracedValue = { value: 1.5, unit: 'minutes', source: 'measured' }
    expect(draftWarnings(draftFromValue(plain, MINUTES).text, plain, MINUTES)).toEqual([])
  })
})

describe('receiveValue and editDraft', () => {
  const stored: TracedValue = { value: 12, unit: 'minutes', source: 'measured' }

  it('emits a valid edit', () => {
    const { emit } = editDraft(initialDraftState(stored, MINUTES), { text: '15' }, MINUTES, stored, true)
    expect(emit).toEqual({ value: 15, unit: 'minutes', source: 'measured' })
  })

  it('emits nothing for an invalid edit, and keeps the text', () => {
    const { state, emit } = editDraft(initialDraftState(stored, MINUTES), { text: '1,200' }, MINUTES, stored, true)
    expect(emit).toBeUndefined()
    expect(state.draft.text).toBe('1,200')
  })

  it('emits a dot reading that carries a warning: the warning never blocks', () => {
    const { emit } = editDraft(initialDraftState(stored, MINUTES), { text: '1.200' }, MINUTES, stored, true)
    expect(emit).toEqual({ value: 1.2, unit: 'minutes', source: 'measured' })
  })

  it('reads the same keystrokes as the same number whether the field was blank or held a value', () => {
    const typed = { text: '1.200', source: 'measured' as const }
    const large: TracedValue = { value: 1200, unit: 'minutes', source: 'measured' }
    const blank = editDraft(initialDraftState(null, MINUTES), typed, MINUTES, null, true)
    const prefilled = editDraft(initialDraftState(stored, MINUTES), typed, MINUTES, stored, true)
    const prefilledLarge = editDraft(initialDraftState(large, MINUTES), typed, MINUTES, large, true)
    for (const result of [blank, prefilled, prefilledLarge]) expect(result.emit).toEqual({ value: 1.2, unit: 'minutes', source: 'measured' })
  })

  it('reports the draft pending exactly while it is invalid, so a form never saves a value other than the one on screen', () => {
    const initial = initialDraftState(stored, MINUTES)
    expect(editDraft(initial, { text: 'abc' }, MINUTES, stored, true).pending).toBe(true)
    expect(editDraft(initial, { text: '' }, MINUTES, stored, true).pending).toBe(true)
    expect(editDraft(initialDraftState(null, MINUTES), { text: '5' }, MINUTES, null, true).pending).toBe(true)
    expect(editDraft(initial, { text: '15' }, MINUTES, stored, true).pending).toBe(false)
    expect(editDraft(initial, { text: '12' }, MINUTES, stored, true).pending).toBe(false)
    expect(editDraft(initial, { text: '' }, MINUTES, stored, false).pending).toBe(false)
    const invalid = editDraft(initial, { text: 'abc' }, MINUTES, stored, true)
    expect(editDraft(invalid.state, { text: '14' }, MINUTES, stored, true).pending).toBe(false)
  })

  it('emits nothing when the edit stands for the value the parent already holds', () => {
    expect(editDraft(initialDraftState(stored, MINUTES), { text: '12,0' }, MINUTES, stored, true).emit).toBeUndefined()
  })

  it('emits null when an optional field is cleared, and nothing when a required one is', () => {
    expect(editDraft(initialDraftState(stored, MINUTES), { text: '' }, MINUTES, stored, false).emit).toBeNull()
    expect(editDraft(initialDraftState(stored, MINUTES), { text: '' }, MINUTES, stored, true).emit).toBeUndefined()
  })

  it('keeps the typed text when the parent echoes back the value it was sent', () => {
    const typed = editDraft(initialDraftState(stored, MINUTES), { text: '1200,50' }, MINUTES, stored, true)
    expect(typed.emit).toEqual({ value: 1200.5, unit: 'minutes', source: 'measured' })
    const echoed = receiveValue(typed.state, { value: 1200.5, unit: 'minutes', source: 'measured' }, MINUTES)
    expect(echoed.draft.text).toBe('1200,50')
    expect(echoed.seen).toEqual({ value: 1200.5, unit: 'minutes', source: 'measured' })
  })

  it('never overwrites an invalid draft when the parent re-renders with its unchanged value', () => {
    const typed = editDraft(initialDraftState(stored, MINUTES), { text: 'abc' }, MINUTES, stored, true)
    const touched = { ...typed.state, touched: true }
    expect(receiveValue(touched, { ...stored }, MINUTES)).toBe(touched)
  })

  it('keeps an invalid draft typed after an emit, when the parent then echoes that emit', () => {
    const first = editDraft(initialDraftState(stored, MINUTES), { text: '15' }, MINUTES, stored, true)
    const emitted = { value: 15, unit: 'minutes', source: 'measured' } as const
    const second = editDraft(first.state, { text: '15,000' }, MINUTES, stored, true)
    expect(second.emit).toBeUndefined()
    expect(receiveValue(second.state, emitted, MINUTES).draft.text).toBe('15,000')
  })

  it('replaces the draft and clears touched when the value changes from outside', () => {
    const typed = { ...editDraft(initialDraftState(stored, MINUTES), { text: 'abc' }, MINUTES, stored, true).state, touched: true }
    const reloaded: TracedValue = { value: 30, unit: 'minutes', source: 'client-stated', note: 'reloaded' }
    const received = receiveValue(typed, reloaded, MINUTES)
    expect(received.draft).toEqual({ text: '30', currency: null, source: 'client-stated', note: 'reloaded' })
    expect(received.touched).toBe(false)
    expect(received.represented).toEqual(reloaded)
  })
})

// ---- Properties ------------------------------------------------------------------------------

const CASES = 2000

function randomField(random: Random): TracedField {
  const choice = randomInt(random, 0, 2)
  if (choice === 0) return { unit: pick(random, ['minutes', 'percent', 'count/month', 'hours/week']) }
  if (choice === 1) return { currency: pick(random, CURRENCIES), per: pick(random, ['hour', 'error', 'month']) }
  return { currency: pick(random, CURRENCIES) }
}

// Magnitudes from far below a cent to far above any invoice, so exponent forms are exercised too.
function randomMagnitude(random: Random): number {
  const kind = randomInt(random, 0, 3)
  if (kind === 0) return randomInt(random, 0, 1_000_000)
  if (kind === 1) return Number(randomNumber(random, 0, 10_000).toFixed(randomInt(random, 0, 6)))
  if (kind === 2) return randomNumber(random, 0, 1) * 10 ** randomInt(random, -12, 25)
  return pick(random, [0, Number.MIN_VALUE, Number.MAX_VALUE, 0.1 + 0.2, 1e21, 123456789.123456789])
}

function randomText(random: Random): string {
  const kind = randomInt(random, 0, 4)
  const magnitude = randomMagnitude(random)
  if (kind === 0) return String(magnitude)
  if (kind === 1) return String(magnitude).replace('.', ',')
  if (kind === 2) return `-${String(magnitude)}`
  if (kind === 3) return pick(random, ['', ' ', '1,200', '1.200,50', 'abc', '.', ',5', '1e', '12,5e3'])
  return `${String(randomInt(random, 0, 9999))},${String(randomInt(random, 0, 99999))}`
}

describe('properties', () => {
  it('every assembled value validates, and has a currency exactly when its field is money', () => {
    const random = mulberry32(0x7ace)
    let produced = 0
    for (let index = 0; index < CASES; index++) {
      const field = randomField(random)
      const candidate: TracedDraft = {
        text: randomText(random),
        currency: random() < 0.8 ? pick(random, CURRENCIES) : null,
        source: random() < 0.85 ? pick(random, SOURCES) : null,
        note: pick(random, ['', '  ', 'about 4', ' spaced ']),
      }
      const result = assembleDraft(candidate, field, null, random() < 0.5)
      if (result.kind !== 'value') continue
      produced++
      expect(TracedValueSchema.safeParse(result.value).success, `case ${index}`).toBe(true)
      expect(result.value.currency !== undefined, `case ${index}`).toBe(field.currency !== undefined)
      expect(result.value.unit, `case ${index}`).toBe(unitFor(field, result.value.currency ?? null))
    }
    // A generator that rarely produced a value would pass this property without testing it.
    expect(produced).toBeGreaterThan(CASES / 3)
  })

  it('reads String(value) back to the identical number for every non-negative finite number', () => {
    const random = mulberry32(0x57a7)
    for (let index = 0; index < CASES; index++) {
      const value = randomMagnitude(random)
      expect(Object.is(parsedValue(String(value)), value), `case ${index}: ${String(value)}`).toBe(true)
    }
  })

  it('reads a comma decimal exactly as the same digits with a point, unless three digits follow the comma', () => {
    const random = mulberry32(0xc0aa)
    for (let index = 0; index < CASES; index++) {
      const whole = String(randomInt(random, 0, 1_000_000))
      const decimals = Array.from({ length: randomInt(random, 0, 8) }, () => String(randomInt(random, 0, 9))).join('')
      const text = `${whole},${decimals}`
      const parsed = parseNumberText(text)
      if (decimals.length === 3) {
        expect(parsed, text).toEqual({ kind: 'invalid', message: AMBIGUOUS_NUMBER })
      } else {
        // A comma decimal is never a warned reading: its ambiguous form is refused outright.
        expect(parsed, text).toEqual({ kind: 'number', value: Number(`${whole}.${decimals}`), warning: null })
      }
    }
  })

  it('loads any valid value that fits its field into a draft that assembles back to it unchanged', () => {
    const random = mulberry32(0x0dd5)
    for (let index = 0; index < CASES; index++) {
      const field = randomField(random)
      const currency = field.currency === undefined ? undefined : pick(random, CURRENCIES)
      const value: TracedValue = { value: randomMagnitude(random), unit: unitFor(field, currency ?? null), source: pick(random, SOURCES) }
      if (currency !== undefined) value.currency = currency
      if (random() < 0.5) value.note = pick(random, ['about 4 hours', ' "most weeks" ', 'Marta, call 2'])
      if (random() < 0.3) value.capturedAt = '2026-09-10T10:00:00.000Z'
      if (random() < 0.3) value.answerId = `ans-${index}`
      expect(TracedValueSchema.safeParse(value).success, `case ${index}`).toBe(true)
      expect(assembleDraft(draftFromValue(value, field), field, value, random() < 0.5), `case ${index}`).toEqual({ kind: 'value', value })
    }
  })
})
