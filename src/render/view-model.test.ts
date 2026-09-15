import { describe, expect, it } from 'vitest'
import { canonicalJson } from '../engines/inputs-hash'
import { defaultConfig } from '../schema/config'
import {
  contact,
  deliverable,
  engagement,
  library,
  newEngagement,
  pattern,
  phase,
  scoringResult,
} from '../schema/__fixtures__/records'
import type { Engagement } from '../schema/engagement'
import type { Opportunity } from '../schema/opportunity'
import type { ScoringResult } from '../schema/results'
import type { ProjectScope } from '../schema/scope'
import { buildViewModel, type InternalScoringView, type ViewModelInput } from './view-model'

function input(overrides: Partial<ViewModelInput> = {}): ViewModelInput {
  return { engagement: engagement(), config: defaultConfig(), library: library(), ...overrides }
}

// The full fixture has one opportunity and a scope; the helpers say so once instead of asserting it everywhere.
function firstOpportunity(record: Engagement): Opportunity {
  const [first] = record.opportunities
  if (first === undefined) throw new Error('fixture has an opportunity')
  return first
}

function scopeOf(record: Engagement): ProjectScope {
  if (record.scope === null) throw new Error('fixture has a scope')
  return record.scope
}

type Row = ScoringResult['breakdown'][number]
const row = (label: string, audience: Row['audience']): Row => ({
  label,
  value: 1,
  unit: 'points',
  source: 'estimated',
  formula: 'x',
  audience,
})

function withBreakdown(rows: Row[]): ViewModelInput {
  const record = engagement()
  record.opportunities = [{ ...firstOpportunity(record), scoring: { ...scoringResult(), breakdown: rows } }]
  return input({ engagement: record })
}

// A ranking row that has been relabelled to look harmless, and a client row labelled like a
// ranking figure: the flag decides, not the words.
const ROWS = [row('Hours wasted per month', 'client'), row('Value score', 'client'), row('Annual value', 'internal')]

describe('buildViewModel audience', () => {
  it('drops breakdown rows by their audience flag, never by label, for a client model', () => {
    const model = buildViewModel(withBreakdown(ROWS))
    const scoring = model.opportunities[0]?.scoring
    expect(scoring?.breakdown.map((r) => r.label)).toEqual(['Hours wasted per month', 'Value score'])
    expect(scoring?.breakdown[0]).not.toHaveProperty('audience')
  })

  it('keeps every row for an internal model', () => {
    const model = buildViewModel({ ...withBreakdown(ROWS), audience: 'internal' })
    expect(model.opportunities[0]?.scoring?.breakdown).toHaveLength(3)
  })

  it('leaves the ranking fields out of a client model entirely, so a template naming one cannot resolve', () => {
    const scoring = buildViewModel(input()).opportunities[0]?.scoring
    expect(scoring).toBeDefined()
    for (const key of ['weightedValue', 'valueScore', 'effortScore', 'priorityIndex', 'quadrant']) {
      expect(scoring, key).not.toHaveProperty(key)
    }
    expect(scoring).toMatchObject({ annualValue: 18240, confidence: 82, hoursSavedPerMonth: 33.6 })
  })

  it('includes the ranking fields for an internal model', () => {
    const scoring = buildViewModel({ ...input(), audience: 'internal' }).opportunities[0]?.scoring as InternalScoringView
    expect(scoring).toMatchObject({ weightedValue: 22800, valueScore: 76, effortScore: 27, priorityIndex: 80.4, quadrant: 'quick-win' })
  })

  it('is client-facing by default', () => {
    expect(buildViewModel(input())).toEqual(buildViewModel({ ...input(), audience: 'client' }))
  })
})

describe('buildViewModel references', () => {
  it('resolves patterns in patternIds order, skipping ids the library does not have', () => {
    const lib = library()
    lib.patterns = [{ ...pattern(), id: 'pat-crm-sync', name: 'CRM sync' }, pattern()]
    const view = buildViewModel(input({ library: lib })).opportunities[0]
    expect(view?.patterns.map((p) => p.name)).toEqual(['Email triage', 'CRM sync'])
    expect(view?.primaryPattern?.id).toBe('pat-email-triage')
    expect(view?.patterns[0]).toEqual({
      id: 'pat-email-triage',
      name: 'Email triage',
      category: 'email',
      problem: 'Inbound requests are read and retyped by hand.',
      solution: 'Incoming email is classified and routed automatically.',
      architecture: 'Mailbox webhook, classifier, CRM write with retry.',
      clientExplanation: 'Every request lands in the right place without anyone copying it.',
      risks: ['Ambiguous emails need a human fallback'],
      complexity: 'medium',
    })
  })

  it('gives a null primary pattern when it is unset or missing from the library', () => {
    const record = engagement()
    record.opportunities = [{ ...firstOpportunity(record), primaryPatternId: 'pat-gone' }]
    expect(buildViewModel(input({ engagement: record })).opportunities[0]?.primaryPattern).toBeNull()
    record.opportunities = [{ ...firstOpportunity(record), primaryPatternId: null }]
    expect(buildViewModel(input({ engagement: record })).opportunities[0]?.primaryPattern).toBeNull()
  })

  it('lists the selected opportunities in the scope order and skips unknown ids', () => {
    const record = engagement()
    const second = { ...firstOpportunity(record), id: 'opp-2', title: 'Second' }
    record.opportunities = [firstOpportunity(record), second]
    record.scope = { ...scopeOf(record), selectedOpportunityIds: ['opp-2', 'opp-gone', 'opp-1'] }
    const scope = buildViewModel(input({ engagement: record })).scope
    expect(scope?.selected.map((o) => o.title)).toEqual(['Second', 'Automatic quote intake'])
  })

  it('attaches the opportunity title to each deliverable, or null', () => {
    const record = engagement()
    record.scope = {
      ...scopeOf(record),
      deliverables: [deliverable(), { ...deliverable(), id: 'd-2', opportunityId: undefined }, { ...deliverable(), id: 'd-3', opportunityId: 'opp-gone' }],
    }
    const deliverables = buildViewModel(input({ engagement: record })).scope?.deliverables
    expect(deliverables?.map((d) => d.opportunity)).toEqual([{ id: 'opp-1', title: 'Automatic quote intake' }, null, null])
    expect(deliverables?.[0]).not.toHaveProperty('opportunityId')
  })

  it('names the processes an opportunity spans', () => {
    expect(buildViewModel(input()).opportunities[0]?.processes).toEqual([{ id: 'proc-1', name: 'Quote request to CRM entry' }])
  })

  it('sorts phases by order without touching the input', () => {
    const record = engagement()
    const phases = [
      { ...phase(), id: 'ph-2', order: 2 },
      { ...phase(), id: 'ph-1', order: 1 },
    ]
    record.scope = { ...scopeOf(record), phases }
    expect(buildViewModel(input({ engagement: record })).scope?.phases.map((p) => p.id)).toEqual(['ph-1', 'ph-2'])
    expect(scopeOf(record).phases.map((p) => p.id)).toEqual(['ph-2', 'ph-1'])
  })

  it('lists only confirmed detected tools, and decision makers apart from contacts', () => {
    const record = engagement()
    record.company.detectedStack = [
      { name: 'HubSpot', category: 'crm', evidence: 'hs', confidence: 'high', confirmed: true },
      { name: 'Intercom', category: 'chat', evidence: 'ic', confidence: 'low', confirmed: false },
    ]
    record.contacts = [contact(), { ...contact(), id: 'ct-2', name: 'Ivan', isDecisionMaker: false }]
    const model = buildViewModel(input({ engagement: record }))
    expect(model.company.confirmedTools).toEqual([{ name: 'HubSpot', category: 'crm' }])
    expect(model.contacts.map((c) => c.name)).toEqual(['Marta Ivanova', 'Ivan'])
    expect(model.decisionMakers.map((c) => c.name)).toEqual(['Marta Ivanova'])
  })
})

describe('buildViewModel shape', () => {
  it('turns every optional into null, so a missing key is always a typo', () => {
    const model = buildViewModel(input({ engagement: newEngagement() }))
    expect(model.company).toMatchObject({
      website: null,
      employeeCount: null,
      locationCountry: null,
      blendedHourlyCost: null,
      sourceOfTruth: null,
      dataResidency: null,
      securityNotes: null,
      preferredDeliveryModel: null,
    })
    expect(model.scope).toBeNull()
    expect(model.agency.vatId).toBeNull()

    const full = buildViewModel(input())
    expect(full.contacts[0]).toEqual({ id: 'ct-1', name: 'Marta Ivanova', role: 'Operations lead', email: null, phone: null, isDecisionMaker: true })
    expect(full.processes[0]?.frequency.occurrencesPerMonth).toEqual({ value: 120, unit: 'count/month', currency: null, source: 'client-stated', note: null })
    expect(full.company.blendedHourlyCost).toEqual({ value: 16, unit: 'EUR/hour', currency: 'EUR', source: 'estimated', note: null })
    expect(full.scope?.runCostItems[0]).toMatchObject({ notes: null, usageFormula: null })
  })

  it('flattens company constraints and keeps the engine results as stored', () => {
    const model = buildViewModel(input())
    expect(model.company.compliance).toEqual(['GDPR'])
    expect(model.scope?.estimate).toEqual(engagement().scope?.estimate)
    expect(model.scope?.runCost).toEqual(engagement().scope?.runCost)
    expect(model.scope?.roi?.scenarios).toEqual(engagement().scope?.roi?.scenarios)
    expect(model.scope?.roi?.assumptions[0]).toHaveProperty('currency')
  })

  it('is plain data: it survives a JSON round trip unchanged and carries no undefined', () => {
    for (const record of [engagement(), newEngagement()]) {
      const model = buildViewModel(input({ engagement: record }))
      expect(JSON.parse(JSON.stringify(model))).toEqual(model)
      expect(canonicalJson(model)).not.toContain('undefined')
    }
  })

  it('is pure: the same input gives an equal model and the input is untouched', () => {
    const first = input()
    const before = structuredClone(first)
    const a = buildViewModel(first)
    const b = buildViewModel(first)
    expect(a).toEqual(b)
    expect(first).toEqual(before)
  })
})
