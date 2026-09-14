import { describe, expect, expectTypeOf, it } from 'vitest'
import { issuePaths, roundTrip, wholeStore } from './__fixtures__/records'
import type { Config } from './config'
import type { Engagement } from './engagement'
import type { Library } from './library'
import type { Meta } from './meta'
import { WholeStoreSchema, type WholeStore } from './store'

describe('WholeStoreSchema', () => {
  it('accepts a full store', () => {
    expect(WholeStoreSchema.parse(wholeStore())).toEqual(wholeStore())
  })

  it('requires all four parts', () => {
    const { library: _omitted, ...withoutLibrary } = wholeStore()
    expect(issuePaths(WholeStoreSchema, withoutLibrary)).toEqual(['library'])
  })

  it('reports a corrupt engagement at its exact path', () => {
    const store = wholeStore()
    const [first, second] = store.engagements
    if (first === undefined || second === undefined) throw new Error('fixture has two engagements')
    const corrupt = { ...second, company: { ...second.company, currency: 'JPY' } }
    expect(issuePaths(WholeStoreSchema, { ...store, engagements: [first, corrupt] })).toEqual([
      'engagements.1.company.currency',
    ])
  })

  it('survives a JSON round trip unchanged, so export and import lose nothing', () => {
    expect(WholeStoreSchema.parse(roundTrip(wholeStore()))).toEqual(wholeStore())
  })

  it('infers the spec types', () => {
    expectTypeOf<WholeStore>().toEqualTypeOf<{
      meta: Meta
      config: Config
      library: Library
      engagements: Engagement[]
    }>()
  })
})
