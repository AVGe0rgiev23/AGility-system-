import { describe, expect, it } from 'vitest'
import storeV5 from '../__fixtures__/store-v5.json'
import { WholeStoreSchema } from '../store'
import { CURRENT_SCHEMA_VERSION } from '../version'
import { MigrationError, runMigrations } from './run-migrations'
import { migrateV5ToV6 } from './v5-to-v6'

type Json = Record<string, unknown>

// The frozen fixture, read as the untyped JSON a v5 store on disk would be.
function v5Store(): Json {
  return structuredClone(storeV5)
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

function expectedV6(): Json {
  const store = v5Store()
  at(store, 'meta').schemaVersion = 6
  return store
}

function issuePathsOf(run: () => unknown): string[] {
  try {
    run()
  } catch (error) {
    if (error instanceof MigrationError) return error.issues.map((issue) => issue.path.map(String).join('.'))
    throw error
  }
  throw new Error('expected a MigrationError, but nothing was thrown')
}

describe('migrateV5ToV6', () => {
  it('advances the version and changes nothing else', () => {
    expect(migrateV5ToV6(v5Store())).toEqual(expectedV6())
  })

  it('migrates the v5 fixture through the whole chain to a store that validates, changing nothing Zod would add or strip', () => {
    const migrated = runMigrations(v5Store(), 5)
    expect(WholeStoreSchema.safeParse(migrated).success).toBe(true)
    expect(migrated.meta.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    // Later steps add only what they document; nothing else about the v5 data changes.
    const expected = expectedV6()
    at(expected, 'meta').schemaVersion = CURRENT_SCHEMA_VERSION
    expect(migrated).toEqual(expected)
  })

  it('leaves v5 data that breaks a capture rule as it is, so the migration fails with each issue path', () => {
    const store = v5Store()
    const engagement = at(store, 'engagements', 0)
    at(engagement, 'company').name = '  '
    at(engagement, 'contacts', 0).email = 'marta@'
    engagement.tags = ['logistics', 'logistics']
    at(engagement, 'nextAction').due = '2026-02-30'
    expect(issuePathsOf(() => runMigrations(store, 5)).sort()).toEqual(
      ['engagements.0.company.name', 'engagements.0.contacts.0.email', 'engagements.0.nextAction.due', 'engagements.0.tags.1'].sort(),
    )
    expect(at(engagement, 'company').name).toBe('  ')
  })

  it('returns a value that is not a store unchanged, for validation to refuse', () => {
    expect(migrateV5ToV6('not a store')).toBe('not a store')
    expect(() => runMigrations('not a store', 5)).toThrow(MigrationError)
  })
})
