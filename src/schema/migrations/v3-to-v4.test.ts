import { describe, expect, it } from 'vitest'
import storeV3 from '../__fixtures__/store-v3.json'
import { WholeStoreSchema } from '../store'
import { MigrationError, runMigrations } from './run-migrations'
import { migrateV3ToV4 } from './v3-to-v4'

type Json = Record<string, unknown>

// The frozen fixture, read as the untyped JSON a v3 store on disk would be.
function v3Store(): Json {
  return structuredClone(storeV3)
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

function expectedV4(): Json {
  const store = v3Store()
  at(store, 'meta').schemaVersion = 4
  return store
}

function thrown(run: () => unknown): MigrationError {
  try {
    run()
  } catch (error) {
    if (error instanceof MigrationError) return error
    throw error
  }
  throw new Error('expected a MigrationError, but nothing was thrown')
}

describe('migrateV3ToV4', () => {
  it('advances the version and changes nothing else', () => {
    expect(migrateV3ToV4(v3Store())).toEqual(expectedV4())
  })

  it('migrates the v3 fixture to a store that validates at version 4, changing nothing Zod would add or strip', () => {
    const migrated = runMigrations(v3Store(), 3)
    expect(WholeStoreSchema.safeParse(migrated).success).toBe(true)
    expect(migrated.meta.schemaVersion).toBe(4)
    expect(migrated).toEqual(expectedV4())
  })

  it('leaves a currency on a unit that is not money in place, so the migration fails with its issue path', () => {
    const store = v3Store()
    const company = at(store, 'engagements', 0, 'company')
    company.blendedHourlyCost = { value: 16, unit: 'per hour', currency: 'EUR', source: 'client-stated' }
    const error = thrown(() => runMigrations(store, 3))
    expect(error.issues.map((issue) => issue.path)).toEqual([['engagements', 0, 'company', 'blendedHourlyCost', 'currency']])
    expect(at(store, 'engagements', 0, 'company', 'blendedHourlyCost')).toHaveProperty('currency', 'EUR')
  })

  it('returns a value that is not a store unchanged, for validation to refuse', () => {
    expect(migrateV3ToV4('not a store')).toBe('not a store')
    expect(() => runMigrations('not a store', 3)).toThrow(MigrationError)
  })
})
