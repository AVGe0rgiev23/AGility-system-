import { describe, expect, expectTypeOf, it } from 'vitest'
import { blueprint, issuePaths, roundTrip } from './__fixtures__/records'
import { BlueprintNodeSchema, BlueprintSchema, type Blueprint, type BlueprintNode } from './blueprint'

describe('BlueprintNodeSchema', () => {
  it('accepts every documented node kind', () => {
    const kinds = ['trigger', 'validate', 'fetch', 'transform', 'logic', 'ai', 'approval', 'action', 'log', 'error']
    expect(BlueprintNodeSchema.shape.kind.options).toEqual(kinds)
  })

  it('rejects an unknown node kind', () => {
    const node = { id: 'n', kind: 'loop', name: 'Loop', purpose: 'Repeat', requiresApproval: false }
    expect(issuePaths(BlueprintNodeSchema, node)).toEqual(['kind'])
  })

  it('treats advisoryHours as optional', () => {
    const node = { id: 'n', kind: 'log', name: 'Log', purpose: 'Record the run', requiresApproval: false }
    expect(issuePaths(BlueprintNodeSchema, node)).toEqual([])
  })
})

describe('BlueprintSchema', () => {
  it('accepts a blueprint with nodes and edges', () => {
    expect(BlueprintSchema.parse(blueprint())).toEqual(blueprint())
  })

  it('requires both ends of every edge', () => {
    expect(issuePaths(BlueprintSchema, { ...blueprint(), edges: [{ from: 'n-1' }] })).toEqual(['edges.0.to'])
  })

  it('survives a JSON round trip unchanged', () => {
    expect(BlueprintSchema.parse(roundTrip(blueprint()))).toEqual(blueprint())
  })

  it('infers the spec types', () => {
    expectTypeOf<BlueprintNode['advisoryHours']>().toEqualTypeOf<number | undefined>()
    expectTypeOf<Blueprint['edges'][number]>().toEqualTypeOf<{
      from: string
      to: string
      label?: string | undefined
      condition?: string | undefined
    }>()
  })
})
