import { describe, expect, it } from 'vitest'
import { businessProcess, discoverySession, opportunity, projectScope, questionSet } from '../schema/__fixtures__/records'
import { MAPPING_TARGETS, type Answer, type DiscoverySession, type Question, type QuestionSet } from '../schema/discovery'
import type { Opportunity } from '../schema/opportunity'
import type { TracedValue } from '../schema/traced'
import {
  figureMeasure,
  initialOpportunityDraft,
  initialProcessDraft,
  newIntegration,
  newStep,
  opportunityDraftIssues,
  opportunityFromDraft,
  opportunityRemovalBlock,
  processDraftFromSession,
  processDraftIssues,
  processFromDraft,
  processRemovalBlock,
  processUsage,
  referenceIssues,
  type NewProcessDraft,
} from './process-rules'

function traced(value: number, unit: string, extra: Partial<TracedValue> = {}): TracedValue {
  return { value, unit, source: 'client-stated', ...extra }
}

function filledProcessDraft(): NewProcessDraft {
  return {
    ...initialProcessDraft(),
    name: 'Quote request to CRM entry',
    occurrencesPerMonth: traced(120, 'count/month'),
    minutesPerOccurrence: traced(12, 'minutes'),
    peopleInvolved: traced(2, 'count'),
    revenueImpact: 'direct',
  }
}

// A question set whose process questions carry the mappings the seeds use, with a session answering them.
function mappedQuestion(id: string, mapsTo: Question['mapsTo'], kind: Question['kind']): Question {
  return { id, text: `Question ${id}`, kind, required: false, ...(mapsTo === undefined ? {} : { mapsTo }), ...(kind === 'choice' ? { choices: ['direct', 'indirect', 'none'] } : {}) }
}

function sessionSet(): QuestionSet {
  return {
    ...questionSet(),
    id: 'qs-process',
    questions: [
      mappedQuestion('q-occ', 'process.frequency.occurrencesPerMonth', 'number'),
      mappedQuestion('q-min', 'process.frequency.minutesPerOccurrence', 'duration'),
      mappedQuestion('q-people', 'process.frequency.peopleInvolved', 'number'),
      mappedQuestion('q-role', 'process.roleHourlyCost', 'number'),
      mappedQuestion('q-rate', 'process.errorProfile.errorRatePercent', 'number'),
      mappedQuestion('q-cost', 'process.errorProfile.costPerError', 'number'),
      mappedQuestion('q-impact', 'process.revenueImpact', 'choice'),
      mappedQuestion('q-name', undefined, 'text'),
    ],
  }
}

function tracedAnswer(id: string, questionId: string, kind: Answer['kind'], value: number, unit: string, extra: Partial<TracedValue> = {}): Answer {
  return { id, questionId, kind, value, traced: traced(value, unit, { answerId: id, capturedAt: '2026-09-18T10:00:00.000Z', ...extra }), followUpTriggered: [], flags: [] }
}

function answeredSession(): DiscoverySession {
  return {
    ...discoverySession(),
    id: 'sess-1',
    questionSetId: 'qs-process',
    answers: [
      tracedAnswer('a-occ', 'q-occ', 'number', 90, 'count/month'),
      tracedAnswer('a-min', 'q-min', 'duration', 15, 'minutes'),
      tracedAnswer('a-people', 'q-people', 'number', 3, 'count'),
      tracedAnswer('a-role', 'q-role', 'number', 22, 'EUR/hour', { currency: 'EUR', note: 'Marta: about 22 all in' }),
      tracedAnswer('a-rate', 'q-rate', 'number', 5, 'percent'),
      tracedAnswer('a-cost', 'q-cost', 'number', 40, 'EUR', { currency: 'EUR' }),
      { id: 'a-impact', questionId: 'q-impact', kind: 'choice', value: 'indirect', followUpTriggered: [], flags: [] },
    ],
  }
}

describe('figureMeasure', () => {
  it('takes every process unit from MAPPING_TARGETS, so a figure typed here and one given in a session agree', () => {
    expect(figureMeasure('occurrencesPerMonth')).toMatchObject(MAPPING_TARGETS['process.frequency.occurrencesPerMonth'].measure ?? {})
    expect(figureMeasure('minutesPerOccurrence')).toMatchObject(MAPPING_TARGETS['process.frequency.minutesPerOccurrence'].measure ?? {})
    expect(figureMeasure('peopleInvolved')).toMatchObject(MAPPING_TARGETS['process.frequency.peopleInvolved'].measure ?? {})
    expect(figureMeasure('roleHourlyCost')).toEqual(MAPPING_TARGETS['process.roleHourlyCost'].measure)
    expect(figureMeasure('costPerError')).toEqual(MAPPING_TARGETS['process.errorProfile.costPerError'].measure)
  })

  it('bounds every share at its whole, which the schema refuses past', () => {
    for (const field of ['errorRatePercent', 'automatablePercent', 'errorReductionPercent'] as const) {
      expect(figureMeasure(field), field).toEqual({ unit: 'percent', max: 100 })
    }
  })

  it('marks money as money rather than naming a currency, which is chosen in the field', () => {
    expect(figureMeasure('roleHourlyCost')).toEqual({ money: true, per: 'hour' })
    expect(figureMeasure('costPerError')).toEqual({ money: true })
  })
})

describe('processFromDraft', () => {
  it('refuses a draft with no name, a missing figure or no revenue impact, naming each field', () => {
    const empty = initialProcessDraft()
    expect(processDraftIssues(empty).map((issue) => issue.path)).toEqual([
      'name',
      'occurrencesPerMonth',
      'minutesPerOccurrence',
      'peopleInvolved',
      'revenueImpact',
    ])
    expect(processFromDraft('proc-9', empty)).toBeNull()
  })

  it('builds a process the schema accepts, with nothing started as a silent zero', () => {
    const process = processFromDraft('proc-9', filledProcessDraft())
    expect(processDraftIssues(filledProcessDraft())).toEqual([])
    expect(process).toEqual({
      id: 'proc-9',
      name: 'Quote request to CRM entry',
      description: '',
      frequency: {
        occurrencesPerMonth: traced(120, 'count/month'),
        minutesPerOccurrence: traced(12, 'minutes'),
        peopleInvolved: traced(2, 'count'),
      },
      roleHourlyCost: null,
      steps: [],
      systemsTouched: [],
      painPoints: [],
      errorProfile: { errorRatePercent: null, costPerError: null },
      revenueImpact: 'direct',
      customerFacing: false,
    })
  })

  it('leaves out an owner and a description that were not given, since absent is the empty value', () => {
    const named = processFromDraft('proc-9', { ...filledProcessDraft(), owner: ' ', description: 'Retyped by hand.' })
    expect(named?.description).toBe('Retyped by hand.')
    expect(named && 'owner' in named).toBe(false)
    expect(processFromDraft('proc-9', { ...filledProcessDraft(), owner: 'Dispatcher' })?.owner).toBe('Dispatcher')
  })
})

describe('processDraftFromSession', () => {
  it('carries every mapped figure over with its source, note and link back to the answer', () => {
    const draft = processDraftFromSession(answeredSession(), sessionSet())
    expect(draft.occurrencesPerMonth).toEqual(traced(90, 'count/month', { answerId: 'a-occ', capturedAt: '2026-09-18T10:00:00.000Z' }))
    expect(draft.minutesPerOccurrence?.value).toBe(15)
    expect(draft.peopleInvolved?.value).toBe(3)
    expect(draft.roleHourlyCost).toMatchObject({ value: 22, unit: 'EUR/hour', currency: 'EUR', note: 'Marta: about 22 all in', answerId: 'a-role' })
    expect(draft.errorRatePercent?.value).toBe(5)
    expect(draft.costPerError).toMatchObject({ value: 40, unit: 'EUR', currency: 'EUR' })
    expect(draft.revenueImpact).toBe('indirect')
    expect(draft.fromSessionId).toBe('sess-1')
  })

  it('leaves what the session did not answer to be typed, so a half-answered session still starts a process', () => {
    const session = { ...answeredSession(), answers: answeredSession().answers.filter((answer) => answer.questionId === 'q-occ') }
    const draft = processDraftFromSession(session, sessionSet())
    expect(draft.occurrencesPerMonth?.value).toBe(90)
    expect(draft.minutesPerOccurrence).toBeNull()
    expect(draft.revenueImpact).toBe('')
    // Still refused until the rest is given, rather than quietly inventing it.
    expect(processDraftIssues(draft).map((issue) => issue.path)).toEqual(['name', 'minutesPerOccurrence', 'peopleInvolved', 'revenueImpact'])
  })

  it('names nothing from the session, since no mappable path holds a process name', () => {
    const draft = processDraftFromSession(answeredSession(), sessionSet())
    expect(draft.name).toBe('')
    expect(draft.description).toBe('')
  })

  it('ignores an answer whose question the set no longer has, and one that is unanswered', () => {
    const session = {
      ...answeredSession(),
      answers: [...answeredSession().answers, tracedAnswer('a-gone', 'q-gone', 'number', 5, 'count')],
    }
    expect(processDraftFromSession(session, sessionSet()).occurrencesPerMonth?.value).toBe(90)
    const blank = { ...answeredSession(), answers: [] }
    expect(processDraftFromSession(blank, sessionSet())).toEqual({ ...initialProcessDraft(), fromSessionId: 'sess-1' })
  })
})

describe('steps and integrations', () => {
  it('starts a step and an integration blank, so nothing is claimed that was not said', () => {
    expect(newStep('step-9')).toEqual({ id: 'step-9', action: '', isManual: true, isBottleneck: false })
    expect(newIntegration()).toEqual({ name: '', hasPublicApi: false, authAvailable: false })
  })
})

describe('opportunityFromDraft', () => {
  it('refuses a draft with no title, no process, a missing share or an unchosen effort factor', () => {
    expect(opportunityDraftIssues(initialOpportunityDraft()).map((issue) => issue.path)).toEqual([
      'title',
      'processIds',
      'automatablePercent',
      'errorReductionPercent',
      'dataReadiness',
      'volumeTier',
      'novelty',
    ])
    expect(opportunityFromDraft('opp-9', initialOpportunityDraft())).toBeNull()
  })

  it('builds an unscored opportunity, since nothing computes until the scoring engine runs', () => {
    const draft = {
      ...initialOpportunityDraft(),
      title: 'Automatic quote intake',
      processIds: ['proc-1'],
      automatablePercent: traced(70, 'percent'),
      errorReductionPercent: traced(80, 'percent'),
      dataReadiness: 'semi-structured' as const,
      volumeTier: 'medium' as const,
      novelty: 'known-pattern' as const,
    }
    expect(opportunityDraftIssues(draft)).toEqual([])
    expect(opportunityFromDraft('opp-9', draft)).toEqual({
      id: 'opp-9',
      processIds: ['proc-1'],
      title: 'Automatic quote intake',
      summary: '',
      patternIds: [],
      primaryPatternId: null,
      automatablePercent: traced(70, 'percent'),
      errorReductionPercent: traced(80, 'percent'),
      effortInputs: {
        integrations: [],
        dataReadiness: 'semi-structured',
        approvalSteps: 0,
        complianceFlags: [],
        volumeTier: 'medium',
        novelty: 'known-pattern',
        requiresHumanInLoop: false,
      },
      scoring: null,
    })
  })
})

describe('references and removal', () => {
  const linked = (ids: string[]): Opportunity => ({ ...opportunity(), processIds: ids })

  it('refuses an opportunity that names no process, since it would have no value to score', () => {
    expect(referenceIssues([businessProcess()], [linked([])])).toEqual([
      { path: 'opportunities.0.processIds', message: 'An opportunity is about at least one process' },
    ])
  })

  it('refuses an opportunity naming a process this engagement does not have, which the editor never writes', () => {
    const issues = referenceIssues([businessProcess()], [linked(['proc-1', 'proc-gone'])])
    expect(issues).toEqual([{ path: 'opportunities.0.processIds', message: "No process in this engagement has the id 'proc-gone'" }])
  })

  it('says nothing about a well-linked set', () => {
    expect(referenceIssues([businessProcess()], [linked(['proc-1'])])).toEqual([])
  })

  it('blocks removing a process an opportunity is about, naming how many', () => {
    expect(processUsage('proc-1', [linked(['proc-1']), linked(['proc-1'])])).toHaveLength(2)
    expect(processRemovalBlock('proc-1', [linked(['proc-1']), linked(['proc-1'])])).toBe('2 opportunities are about this process')
    expect(processRemovalBlock('proc-1', [linked(['proc-1'])])).toBe('1 opportunity is about this process')
    expect(processRemovalBlock('proc-1', [linked(['proc-2'])])).toBeNull()
  })

  it('blocks removing an opportunity the scope has selected, since the scope is the only record of what is priced', () => {
    const scope = { ...projectScope(), selectedOpportunityIds: ['opp-1'] }
    expect(opportunityRemovalBlock('opp-1', scope)).toBe('This opportunity is in the scope being priced')
    expect(opportunityRemovalBlock('opp-2', scope)).toBeNull()
    expect(opportunityRemovalBlock('opp-1', null)).toBeNull()
  })
})
