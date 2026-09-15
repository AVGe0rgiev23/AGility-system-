import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  artifactRef,
  artifactSet,
  deliverable,
  estimateResult,
  issuePaths,
  phase,
  project,
  projectScope,
  roundTrip,
  task,
  timeEntry,
  usageRunCostLineItem,
} from './__fixtures__/records'
import type { DeliveryModel } from './company'
import type { EstimateResult, ROIResult, RunCostResult } from './results'
import type { RunCostLineItem } from './run-cost'
import {
  ArtifactRefSchema,
  ArtifactSetSchema,
  DeliverableSchema,
  PhaseSchema,
  ProjectSchema,
  ProjectScopeSchema,
  TaskSchema,
  TimeEntrySchema,
  type ArtifactRef,
  type ArtifactSet,
  type Deliverable,
  type Project,
  type ProjectScope,
  type Task,
} from './scope'

describe('DeliverableSchema and PhaseSchema', () => {
  it('accept valid records', () => {
    expect(DeliverableSchema.parse(deliverable())).toEqual(deliverable())
    expect(PhaseSchema.parse(phase())).toEqual(phase())
  })

  it('store a deliverable with no acceptance criteria, since the render gate refuses it later', () => {
    expect(issuePaths(DeliverableSchema, { ...deliverable(), acceptanceCriteria: [] })).toEqual([])
  })

  it('require acceptanceCriteria to be a list of strings', () => {
    const { acceptanceCriteria: _omitted, ...withoutCriteria } = deliverable()
    expect(issuePaths(DeliverableSchema, withoutCriteria)).toEqual(['acceptanceCriteria'])
    expect(issuePaths(DeliverableSchema, { ...deliverable(), acceptanceCriteria: 'works' })).toEqual([
      'acceptanceCriteria',
    ])
  })
})

describe('ProjectScopeSchema', () => {
  it('accepts a scope with cached engine results', () => {
    expect(ProjectScopeSchema.parse(projectScope())).toEqual(projectScope())
  })

  it('accepts a scope that has not been computed yet', () => {
    const uncomputed = { ...projectScope(), estimate: null, runCost: null, roi: null }
    expect(issuePaths(ProjectScopeSchema, uncomputed)).toEqual([])
  })

  it('accepts a null support retainer but not a missing one', () => {
    expect(issuePaths(ProjectScopeSchema, { ...projectScope(), supportRetainerMonthly: null })).toEqual([])
    const { supportRetainerMonthly: _omitted, ...withoutRetainer } = projectScope()
    expect(issuePaths(ProjectScopeSchema, withoutRetainer)).toEqual(['supportRetainerMonthly'])
  })

  it('rejects an unknown delivery model', () => {
    expect(issuePaths(ProjectScopeSchema, { ...projectScope(), deliveryModel: 'self-hosted' })).toEqual([
      'deliveryModel',
    ])
  })

  it('applies the run-cost item rules to its own line items', () => {
    const { usageFormula: _omitted, ...withoutFormula } = usageRunCostLineItem()
    expect(issuePaths(ProjectScopeSchema, { ...projectScope(), runCostItems: [withoutFormula] })).toEqual([
      'runCostItems.0.usageFormula',
    ])
  })

  it('validates cached results rather than trusting them', () => {
    const corrupt = { ...projectScope(), estimate: { ...estimateResult(), flags: ['OVERPRICED'] } }
    expect(issuePaths(ProjectScopeSchema, corrupt)).toEqual(['estimate.flags.0'])
  })

  it('survives a JSON round trip unchanged', () => {
    expect(ProjectScopeSchema.parse(roundTrip(projectScope()))).toEqual(projectScope())
  })

  it('infers the spec types', () => {
    expectTypeOf<ProjectScope['deliveryModel']>().toEqualTypeOf<DeliveryModel>()
    expectTypeOf<ProjectScope['supportRetainerMonthly']>().toEqualTypeOf<number | null>()
    expectTypeOf<ProjectScope['runCostItems']>().toEqualTypeOf<RunCostLineItem[]>()
    expectTypeOf<ProjectScope['estimate']>().toEqualTypeOf<EstimateResult | null>()
    expectTypeOf<ProjectScope['runCost']>().toEqualTypeOf<RunCostResult | null>()
    expectTypeOf<ProjectScope['roi']>().toEqualTypeOf<ROIResult | null>()
    expectTypeOf<Deliverable['opportunityId']>().toEqualTypeOf<string | undefined>()
  })
})

describe('ArtifactRefSchema and ArtifactSetSchema', () => {
  it('accept a template reference with overrides', () => {
    expect(ArtifactRefSchema.parse(artifactRef())).toEqual(artifactRef())
    expect(ArtifactSetSchema.parse(artifactSet())).toEqual(artifactSet())
  })

  it('require baseInputsHash on every override, so drift can be detected', () => {
    const ref = artifactRef()
    const [override] = ref.overrides
    if (override === undefined) throw new Error('fixture has an override')
    const { baseInputsHash: _omitted, ...unhashed } = override
    expect(issuePaths(ArtifactRefSchema, { ...ref, overrides: [unhashed] })).toEqual([
      'overrides.0.baseInputsHash',
    ])
  })

  it('require baseInputs and rebasedFrom, nullable, so a pre-v3 override is only ever migrated in', () => {
    const ref = artifactRef()
    const [override] = ref.overrides
    if (override === undefined) throw new Error('fixture has an override')
    const { baseInputs: _inputs, rebasedFrom: _from, ...bare } = override
    expect(issuePaths(ArtifactRefSchema, { ...ref, overrides: [bare] })).toEqual([
      'overrides.0.baseInputs',
      'overrides.0.rebasedFrom',
    ])
    const migrated = { ...override, baseInputs: null, rebasedFrom: null }
    expect(issuePaths(ArtifactRefSchema, { ...ref, overrides: [migrated] })).toEqual([])
    expect(issuePaths(ArtifactRefSchema, { ...ref, overrides: [{ ...override, rebasedFrom: 'h-old' }] })).toEqual([])
  })

  it('snapshot leaf values only: an object or array under a path is refused', () => {
    const ref = artifactRef()
    const [override] = ref.overrides
    if (override === undefined) throw new Error('fixture has an override')
    const leaves = { 'company.name': 'Rila', 'scope.deliverables': 2, 'scope.estimate': false, 'company.website': null }
    expect(issuePaths(ArtifactRefSchema, { ...ref, overrides: [{ ...override, baseInputs: leaves }] })).toEqual([])
    for (const value of [{ value: 1 }, ['a'], undefined]) {
      const baseInputs = { 'company.blendedHourlyCost': value }
      expect(issuePaths(ArtifactRefSchema, { ...ref, overrides: [{ ...override, baseInputs }] })).toEqual([
        'overrides.0.baseInputs.company.blendedHourlyCost',
      ])
    }
  })

  it('require a slot for every artifact kind, even when empty', () => {
    const { caseStudy: _omitted, ...fiveSlots } = artifactSet()
    expect(issuePaths(ArtifactSetSchema, fiveSlots)).toEqual(['caseStudy'])
  })

  it('carry no rendered text, only the template and overrides', () => {
    const parsed = ArtifactRefSchema.parse({ ...artifactRef(), html: '<p>Proposal</p>' })
    expect(parsed).not.toHaveProperty('html')
  })

  it('infer the spec types', () => {
    expectTypeOf<ArtifactRef['sentAt']>().toEqualTypeOf<string | null>()
    expectTypeOf<ArtifactSet['proposal']>().toEqualTypeOf<ArtifactRef | null>()
    expectTypeOf<keyof ArtifactSet>().toEqualTypeOf<
      'teardown' | 'proposal' | 'sow' | 'projectPlan' | 'handoverDocs' | 'caseStudy'
    >()
  })
})

describe('TaskSchema, TimeEntrySchema and ProjectSchema', () => {
  it('accept valid records', () => {
    expect(TaskSchema.parse(task())).toEqual(task())
    expect(TimeEntrySchema.parse(timeEntry())).toEqual(timeEntry())
    expect(ProjectSchema.parse(project())).toEqual(project())
  })

  it('accept unlogged actual hours as null but not as missing', () => {
    expect(issuePaths(TaskSchema, { ...task(), actualHours: 7.5 })).toEqual([])
    const { actualHours: _omitted, ...withoutActuals } = task()
    expect(issuePaths(TaskSchema, withoutActuals)).toEqual(['actualHours'])
  })

  it('reject negative estimated hours on a task', () => {
    expect(issuePaths(TaskSchema, { ...task(), estimatedHours: -1 })).toEqual(['estimatedHours'])
    expect(issuePaths(TaskSchema, { ...task(), estimatedHours: 0 })).toEqual([])
  })

  it('reject negative actual hours on a task', () => {
    expect(issuePaths(TaskSchema, { ...task(), actualHours: -0.5 })).toEqual(['actualHours'])
    expect(issuePaths(TaskSchema, { ...task(), actualHours: 0 })).toEqual([])
  })

  it('reject unknown task and project statuses', () => {
    expect(issuePaths(TaskSchema, { ...task(), status: 'cancelled' })).toEqual(['status'])
    expect(issuePaths(ProjectSchema, { ...project(), status: 'archived' })).toEqual(['status'])
  })

  it('validate nested tasks and time entries', () => {
    const invalid = { ...project(), timeLog: [{ ...timeEntry(), minutes: '90' }] }
    expect(issuePaths(ProjectSchema, invalid)).toEqual(['timeLog.0.minutes'])
  })

  it('survive a JSON round trip unchanged', () => {
    expect(ProjectSchema.parse(roundTrip(project()))).toEqual(project())
  })

  it('infer the spec types', () => {
    expectTypeOf<Task['patternId']>().toEqualTypeOf<string | undefined>()
    expectTypeOf<Task['actualHours']>().toEqualTypeOf<number | null>()
    expectTypeOf<Task['status']>().toEqualTypeOf<'todo' | 'doing' | 'blocked' | 'done'>()
    expectTypeOf<Project['status']>().toEqualTypeOf<'active' | 'paused' | 'delivered' | 'in-support'>()
    expectTypeOf<Project['deliveredAt']>().toEqualTypeOf<string | null>()
  })
})
