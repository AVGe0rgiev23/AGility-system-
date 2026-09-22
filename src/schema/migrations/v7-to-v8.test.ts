import { describe, expect, it } from 'vitest'
import storeV7 from '../__fixtures__/store-v7.json'
import { WholeStoreSchema } from '../store'
import { CURRENT_SCHEMA_VERSION } from '../version'
import { MigrationError, runMigrations } from './run-migrations'
import { migrateV7ToV8 } from './v7-to-v8'

type Json = Record<string, unknown>

// The frozen fixture, read as the untyped JSON a v7 store on disk would be.
function v7Store(): Json {
  return structuredClone(storeV7)
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

function expectedV8(): Json {
  const store = v7Store()
  at(store, 'meta').schemaVersion = 8
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

describe('migrateV7ToV8', () => {
  it('advances the version and changes nothing else', () => {
    expect(migrateV7ToV8(v7Store())).toEqual(expectedV8())
  })

  it('migrates the v7 fixture through the whole chain to a store that validates, changing nothing Zod would add or strip', () => {
    const migrated = runMigrations(v7Store(), 7)
    expect(WholeStoreSchema.safeParse(migrated).success).toBe(true)
    expect(migrated.meta.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    // Later steps add only what they document; nothing else about the v7 data changes.
    const expected = expectedV8()
    at(expected, 'meta').schemaVersion = CURRENT_SCHEMA_VERSION
    expect(migrated).toEqual(expected)
  })

  it('leaves v7 data that breaks a v8 rule as it is, so the migration fails with each issue path', () => {
    const store = v7Store()
    const process = at(store, 'engagements', 0, 'processes', 0)
    process.systemsTouched = ['Gmail', 'Gmail']
    at(process, 'steps', 0).action = ' '
    const opportunity = at(store, 'engagements', 0, 'opportunities', 0)
    opportunity.primaryPatternId = 'pat-not-linked'
    at(opportunity, 'automatablePercent').value = 150
    at(store, 'engagements', 0, 'company', 'detectedStack', 0).category = ''

    expect(issuePathsOf(() => runMigrations(store, 7)).sort()).toEqual(
      [
        'engagements.0.processes.0.systemsTouched.1',
        'engagements.0.processes.0.steps.0.action',
        'engagements.0.opportunities.0.primaryPatternId',
        'engagements.0.opportunities.0.automatablePercent.value',
        'engagements.0.company.detectedStack.0.category',
      ].sort(),
    )
    // Nothing is repaired on the way through: the caller's data is left exactly as it was.
    expect(process.systemsTouched).toEqual(['Gmail', 'Gmail'])
    expect(opportunity.primaryPatternId).toBe('pat-not-linked')
  })

  it('refuses a v7 engagement whose processes share an id, which the form and the scope would both misread', () => {
    const store = v7Store()
    const engagement = at(store, 'engagements', 0)
    const process = at(engagement, 'processes', 0)
    engagement.processes = [process, structuredClone(process)]
    expect(issuePathsOf(() => runMigrations(store, 7))).toEqual(['engagements.0.processes.1.id'])
  })

  it('returns a value that is not a store unchanged, for validation to refuse', () => {
    expect(migrateV7ToV8('not a store')).toBe('not a store')
    expect(() => runMigrations('not a store', 7)).toThrow(MigrationError)
  })
})
