import { describe, expect, expectTypeOf, it } from 'vitest'
import { engagement, issuePaths, newEngagement, roundTrip } from './__fixtures__/records'
import type { Company } from './company'
import {
  EngagementSchema,
  LeadSourceSchema,
  StageSchema,
  type Engagement,
  type LeadSource,
  type Stage,
} from './engagement'
import type { ArtifactSet, Project, ProjectScope } from './scope'

describe('StageSchema and LeadSourceSchema', () => {
  it('accept exactly the spec values, keeping DECLINED distinct from LOST', () => {
    expect(StageSchema.options).toEqual([
      'LEAD',
      'TEARDOWN',
      'RESEARCH',
      'DISCOVERY',
      'QUALIFIED',
      'PROPOSAL',
      'NEGOTIATION',
      'WON',
      'IMPLEMENTATION',
      'RETAINER',
      'LOST',
      'DECLINED',
    ])
    expect(LeadSourceSchema.options).toEqual([
      'teardown',
      'inbound-form',
      'linkedin',
      'referral',
      'outbound',
      'repeat',
      'other',
    ])
  })

  it('reject anything else', () => {
    expect(StageSchema.safeParse('lead').success).toBe(false)
    expect(LeadSourceSchema.safeParse('cold-call').success).toBe(false)
  })
})

describe('EngagementSchema', () => {
  it('accepts a brand-new lead with nothing captured yet', () => {
    expect(EngagementSchema.parse(newEngagement())).toEqual(newEngagement())
  })

  it('accepts an engagement with every section populated', () => {
    expect(EngagementSchema.parse(engagement())).toEqual(engagement())
  })

  it('reports corruption deep in the tree at its exact path', () => {
    const record = engagement()
    const [first] = record.processes
    if (first === undefined) throw new Error('fixture has a process')
    const broken = { ...first, frequency: { ...first.frequency, peopleInvolved: 2 } }
    expect(issuePaths(EngagementSchema, { ...record, processes: [broken] })).toEqual([
      'processes.0.frequency.peopleInvolved',
    ])
  })

  it('validates every stage history entry', () => {
    const stageHistory = [{ stage: 'SIGNED', at: '2026-09-12T16:00:00.000Z' }]
    expect(issuePaths(EngagementSchema, { ...newEngagement(), stageHistory })).toEqual([
      'stageHistory.0.stage',
    ])
  })

  it('accepts a null next action but requires its text when present', () => {
    expect(issuePaths(EngagementSchema, { ...engagement(), nextAction: null })).toEqual([])
    expect(issuePaths(EngagementSchema, { ...engagement(), nextAction: { due: '2026-09-18' } })).toEqual([
      'nextAction.text',
    ])
  })

  it('requires next action text that is not blank, and a due date that is a real YYYY-MM-DD date', () => {
    expect(issuePaths(EngagementSchema, { ...engagement(), nextAction: { text: ' ' } })).toEqual(['nextAction.text'])
    expect(issuePaths(EngagementSchema, { ...engagement(), nextAction: { text: 'Call Marta' } })).toEqual([])
    for (const due of ['2028-02-29', '2026-12-31']) {
      expect(issuePaths(EngagementSchema, { ...engagement(), nextAction: { text: 'Call', due } }), due).toEqual([])
    }
    for (const due of ['', '2026-02-29', '2026-9-18', '18/09/2026', '2026-09-18T09:00:00Z']) {
      expect(issuePaths(EngagementSchema, { ...engagement(), nextAction: { text: 'Call', due } }), due).toEqual(['nextAction.due'])
    }
  })

  it('refuses a blank tag and a repeated tag, at the later one', () => {
    expect(issuePaths(EngagementSchema, { ...engagement(), tags: ['logistics', ' ', 'bg'] })).toEqual(['tags.1'])
    expect(issuePaths(EngagementSchema, { ...engagement(), tags: ['logistics', 'bg', 'logistics'] })).toEqual(['tags.2'])
    expect(issuePaths(EngagementSchema, { ...engagement(), tags: ['logistics', 'Logistics'] })).toEqual([])
  })

  it('reports a company rule and an engagement rule together', () => {
    const record = engagement()
    expect(issuePaths(EngagementSchema, { ...record, company: { ...record.company, name: '' }, tags: ['', ''] })).toEqual([
      'company.name',
      'tags.0',
      'tags.1',
    ])
  })

  it('requires scope and project to be present, even as null', () => {
    const { scope: _a, project: _b, ...withoutBoth } = newEngagement()
    expect(issuePaths(EngagementSchema, withoutBoth)).toEqual(['scope', 'project'])
  })

  it('carries no per-record schema version', () => {
    const parsed = EngagementSchema.parse({ ...newEngagement(), schemaVersion: 1 })
    expect(parsed).not.toHaveProperty('schemaVersion')
  })

  it('survives a JSON round trip unchanged', () => {
    expect(EngagementSchema.parse(roundTrip(engagement()))).toEqual(engagement())
  })

  it('infers the spec types', () => {
    expectTypeOf<Engagement['stage']>().toEqualTypeOf<Stage>()
    expectTypeOf<Engagement['source']>().toEqualTypeOf<LeadSource>()
    expectTypeOf<Engagement['company']>().toEqualTypeOf<Company>()
    expectTypeOf<Engagement['scope']>().toEqualTypeOf<ProjectScope | null>()
    expectTypeOf<Engagement['artifacts']>().toEqualTypeOf<ArtifactSet>()
    expectTypeOf<Engagement['project']>().toEqualTypeOf<Project | null>()
    expectTypeOf<Engagement['stageHistory'][number]>().toEqualTypeOf<{
      stage: Stage
      at: string
      note?: string | undefined
    }>()
    expectTypeOf<Engagement['nextAction']>().toEqualTypeOf<{ text: string; due?: string | undefined } | null>()
  })
})
