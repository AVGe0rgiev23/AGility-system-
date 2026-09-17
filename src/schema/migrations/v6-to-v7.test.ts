import { describe, expect, it } from 'vitest'
import storeV6 from '../__fixtures__/store-v6.json'
import { WholeStoreSchema } from '../store'
import { MigrationError, runMigrations } from './run-migrations'
import { migrateV6ToV7 } from './v6-to-v7'

type Json = Record<string, unknown>

// The frozen fixture, read as the untyped JSON a v6 store on disk would be.
function v6Store(): Json {
  return structuredClone(storeV6)
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

function expectedV7(): Json {
  const store = v6Store()
  at(store, 'meta').schemaVersion = 7
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

describe('migrateV6ToV7', () => {
  it('advances the version and changes nothing else', () => {
    expect(migrateV6ToV7(v6Store())).toEqual(expectedV7())
  })

  it('migrates the v6 fixture to a store that validates at version 7, changing nothing Zod would add or strip', () => {
    const migrated = runMigrations(v6Store(), 6)
    expect(WholeStoreSchema.safeParse(migrated).success).toBe(true)
    expect(migrated.meta.schemaVersion).toBe(7)
    expect(migrated).toEqual(expectedV7())
  })

  it('keeps the fixture question whose condition names a question outside its set, which fails safe', () => {
    const question = at(v6Store(), 'library', 'questionSets', 0, 'questions', 0)
    expect(question.showIf).toEqual({ answerId: 'q-has-staff', equals: true })
    expect(() => runMigrations(v6Store(), 6)).not.toThrow()
  })

  it('leaves v6 data that breaks a v7 rule as it is, so the migration fails with each issue path', () => {
    const store = v6Store()
    const company = at(store, 'engagements', 0, 'company')
    company.statedTools = ['HubSpot', 'HubSpot']
    at(company, 'constraints').compliance = [' ']
    at(store, 'library', 'questionSets', 0, 'questions', 0).mapsTo = 'company.statedTools'
    at(store, 'engagements', 0, 'discovery', 0, 'answers', 0).value = 5
    expect(issuePathsOf(() => runMigrations(store, 6)).sort()).toEqual(
      [
        'engagements.0.company.statedTools.1',
        'engagements.0.company.constraints.compliance.0',
        'engagements.0.discovery.0.answers.0.traced.value',
        'library.questionSets.0.questions.0.mapsTo',
      ].sort(),
    )
    expect(company.statedTools).toEqual(['HubSpot', 'HubSpot'])
  })

  it('returns a value that is not a store unchanged, for validation to refuse', () => {
    expect(migrateV6ToV7('not a store')).toBe('not a store')
    expect(() => runMigrations('not a store', 6)).toThrow(MigrationError)
  })
})
