import { describe, expect, it } from 'vitest'
import { runCostLineItem, usageRunCostLineItem } from '../schema/__fixtures__/records'
import { defaultConfig, type Config } from '../schema/config'
import { CONFIG_RULE_BREAKS } from './__fixtures__/config-rule-breaks'
import {
  addBand,
  addIndustry,
  addRunCostItem,
  canSave,
  discardChanges,
  formIssues,
  hasChanges,
  hasUnsavedEdits,
  initialConfigForm,
  issuesByPath,
  leafPaths,
  locatedPaths,
  moveBand,
  moveIndustry,
  moveRunCostItem,
  numberReading,
  numberText,
  numberWarnings,
  otherProblems,
  READ_ONLY_PATHS,
  removeBand,
  removeIndustry,
  removeRunCostItem,
  setChoice,
  setFlag,
  setNumberText,
  setText,
  setUsageBased,
  startFromDefaults,
  textIssues,
  type ConfigFormState,
} from './use-config-form'
import { AMBIGUOUS_NUMBER, dotReadingWarning, NOT_A_NUMBER, VALUE_REQUIRED } from './use-traced-draft'

function draftOf(state: ConfigFormState): Config {
  if (state.draft === null) throw new Error('expected a draft')
  return state.draft
}

function withRunCost(...items: Config['runCostDefaults']): Config {
  return { ...defaultConfig(), runCostDefaults: items }
}

function issuePaths(state: ConfigFormState): string[] {
  return formIssues(state).map((issue) => issue.path)
}

describe('initialConfigForm', () => {
  it('starts with the draft as saved, nothing typed and nothing to save', () => {
    const saved = defaultConfig()
    const state = initialConfigForm(saved)
    expect(state).toEqual({ saved, draft: saved, texts: {} })
    expect(hasChanges(state)).toBe(false)
    expect(hasUnsavedEdits(state)).toBe(false)
    expect(canSave(state)).toBe(false)
    expect(formIssues(state)).toEqual([])
  })

  it('shows stored numbers as String(value), and an unset band limit as empty text', () => {
    const state = initialConfigForm(defaultConfig())
    expect(numberText(state, 'pricing.targetHourlyRate')).toBe('65')
    expect(numberText(state, 'estimation.overheads.deployment')).toBe('0.08')
    expect(numberText(state, 'pricing.bands.2.maxHours')).toBe('')
    expect(numberText(state, 'pricing.bands.2.floor')).toBe('')
  })
})

describe('number fields', () => {
  it('keeps the text as typed and puts the number it reads as into the draft', () => {
    const state = setNumberText(initialConfigForm(defaultConfig()), 'pricing.targetHourlyRate', '72,5')
    expect(numberText(state, 'pricing.targetHourlyRate')).toBe('72,5')
    expect(draftOf(state).pricing.targetHourlyRate).toBe(72.5)
    expect(numberReading(state, 'pricing.targetHourlyRate')).toBe(72.5)
    expect(hasChanges(state)).toBe(true)
    expect(canSave(state)).toBe(true)
  })

  it('never lets text that does not parse reach the draft, and blocks saving with its message', () => {
    const saved = defaultConfig()
    for (const [text, message] of [
      ['1,200', AMBIGUOUS_NUMBER],
      ['sixty', NOT_A_NUMBER],
    ] as const) {
      const state = setNumberText(initialConfigForm(saved), 'pricing.targetHourlyRate', text)
      expect(draftOf(state)).toEqual(saved)
      expect(numberReading(state, 'pricing.targetHourlyRate')).toBeNull()
      expect(formIssues(state)).toEqual([{ path: 'pricing.targetHourlyRate', message }])
      expect(hasChanges(state)).toBe(false)
      expect(hasUnsavedEdits(state)).toBe(true)
      expect(canSave(state)).toBe(false)
    }
  })

  it('requires a value in a field that cannot be empty', () => {
    const state = setNumberText(initialConfigForm(defaultConfig()), 'roi.horizonYears', '  ')
    expect(draftOf(state).roi.horizonYears).toBe(3)
    expect(formIssues(state)).toEqual([{ path: 'roi.horizonYears', message: VALUE_REQUIRED }])
    expect(canSave(state)).toBe(false)
  })

  it('reads empty text on a band limit as null, the stored meaning of no limit or no price', () => {
    const state = setNumberText(initialConfigForm(defaultConfig()), 'pricing.bands.0.ceiling', '')
    expect(draftOf(state).pricing.bands[0]?.ceiling).toBeNull()
    expect(textIssues(state)).toEqual([])
    expect(formIssues(state)).toEqual([
      { path: 'pricing.bands.0.ceiling', message: "Band 'pilot' needs a ceiling; only the custom band has no price" },
    ])
  })

  it('shows only the text issue at a field whose text does not parse, not a schema issue about the last number that did', () => {
    let state = setNumberText(initialConfigForm(defaultConfig()), 'pricing.bands.1.floor', '5000')
    expect(issuePaths(state)).toEqual(['pricing.bands.1.floor'])
    state = setNumberText(state, 'pricing.bands.1.floor', '5.000,00')
    expect(formIssues(state)).toEqual([{ path: 'pricing.bands.1.floor', message: AMBIGUOUS_NUMBER }])
  })

  it('warns about a dot before three digits from the text alone, typed or stored', () => {
    const typed = setNumberText(initialConfigForm(defaultConfig()), 'pricing.targetHourlyRate', '1.200')
    expect(draftOf(typed).pricing.targetHourlyRate).toBe(1.2)
    expect(numberWarnings(typed, 'pricing.targetHourlyRate')).toEqual([dotReadingWarning(1.2, 1200)])
    expect(canSave(typed)).toBe(true)

    const stored = defaultConfig()
    stored.fxRates.rates.GBP = 1.175
    expect(numberWarnings(initialConfigForm(stored), 'fxRates.rates.GBP')).toEqual([dotReadingWarning(1.175, 1175)])
    expect(numberWarnings(initialConfigForm(stored), 'fxRates.rates.USD')).toEqual([])
  })

  it('emits the same number for the same keystrokes, blank or pre-filled', () => {
    const blank = setNumberText(setNumberText(initialConfigForm(defaultConfig()), 'pricing.bands.2.floor', ''), 'pricing.bands.2.floor', '1.125')
    const prefilled = setNumberText(initialConfigForm(defaultConfig()), 'pricing.bands.0.floor', '1.125')
    expect(draftOf(blank).pricing.bands[2]?.floor).toBe(1.125)
    expect(draftOf(prefilled).pricing.bands[0]?.floor).toBe(1.125)
  })

  it('refuses a path that is not a number field, or is read-only', () => {
    const state = initialConfigForm(defaultConfig())
    expect(() => setNumberText(state, 'agency.name', '1')).toThrow("There is no number field at 'agency.name'")
    expect(() => setNumberText(state, 'pricing.targetHourlyRat', '1')).toThrow('There is no number field')
    expect(() => setNumberText(state, 'estimation.contingency.x', '1')).toThrow('There is no number field')
    expect(() => setNumberText(state, 'fxRates.rates.EUR', '1')).toThrow("'fxRates.rates.EUR' is read-only in Settings")
  })
})

describe('text, choice and flag fields', () => {
  it('sets text and choices in place, leaving the saved Config untouched', () => {
    const saved = defaultConfig()
    let state = setText(initialConfigForm(saved), 'agency.email', 'alex@agility.dev')
    state = setChoice(state, 'ai.provider', 'local')
    state = setFlag(state, 'storage.autoSyncOnWrite', false)
    state = setText(state, 'industries.1', 'SaaS')
    expect(draftOf(state).agency.email).toBe('alex@agility.dev')
    expect(draftOf(state).ai.provider).toBe('local')
    expect(draftOf(state).storage.autoSyncOnWrite).toBe(false)
    expect(draftOf(state).industries[1]).toBe('SaaS')
    expect(saved).toEqual(defaultConfig())
  })

  it('adds an optional text when typed and removes the key when cleared', () => {
    const initial = initialConfigForm(defaultConfig())
    const typed = setText(initial, 'agency.vatId', 'BG123456789')
    expect(draftOf(typed).agency.vatId).toBe('BG123456789')
    const cleared = setText(typed, 'agency.vatId', '')
    expect('vatId' in draftOf(cleared).agency).toBe(false)
    expect(hasChanges(cleared)).toBe(false)
  })

  it('refuses the wrong kind of field and every read-only path', () => {
    const state = initialConfigForm(defaultConfig())
    expect(() => setText(state, 'pricing.targetHourlyRate', '65')).toThrow('There is no text field')
    expect(() => setFlag(state, 'ai.provider', true)).toThrow('There is no flag')
    for (const path of Object.keys(READ_ONLY_PATHS)) {
      expect(() => setText(state, path, 'x'), path).toThrow('read-only')
    }
  })

  it('reports an option outside the schema at its path rather than accepting it', () => {
    const state = setChoice(initialConfigForm(defaultConfig()), 'ai.provider', 'gpt')
    expect(issuePaths(state)).toEqual(['ai.provider'])
    expect(canSave(state)).toBe(false)
  })
})

describe('bands', () => {
  it('adds an empty band before the trailing unbounded band, which the rules then describe', () => {
    const state = addBand(initialConfigForm(defaultConfig()))
    expect(draftOf(state).pricing.bands.map((band) => band.id)).toEqual(['pilot', 'full-workflow', '', 'custom'])
    expect(formIssues(state)).toEqual([{ path: 'pricing.bands', message: 'Exactly one band must have no max hours; found 2' }])
    const typed = setNumberText(state, 'pricing.bands.2.maxHours', '120')
    expect(issuePaths(typed)).toEqual(['pricing.bands.2.floor', 'pricing.bands.2.ceiling'])
  })

  it('appends a band when the last band is not unbounded', () => {
    const config = defaultConfig()
    config.pricing.bands = config.pricing.bands.slice(0, 2)
    expect(draftOf(addBand(initialConfigForm(config))).pricing.bands.map((band) => band.id)).toEqual(['pilot', 'full-workflow', ''])
  })

  it('removes and moves bands, keeping the rest in order', () => {
    const initial = initialConfigForm(defaultConfig())
    expect(draftOf(removeBand(initial, 0)).pricing.bands.map((band) => band.id)).toEqual(['full-workflow', 'custom'])
    expect(draftOf(moveBand(initial, 0, 1)).pricing.bands.map((band) => band.id)).toEqual(['full-workflow', 'pilot', 'custom'])
    expect(draftOf(moveBand(initial, 2, -1)).pricing.bands.map((band) => band.id)).toEqual(['pilot', 'custom', 'full-workflow'])
    expect(draftOf(moveBand(initial, 0, -1)).pricing.bands.map((band) => band.id)).toEqual(['pilot', 'full-workflow', 'custom'])
    expect(draftOf(moveBand(initial, 2, 1)).pricing.bands.map((band) => band.id)).toEqual(['pilot', 'full-workflow', 'custom'])
  })

  it('drops typed text under the bands when they are added, removed or moved, and nowhere else', () => {
    let state = setNumberText(initialConfigForm(defaultConfig()), 'pricing.bands.0.floor', 'abc')
    state = setNumberText(state, 'pricing.targetHourlyRate', 'xyz')
    for (const edited of [addBand(state), removeBand(state, 1), moveBand(state, 0, 1)]) {
      expect(edited.texts).toEqual({ 'pricing.targetHourlyRate': 'xyz' })
    }
    const moved = moveBand(state, 0, 1)
    expect(numberText(moved, 'pricing.bands.1.floor')).toBe('600')
  })
})

describe('industries', () => {
  it('adds an empty industry at the end, removes and moves them', () => {
    const initial = initialConfigForm(defaultConfig())
    expect(draftOf(addIndustry(initial)).industries).toEqual([...defaultConfig().industries, ''])
    expect(draftOf(removeIndustry(initial, 0)).industries).toEqual(['Software / Tech', 'E-commerce', 'Operations / Logistics'])
    expect(draftOf(moveIndustry(initial, 3, -1)).industries).toEqual(['Professional Services', 'Software / Tech', 'Operations / Logistics', 'E-commerce'])
  })
})

describe('run-cost defaults', () => {
  it('adds an item with the given id and no monthly cost, which blocks saving until one is typed, never a silent zero', () => {
    const state = addRunCostItem(initialConfigForm(defaultConfig()), 'rc-new')
    expect(draftOf(state).runCostDefaults).toEqual([
      {
        id: 'rc-new',
        label: '',
        category: 'other',
        monthlyCost: null,
        paidBy: { 'fully-managed': 'agency', 'client-owned': 'client', hybrid: 'client' },
        usageBased: false,
      },
    ])
    expect(state.texts).toEqual({})
    expect(numberText(state, 'runCostDefaults.0.monthlyCost')).toBe('')
    expect(formIssues(state)).toEqual([{ path: 'runCostDefaults.0.monthlyCost', message: 'monthlyCost is required when usageBased is false' }])
    expect(canSave(state)).toBe(false)
    expect(canSave(setNumberText(state, 'runCostDefaults.0.monthlyCost', '12'))).toBe(true)
  })

  it('needs no monthly cost on a usage-based item, and reads a cleared one as null', () => {
    const cleared = setNumberText(initialConfigForm(withRunCost({ ...usageRunCostLineItem(), monthlyCost: 40 })), 'runCostDefaults.0.monthlyCost', '')
    expect(draftOf(cleared).runCostDefaults[0]?.monthlyCost).toBeNull()
    expect(formIssues(cleared)).toEqual([])
    expect(canSave(cleared)).toBe(true)

    // Turning usage pricing off leaves the cost empty, so a cost has to be chosen rather than inherited.
    const fixed = setUsageBased(cleared, 0, false)
    expect(draftOf(fixed).runCostDefaults[0]?.monthlyCost).toBeNull()
    expect(formIssues(fixed)).toEqual([{ path: 'runCostDefaults.0.monthlyCost', message: 'monthlyCost is required when usageBased is false' }])
  })

  it('refuses a cleared monthly cost on a fixed item at its field', () => {
    const state = setNumberText(initialConfigForm(withRunCost(runCostLineItem())), 'runCostDefaults.0.monthlyCost', ' ')
    expect(draftOf(state).runCostDefaults[0]?.monthlyCost).toBeNull()
    expect(formIssues(state)).toEqual([{ path: 'runCostDefaults.0.monthlyCost', message: 'monthlyCost is required when usageBased is false' }])
  })

  it('turns usage pricing on with five empty formula fields, each a blocking value required', () => {
    const state = setUsageBased(initialConfigForm(withRunCost(runCostLineItem())), 0, true)
    const keys = ['callsPerMonth', 'avgInputTokens', 'avgOutputTokens', 'inputPricePerMTok', 'outputPricePerMTok']
    expect(draftOf(state).runCostDefaults[0]?.usageBased).toBe(true)
    for (const key of keys) expect(numberText(state, `runCostDefaults.0.usageFormula.${key}`)).toBe('')
    expect(formIssues(state)).toEqual(keys.map((key) => ({ path: `runCostDefaults.0.usageFormula.${key}`, message: VALUE_REQUIRED })))
    expect(canSave(state)).toBe(false)

    const filled = keys.reduce((current, key, index) => setNumberText(current, `runCostDefaults.0.usageFormula.${key}`, String(index + 1)), state)
    expect(draftOf(filled).runCostDefaults[0]?.usageFormula).toEqual({
      callsPerMonth: 1,
      avgInputTokens: 2,
      avgOutputTokens: 3,
      inputPricePerMTok: 4,
      outputPricePerMTok: 5,
    })
    expect(canSave(filled)).toBe(true)
  })

  it('keeps an existing formula when usage pricing is turned on', () => {
    const item = { ...usageRunCostLineItem(), usageBased: false }
    const state = setUsageBased(initialConfigForm(withRunCost(item)), 0, true)
    expect(draftOf(state).runCostDefaults[0]?.usageFormula).toEqual(usageRunCostLineItem().usageFormula)
    expect(state.texts).toEqual({})
  })

  it('removes the formula and its typed text when usage pricing is turned off', () => {
    let state = setUsageBased(initialConfigForm(withRunCost(runCostLineItem(), runCostLineItem())), 1, true)
    state = setNumberText(state, 'runCostDefaults.0.monthlyCost', 'abc')
    state = setUsageBased(state, 1, false)
    expect(draftOf(state).runCostDefaults[1]).toEqual(runCostLineItem())
    expect(state.texts).toEqual({ 'runCostDefaults.0.monthlyCost': 'abc' })
  })

  it('removes and moves items, dropping typed text under the list', () => {
    const second = { ...runCostLineItem(), id: 'rc-second' }
    const state = setNumberText(initialConfigForm(withRunCost(runCostLineItem(), second)), 'runCostDefaults.1.monthlyCost', '')
    expect(draftOf(removeRunCostItem(state, 0)).runCostDefaults.map((item) => item.id)).toEqual(['rc-second'])
    expect(draftOf(moveRunCostItem(state, 1, -1)).runCostDefaults.map((item) => item.id)).toEqual(['rc-second', 'rc-hosting'])
    expect(moveRunCostItem(state, 1, -1).texts).toEqual({})
  })

  it('edits notes as optional text', () => {
    const state = setText(initialConfigForm(withRunCost(runCostLineItem())), 'runCostDefaults.0.notes', 'Fly.io, one machine')
    expect(draftOf(state).runCostDefaults[0]?.notes).toBe('Fly.io, one machine')
    expect(draftOf(setText(state, 'runCostDefaults.0.notes', '')).runCostDefaults[0]).toEqual(runCostLineItem())
  })
})

describe('issue placement', () => {
  it('raises exactly the listed issues for each broken rule, every one at a located path', () => {
    for (const { rule, apply, paths } of CONFIG_RULE_BREAKS) {
      const draft = defaultConfig()
      apply(draft)
      const state: ConfigFormState = { saved: defaultConfig(), draft, texts: {} }
      const issues = formIssues(state)
      expect(issues.map((issue) => issue.path).sort(), rule).toEqual([...paths].sort())
      const located = locatedPaths(draft)
      for (const issue of issues) expect(located.has(issue.path), `${rule}: ${issue.path}`).toBe(true)
      expect(otherProblems(draft, issues), rule).toEqual([])
      expect(canSave(state), rule).toBe(false)
    }
  })

  it('lists an issue with no located path as another problem, so it is never hidden', () => {
    const issues = [
      { path: '', message: 'root' },
      { path: 'pricing.bands.0.floor', message: 'placed' },
      { path: 'pricing.bands.9.floor', message: 'no such band' },
    ]
    expect(otherProblems(defaultConfig(), issues)).toEqual([issues[0], issues[2]])
    expect(otherProblems(null, issues)).toEqual([])
  })

  it('locates every leaf, every list and each run-cost formula', () => {
    const draft = withRunCost(usageRunCostLineItem(), runCostLineItem())
    const located = locatedPaths(draft)
    for (const path of ['agencyCurrency', 'fxRates.rates.GBP', 'pricing.bands.2.maxHours', 'runCostDefaults.0.usageFormula.callsPerMonth', 'runCostDefaults.0.paidBy.hybrid', 'storage.lastSyncAt']) {
      expect(located.has(path), path).toBe(true)
    }
    for (const path of ['industries', 'pricing.bands', 'runCostDefaults', 'runCostDefaults.0.usageFormula']) {
      expect(located.has(path), path).toBe(true)
    }
    // An item that is not usage-based and has no formula has no formula to show an issue at.
    expect(located.has('runCostDefaults.1.usageFormula')).toBe(false)
    const { usageFormula: _dropped, ...formulaMissing } = usageRunCostLineItem()
    expect(locatedPaths(withRunCost(formulaMissing)).has('runCostDefaults.0.usageFormula')).toBe(true)
    expect(located.has('pricing')).toBe(false)
    expect(leafPaths({ a: [1, { b: null }], c: 'x' })).toEqual(['a.0', 'a.1.b', 'c'])
  })

  it('groups messages by path', () => {
    const byPath = issuesByPath([
      { path: 'a', message: 'one' },
      { path: 'b', message: 'two' },
      { path: 'a', message: 'three' },
    ])
    expect(byPath.get('a')).toEqual(['one', 'three'])
    expect(byPath.get('b')).toEqual(['two'])
    expect(byPath.get('c')).toBeUndefined()
  })
})

describe('an unusable stored Config', () => {
  it('has no draft and nothing to save until defaults are chosen, which only fill the draft', () => {
    const corrupt = initialConfigForm(null)
    expect(corrupt.draft).toBeNull()
    expect(formIssues(corrupt)).toEqual([])
    expect(canSave(corrupt)).toBe(false)
    expect(setNumberText(corrupt, 'pricing.targetHourlyRate', '70')).toBe(corrupt)

    const seeded = startFromDefaults(corrupt)
    expect(seeded.saved).toBeNull()
    expect(seeded.draft).toEqual(defaultConfig())
    expect(hasChanges(seeded)).toBe(true)
    expect(canSave(seeded)).toBe(true)
    expect(discardChanges(seeded)).toEqual(corrupt)
  })
})

describe('saving', () => {
  it('needs a change, no text issues and a valid schema', () => {
    const initial = initialConfigForm(defaultConfig())
    expect(canSave(initial)).toBe(false)
    const changed = setNumberText(initial, 'scoring.valueCeiling', '40000')
    expect(canSave(changed)).toBe(true)
    expect(canSave(setNumberText(changed, 'roi.horizonYears', ''))).toBe(false)
    expect(canSave(setNumberText(changed, 'scoring.effortCeiling', '0'))).toBe(false)
  })

  it('has nothing to save once an edit is typed back to the saved value', () => {
    const state = setNumberText(setNumberText(initialConfigForm(defaultConfig()), 'pricing.targetHourlyRate', '70'), 'pricing.targetHourlyRate', '65.0')
    expect(hasChanges(state)).toBe(false)
    expect(hasUnsavedEdits(state)).toBe(false)
    expect(canSave(state)).toBe(false)
  })

  it('discards every edit and typed text back to the saved Config', () => {
    const saved = defaultConfig()
    const state = setNumberText(setText(initialConfigForm(saved), 'agency.name', 'Other'), 'pricing.targetHourlyRate', 'abc')
    expect(discardChanges(state)).toEqual(initialConfigForm(saved))
  })
})
