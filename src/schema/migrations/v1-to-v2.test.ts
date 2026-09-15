import { describe, expect, it } from 'vitest'
import storeV1 from '../__fixtures__/store-v1.json'
import { WholeStoreSchema } from '../store'
import { MigrationError, runMigrations } from './run-migrations'
import { migrateV1ToV2 } from './v1-to-v2'

type Json = Record<string, unknown>

// The frozen fixture, read as the untyped JSON a v1 store on disk would be.
function v1Store(): Json {
  return structuredClone(storeV1)
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

// The v1 fixture with exactly the four cached-result slots nulled and the version advanced,
// written out path by path so the test does not share the migration's traversal.
function expectedV2(): Json {
  const store = v1Store()
  at(store, 'meta').schemaVersion = 2
  at(store, 'engagements', 0, 'opportunities', 0).scoring = null
  at(store, 'engagements', 0, 'scope').estimate = null
  at(store, 'engagements', 0, 'scope').runCost = null
  at(store, 'engagements', 0, 'scope').roi = null
  return store
}

describe('migrateV1ToV2', () => {
  it('nulls exactly opportunities[].scoring, scope.estimate, scope.runCost and scope.roi, and nothing else', () => {
    const before = v1Store()
    // The fixture must actually hold caches in every slot, or nulling them proves nothing.
    expect(at(before, 'engagements', 0, 'opportunities', 0).scoring).not.toBeNull()
    for (const slot of ['estimate', 'runCost', 'roi']) {
      expect(at(before, 'engagements', 0, 'scope')[slot], slot).not.toBeNull()
    }
    expect(migrateV1ToV2(before)).toEqual(expectedV2())
  })

  it('migrates the v1 fixture to a store that validates at version 2, changing nothing Zod would add or strip', () => {
    const migrated = runMigrations(v1Store(), 1)
    expect(WholeStoreSchema.safeParse(migrated).success).toBe(true)
    expect(migrated.meta.schemaVersion).toBe(2)
    expect(migrated).toEqual(expectedV2())
  })

  it('migrates v1 caches that v2 could not parse, since they are dropped rather than read', () => {
    const store = v1Store()
    const scoring = at(store, 'engagements', 0, 'opportunities', 0, 'scoring')
    scoring.warnings = ['NO_PATTERN: no linked pattern, so build hours start from the fallback']
    scoring.breakdown = [{ label: 'Value score', value: 36, unit: 'points', source: 'default', formula: 'x', audience: 'hidden' }]
    at(store, 'engagements', 0, 'scope', 'roi').warnings = ['DEFAULT_HOURLY_COST: an hourly cost is a default']
    at(store, 'engagements', 0, 'scope', 'runCost').warnings = ['RETAINER_NOT_SET: no retainer']
    const migrated = runMigrations(store, 1)
    expect(WholeStoreSchema.safeParse(migrated).success).toBe(true)
    expect(migrated.meta.schemaVersion).toBe(2)
  })

  it('leaves data that breaks a v2 rule in place, so the migration fails with its issue path', () => {
    const store = v1Store()
    at(store, 'library', 'calibration', 0, 'samples', 0).estimatedHours = 0
    let error: unknown
    try {
      runMigrations(store, 1)
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(MigrationError)
    expect((error as MigrationError).issues.map((issue) => issue.path)).toEqual([
      ['library', 'calibration', 0, 'samples', 0, 'estimatedHours'],
    ])
  })

  it('returns a value that is not a store unchanged, for validation to refuse', () => {
    expect(migrateV1ToV2('not a store')).toBe('not a store')
    expect(() => runMigrations('not a store', 1)).toThrow(MigrationError)
  })
})
