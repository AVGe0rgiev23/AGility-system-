import { describe, expect, it } from 'vitest'
import { newEngagement } from '../schema/__fixtures__/records'
import { EngagementSchema, type Engagement } from '../schema/engagement'
import {
  buildNewEngagement,
  filterEngagements,
  initialNewEngagement,
  NO_FILTER,
  SOURCE_REQUIRED,
  stageOrder,
  tagOptions,
} from './use-engagement-list'

const TODAY = '2026-09-17'

function withNext(id: string, patch: Partial<Engagement>): Engagement {
  return { ...newEngagement(), id, ...patch }
}

const engagements: Engagement[] = [
  withNext('overdue', { stage: 'PROPOSAL', tags: ['logistics', 'bg'], nextAction: { text: 'Chase', due: '2026-09-10' } }),
  withNext('today', { stage: 'LEAD', tags: ['bg'], nextAction: { text: 'Call', due: TODAY } }),
  withNext('later', { stage: 'LEAD', tags: [], nextAction: { text: 'Send teardown', due: '2026-10-01' } }),
  withNext('undated', { stage: 'DISCOVERY', tags: ['Retail'], nextAction: { text: 'Book a call' } }),
  withNext('none', { stage: 'LOST', tags: ['logistics'], nextAction: null }),
]

const ids = (list: readonly Engagement[]) => list.map((item) => item.id)

describe('filterEngagements', () => {
  it('keeps everything with no filter', () => {
    expect(ids(filterEngagements(engagements, NO_FILTER, TODAY))).toEqual(['overdue', 'today', 'later', 'undated', 'none'])
  })

  it('filters by stage and by tag', () => {
    expect(ids(filterEngagements(engagements, { ...NO_FILTER, stage: 'LEAD' }, TODAY))).toEqual(['today', 'later'])
    expect(ids(filterEngagements(engagements, { ...NO_FILTER, tag: 'logistics' }, TODAY))).toEqual(['overdue', 'none'])
  })

  it('filters by next action: with one, without one, or due today or earlier', () => {
    expect(ids(filterEngagements(engagements, { ...NO_FILTER, nextAction: 'with' }, TODAY))).toEqual(['overdue', 'today', 'later', 'undated'])
    expect(ids(filterEngagements(engagements, { ...NO_FILTER, nextAction: 'without' }, TODAY))).toEqual(['none'])
    expect(ids(filterEngagements(engagements, { ...NO_FILTER, nextAction: 'due' }, TODAY))).toEqual(['overdue', 'today'])
  })

  it('combines every filter', () => {
    expect(ids(filterEngagements(engagements, { stage: 'PROPOSAL', tag: 'bg', nextAction: 'due' }, TODAY))).toEqual(['overdue'])
    expect(ids(filterEngagements(engagements, { stage: 'LEAD', tag: 'logistics', nextAction: 'any' }, TODAY))).toEqual([])
  })
})

describe('tagOptions and stageOrder', () => {
  it('lists each tag in use once, in reading order', () => {
    expect(tagOptions(engagements)).toEqual(['bg', 'logistics', 'Retail'])
    expect(tagOptions([])).toEqual([])
  })

  it('orders stages as the pipeline runs', () => {
    expect(stageOrder('LEAD')).toBeLessThan(stageOrder('PROPOSAL'))
    expect(stageOrder('PROPOSAL')).toBeLessThan(stageOrder('WON'))
    expect(stageOrder('RETAINER')).toBeLessThan(stageOrder('DECLINED'))
  })
})

describe('buildNewEngagement', () => {
  const NOW = '2026-09-17T09:30:00.000Z'

  it('starts with a visible EUR currency and LEAD stage, and no source or name', () => {
    expect(initialNewEngagement()).toEqual({ name: '', industry: '', currency: 'EUR', source: null, stage: 'LEAD' })
  })

  it('builds a valid empty engagement whose history starts at the chosen stage', () => {
    const built = buildNewEngagement({ name: 'Solo Bakery', industry: 'E-commerce', currency: 'GBP', source: 'referral', stage: 'TEARDOWN' }, 'id-1', NOW)
    if (!built.ok) throw new Error(JSON.stringify(built.issues))
    expect(EngagementSchema.parse(built.engagement)).toEqual(built.engagement)
    expect(built.engagement).toMatchObject({
      id: 'id-1',
      createdAt: NOW,
      updatedAt: NOW,
      company: { name: 'Solo Bakery', industry: 'E-commerce', currency: 'GBP', blendedHourlyCost: null },
      contacts: [],
      stage: 'TEARDOWN',
      source: 'referral',
      stageHistory: [{ stage: 'TEARDOWN', at: NOW }],
      scope: null,
      project: null,
      tags: [],
      nextAction: null,
    })
    const shape = newEngagement()
    expect(Object.keys(built.engagement).sort()).toEqual(Object.keys(shape).sort())
    expect(built.engagement.artifacts).toEqual(shape.artifacts)
  })

  it('refuses a missing source and a blank name at their paths, together', () => {
    const built = buildNewEngagement({ ...initialNewEngagement(), name: '  ' }, 'id-1', NOW)
    expect(built).toEqual({
      ok: false,
      issues: [
        { path: 'source', message: SOURCE_REQUIRED },
        { path: 'company.name', message: 'The company needs a name' },
      ],
    })
  })
})
