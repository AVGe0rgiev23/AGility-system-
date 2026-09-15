import { describe, expect, it } from 'vitest'
import storeV2 from '../__fixtures__/store-v2.json'
import { WholeStoreSchema } from '../store'
import { CURRENT_SCHEMA_VERSION } from '../version'
import { MigrationError, runMigrations } from './run-migrations'
import { migrateV2ToV3 } from './v2-to-v3'

type Json = Record<string, unknown>

// The frozen fixture, read as the untyped JSON a v2 store on disk would be.
function v2Store(): Json {
  return structuredClone(storeV2)
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

// The v2 fixture with exactly the two new override fields added and the version advanced,
// written out path by path so the test does not share the migration's traversal.
function expectedV3(): Json {
  const store = v2Store()
  at(store, 'meta').schemaVersion = 3
  const override = at(store, 'engagements', 0, 'artifacts', 'proposal', 'overrides', 0)
  override.baseInputs = null
  override.rebasedFrom = null
  return store
}

describe('migrateV2ToV3', () => {
  it('adds baseInputs: null and rebasedFrom: null to every override, and nothing else', () => {
    const before = v2Store()
    // The fixture must hold an override without the new fields, or adding them proves nothing.
    const override = at(before, 'engagements', 0, 'artifacts', 'proposal', 'overrides', 0)
    expect(override).not.toHaveProperty('baseInputs')
    expect(override).not.toHaveProperty('rebasedFrom')
    expect(migrateV2ToV3(before)).toEqual(expectedV3())
  })

  it('leaves every baseInputsHash byte for byte as stored, so the upgrade conflicts nothing', () => {
    const before = v2Store()
    const hashesBefore = overrideHashes(before)
    expect(hashesBefore.length).toBeGreaterThan(0)
    const after = migrateV2ToV3(structuredClone(before))
    expect(overrideHashes(after)).toEqual(hashesBefore)
  })

  it('migrates the v2 fixture through the whole chain to a store that validates, changing nothing Zod would add or strip', () => {
    const migrated = runMigrations(v2Store(), 2)
    expect(WholeStoreSchema.safeParse(migrated).success).toBe(true)
    expect(migrated.meta.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    // Later steps add only what they document; the v2 → v3 override fields are still exactly visible.
    const expected = expectedV3()
    at(expected, 'meta').schemaVersion = CURRENT_SCHEMA_VERSION
    expect(migrated).toEqual(expected)
  })

  it('reaches every artifact slot, not only the proposal', () => {
    const store = v2Store()
    const proposal = at(store, 'engagements', 0, 'artifacts', 'proposal')
    at(store, 'engagements', 0, 'artifacts').sow = structuredClone(proposal)
    const migrated = migrateV2ToV3(store)
    const sowOverride = at(migrated, 'engagements', 0, 'artifacts', 'sow', 'overrides', 0)
    expect(sowOverride).toMatchObject({ baseInputs: null, rebasedFrom: null })
  })

  it('leaves data that breaks a v3 rule in place, so the migration fails with its issue path', () => {
    const store = v2Store()
    at(store, 'engagements', 0, 'artifacts', 'proposal', 'overrides', 0).content = 42
    let error: unknown
    try {
      runMigrations(store, 2)
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(MigrationError)
    expect((error as MigrationError).issues.map((issue) => issue.path)).toEqual([
      ['engagements', 0, 'artifacts', 'proposal', 'overrides', 0, 'content'],
    ])
  })

  it('returns a value that is not a store unchanged, for validation to refuse', () => {
    expect(migrateV2ToV3('not a store')).toBe('not a store')
    expect(() => runMigrations('not a store', 2)).toThrow(MigrationError)
  })
})

function overrideHashes(store: unknown): unknown[] {
  const hashes: unknown[] = []
  const engagements = (store as Json).engagements
  if (!Array.isArray(engagements)) return hashes
  for (const engagement of engagements) {
    const artifacts = (engagement as Json).artifacts as Json
    for (const artifact of Object.values(artifacts)) {
      if (typeof artifact !== 'object' || artifact === null) continue
      for (const override of (artifact as Json).overrides as Json[]) hashes.push(override.baseInputsHash)
    }
  }
  return hashes
}
