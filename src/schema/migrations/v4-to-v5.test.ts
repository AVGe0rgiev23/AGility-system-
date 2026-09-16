import { describe, expect, it } from 'vitest'
import storeV4 from '../__fixtures__/store-v4.json'
import { WholeStoreSchema } from '../store'
import { CURRENT_SCHEMA_VERSION } from '../version'
import { MigrationError, runMigrations } from './run-migrations'
import { migrateV4ToV5 } from './v4-to-v5'

type Json = Record<string, unknown>

// The frozen fixture, read as the untyped JSON a v4 store on disk would be.
function v4Store(): Json {
  return structuredClone(storeV4)
}

function at(value: unknown, ...path: (string | number)[]): Json {
  let current = value
  for (const key of path) {
    if (typeof current !== 'object' || current === null) throw new Error(`no object at ${path.join('.')}`)
    current = (current as Record<string | number, unknown>)[key]
  }
  if (typeof current !== 'object' || current === null) throw new Error(`no object at ${path.join('.')}`)
  return current as Json
}

function expectedV5(): Json {
  const store = v4Store()
  at(store, 'meta').schemaVersion = 5
  return store
}

// Every run-cost item in the store, wherever it sits.
function runCostItems(store: unknown): Json[] {
  if (Array.isArray(store)) return store.flatMap(runCostItems)
  if (typeof store !== 'object' || store === null) return []
  const record = store as Json
  const own = typeof record.usageBased === 'boolean' && 'monthlyCost' in record ? [record] : []
  return [...own, ...Object.values(record).flatMap(runCostItems)]
}

describe('migrateV4ToV5', () => {
  it('advances the version and changes nothing else', () => {
    expect(migrateV4ToV5(v4Store())).toEqual(expectedV5())
  })

  it('migrates the v4 fixture through the whole chain to a store that validates, changing nothing Zod would add or strip', () => {
    const migrated = runMigrations(v4Store(), 4)
    expect(WholeStoreSchema.safeParse(migrated).success).toBe(true)
    expect(migrated.meta.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    // Later steps add only what they document; nothing else about the v4 data changes.
    const expected = expectedV5()
    at(expected, 'meta').schemaVersion = CURRENT_SCHEMA_VERSION
    expect(migrated).toEqual(expected)
  })

  it('keeps the monthly cost v4 made a usage-based item carry, since removing it would be a repair', () => {
    const usage = runCostItems(v4Store()).filter((item) => item.usageBased === true)
    expect(usage.map((item) => item.monthlyCost)).toEqual([0])
    const migrated = runCostItems(runMigrations(v4Store(), 4)).filter((item) => item.usageBased === true)
    expect(migrated.map((item) => item.monthlyCost)).toEqual([0])
  })

  it('still refuses a fixed item with no monthly cost, with its issue path', () => {
    const store = v4Store()
    const fixed = runCostItems(store).find((item) => item.usageBased === false)
    if (fixed === undefined) throw new Error('the v4 fixture has a fixed run-cost item')
    fixed.monthlyCost = null
    let error: unknown
    try {
      runMigrations(store, 4)
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(MigrationError)
    expect((error as MigrationError).issues.map((issue) => issue.path.map(String).join('.'))).toEqual(['engagements.0.scope.runCostItems.0.monthlyCost'])
  })

  it('returns a value that is not a store unchanged, for validation to refuse', () => {
    expect(migrateV4ToV5('not a store')).toBe('not a store')
    expect(() => runMigrations('not a store', 4)).toThrow(MigrationError)
  })
})
