import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  calibrationRecord,
  documentTemplate,
  issuePaths,
  library,
  pattern,
  question,
  questionSet,
  roundTrip,
} from './__fixtures__/records'
import type { Blueprint } from './blueprint'
import type { QuestionSet } from './discovery'
import {
  CalibrationRecordSchema,
  DocumentTemplateSchema,
  LibrarySchema,
  PatternSchema,
  TemplateSectionSchema,
  type CalibrationRecord,
  type DocumentTemplate,
  type Library,
  type Pattern,
} from './library'

describe('PatternSchema', () => {
  it('accepts a pattern with a blueprint skeleton', () => {
    expect(PatternSchema.parse(pattern())).toEqual(pattern())
  })

  it('accepts a pattern without a skeleton', () => {
    expect(issuePaths(PatternSchema, { ...pattern(), blueprintSkeleton: null })).toEqual([])
  })

  it('keeps no id or opportunityId on the skeleton', () => {
    const withIds = { ...pattern(), blueprintSkeleton: { ...pattern().blueprintSkeleton, id: 'bp-1', opportunityId: 'opp-1' } }
    const parsed = PatternSchema.parse(withIds)
    expect(parsed.blueprintSkeleton).not.toHaveProperty('id')
    expect(parsed.blueprintSkeleton).not.toHaveProperty('opportunityId')
  })

  it('validates the skeleton nodes like any blueprint', () => {
    const skeleton = { name: 'Broken', nodes: [{ id: 'n', kind: 'loop', name: 'x', purpose: 'y', requiresApproval: false }], edges: [] }
    expect(issuePaths(PatternSchema, { ...pattern(), blueprintSkeleton: skeleton })).toEqual([
      'blueprintSkeleton.nodes.0.kind',
    ])
  })

  it('rejects an unknown complexity and a non-numeric baseHours', () => {
    expect(issuePaths(PatternSchema, { ...pattern(), complexity: 'extreme' })).toEqual(['complexity'])
    expect(issuePaths(PatternSchema, { ...pattern(), baseHours: '12' })).toEqual(['baseHours'])
  })

  it('requires baseHours above 0, since a zero-hour pattern would make its build free', () => {
    expect(issuePaths(PatternSchema, { ...pattern(), baseHours: 0 })).toEqual(['baseHours'])
    expect(issuePaths(PatternSchema, { ...pattern(), baseHours: -4 })).toEqual(['baseHours'])
    expect(issuePaths(PatternSchema, { ...pattern(), baseHours: 0.5 })).toEqual([])
  })

  it('survives a JSON round trip unchanged', () => {
    expect(PatternSchema.parse(roundTrip(pattern()))).toEqual(pattern())
  })

  it('infers the spec types', () => {
    expectTypeOf<Pattern['blueprintSkeleton']>().toEqualTypeOf<Omit<Blueprint, 'id' | 'opportunityId'> | null>()
    expectTypeOf<Pattern['complexity']>().toEqualTypeOf<'low' | 'medium' | 'high'>()
    expectTypeOf<Pattern['baseHours']>().toEqualTypeOf<number>()
  })
})

describe('CalibrationRecordSchema', () => {
  it('accepts a record', () => {
    expect(CalibrationRecordSchema.parse(calibrationRecord())).toEqual(calibrationRecord())
  })

  it('requires both hour figures on every sample', () => {
    const invalid = { ...calibrationRecord(), samples: [{ engagementId: 'eng-0', estimatedHours: 20, completedAt: '2026-08-30' }] }
    expect(issuePaths(CalibrationRecordSchema, invalid)).toEqual(['samples.0.actualHours'])
  })

  it('requires a positive estimate on every sample, since the ratio divides by it', () => {
    const withEstimate = (estimatedHours: number) => ({
      ...calibrationRecord(),
      samples: [{ engagementId: 'eng-0', estimatedHours, actualHours: 26, completedAt: '2026-08-30' }],
    })
    expect(issuePaths(CalibrationRecordSchema, withEstimate(0))).toEqual(['samples.0.estimatedHours'])
    expect(issuePaths(CalibrationRecordSchema, withEstimate(-20))).toEqual(['samples.0.estimatedHours'])
    expect(issuePaths(CalibrationRecordSchema, withEstimate(0.5))).toEqual([])
  })

  it('requires non-negative actual hours on every sample', () => {
    const withActual = (actualHours: number) => ({
      ...calibrationRecord(),
      samples: [{ engagementId: 'eng-0', estimatedHours: 20, actualHours, completedAt: '2026-08-30' }],
    })
    expect(issuePaths(CalibrationRecordSchema, withActual(-1))).toEqual(['samples.0.actualHours'])
    expect(issuePaths(CalibrationRecordSchema, withActual(0))).toEqual([])
  })

  it('infers the spec types', () => {
    expectTypeOf<CalibrationRecord['samples'][number]>().toEqualTypeOf<{
      engagementId: string
      estimatedHours: number
      actualHours: number
      completedAt: string
    }>()
    expectTypeOf<CalibrationRecord['trustworthy']>().toEqualTypeOf<boolean>()
  })
})

describe('DocumentTemplateSchema and TemplateSectionSchema', () => {
  it('accept a template', () => {
    expect(DocumentTemplateSchema.parse(documentTemplate())).toEqual(documentTemplate())
  })

  it('accept exactly the six documented kinds', () => {
    expect(DocumentTemplateSchema.shape.kind.options).toEqual([
      'teardown',
      'proposal',
      'sow',
      'project-plan',
      'handover',
      'case-study',
    ])
    expect(issuePaths(DocumentTemplateSchema, { ...documentTemplate(), kind: 'invoice' })).toEqual(['kind'])
  })

  it('treat showIf and repeatOver as optional', () => {
    expect(issuePaths(TemplateSectionSchema, { id: 's', heading: 'Scope', body: 'Text' })).toEqual([])
  })

  it('infer the spec types', () => {
    expectTypeOf<DocumentTemplate['sections'][number]>().toEqualTypeOf<{
      id: string
      heading: string
      body: string
      showIf?: string | undefined
      repeatOver?: string | undefined
    }>()
  })
})

describe('LibrarySchema', () => {
  it('accepts a populated library', () => {
    expect(LibrarySchema.parse(library())).toEqual(library())
  })

  it('accepts an empty library', () => {
    expect(issuePaths(LibrarySchema, { patterns: [], questionSets: [], templates: [], calibration: [] })).toEqual([])
  })

  it('refuses a stored question set whose mapsTo has a typo', () => {
    const invalid = { ...library(), questionSets: [{ ...questionSet(), questions: [{ ...question(), mapsTo: 'company.nmae' }] }] }
    expect(issuePaths(LibrarySchema, invalid)).toEqual(['questionSets.0.questions.0.mapsTo'])
  })

  it('survives a JSON round trip unchanged', () => {
    expect(LibrarySchema.parse(roundTrip(library()))).toEqual(library())
  })

  it('refuses two question sets with the same id, at the later one', () => {
    const questionSets = [questionSet(), { ...questionSet(), name: 'Copy' }]
    expect(issuePaths(LibrarySchema, { ...library(), questionSets })).toEqual(['questionSets.1.id'])
  })

  it('infers the spec types', () => {
    expectTypeOf<Library>().toEqualTypeOf<{
      patterns: Pattern[]
      questionSets: QuestionSet[]
      templates: DocumentTemplate[]
      calibration: CalibrationRecord[]
    }>()
  })
})
