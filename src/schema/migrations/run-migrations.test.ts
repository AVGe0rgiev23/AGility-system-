import { describe, expect, it } from 'vitest'
import { wholeStore } from '../__fixtures__/records'
import { WholeStoreSchema, type WholeStore } from '../store'
import { CURRENT_SCHEMA_VERSION } from '../version'
import { MIGRATIONS, MigrationError, runMigrations, type MigrateFn } from './run-migrations'

// One whole-store fixture per historical version, frozen when that version shipped. Never edit one.
const fixtures = import.meta.glob<unknown>('../__fixtures__/store-v*.json', { eager: true, import: 'default' })

function fixtureVersion(path: string): number {
  const match = /store-v(\d+)\.json$/.exec(path)
  if (match?.[1] === undefined) throw new Error(`unexpected fixture name ${path}`)
  return Number(match[1])
}

// Current-shape data labelled with any version, so the fake chains below keep passing
// after real schema bumps change what a store looks like.
function storeAt(version: number): WholeStore {
  const store = wholeStore()
  store.meta.schemaVersion = version
  return store
}

// A stand-in migration that proves it ran, and in which order, by tagging the first engagement.
function tagStep(to: number): MigrateFn {
  return (store) => {
    const next = WholeStoreSchema.parse(store)
    next.meta.schemaVersion = to
    next.engagements[0]?.tags.push(`v${to}`)
    return next
  }
}

const threeVersionChain = { migrations: { 1: tagStep(2), 2: tagStep(3) }, current: 3 }

function thrown(run: () => unknown): MigrationError {
  try {
    run()
  } catch (error) {
    if (error instanceof MigrationError) return error
    throw error
  }
  throw new Error('expected a MigrationError, but nothing was thrown')
}

describe('historical fixtures and the real chain', () => {
  it('has a whole-store fixture for every version up to the current one', () => {
    const versions = Object.keys(fixtures).map(fixtureVersion).sort((a, b) => a - b)
    expect(versions).toEqual(Array.from({ length: CURRENT_SCHEMA_VERSION }, (_, i) => i + 1))
  })

  it('has exactly one registered migration for every version below the current one', () => {
    const registered = Object.keys(MIGRATIONS).map(Number).sort((a, b) => a - b)
    expect(registered).toEqual(Array.from({ length: CURRENT_SCHEMA_VERSION - 1 }, (_, i) => i + 1))
  })

  it('migrates every historical fixture to the current version and validates it', () => {
    for (const [path, fixture] of Object.entries(fixtures)) {
      const migrated = runMigrations(fixture, fixtureVersion(path))
      expect(migrated.meta.schemaVersion, path).toBe(CURRENT_SCHEMA_VERSION)
    }
  })

  it('returns a store already at the current version unchanged, with nothing stripped', () => {
    const fixture = fixtures[`../__fixtures__/store-v${CURRENT_SCHEMA_VERSION}.json`]
    expect(runMigrations(fixture, CURRENT_SCHEMA_VERSION)).toEqual(fixture)
  })
})

describe('runMigrations', () => {
  it('runs every step from the starting version, in order, and validates the result', () => {
    const original = storeAt(1)
    const migrated = runMigrations(original, 1, threeVersionChain)
    expect(migrated.meta.schemaVersion).toBe(3)
    expect(migrated.engagements[0]?.tags).toEqual(['logistics', 'v2', 'v3'])
  })

  it('starts the chain at the given version, skipping earlier steps', () => {
    const migrated = runMigrations(storeAt(2), 2, threeVersionChain)
    expect(migrated.engagements[0]?.tags).toEqual(['logistics', 'v3'])
  })

  it('leaves the caller’s store untouched and does not stamp lastMigratedAt', () => {
    const original = storeAt(1)
    const migrated = runMigrations(original, 1, threeVersionChain)
    expect(original).toEqual(storeAt(1))
    expect(migrated.meta.lastMigratedAt).toBeNull()
  })

  it('refuses data from a newer app, naming both versions and saying the app is older', () => {
    const newer = CURRENT_SCHEMA_VERSION + 1
    const error = thrown(() => runMigrations(storeAt(newer), newer))
    expect(error.message).toContain(`This data is at schema version ${newer}`)
    expect(error.message).toContain(`this app only supports up to schema version ${CURRENT_SCHEMA_VERSION}`)
    expect(error.message).toContain('The app is older than the data.')
  })

  it('refuses a starting version that is not a whole number from 1', () => {
    for (const from of [0, -1, 1.5, Number.NaN]) {
      expect(thrown(() => runMigrations(storeAt(1), from, threeVersionChain)).message).toContain('is not valid')
    }
  })

  it('refuses data whose meta disagrees with the starting version', () => {
    const error = thrown(() => runMigrations(storeAt(2), 1, threeVersionChain))
    expect(error.message).toContain('Expected data at schema version 1, but its meta says 2.')
    const quoted = { ...storeAt(1), meta: { ...storeAt(1).meta, schemaVersion: '1' } }
    expect(thrown(() => runMigrations(quoted, 1, threeVersionChain)).message).toContain('but its meta says "1".')
  })

  it('names the missing step when the chain has a gap', () => {
    const gapped = { migrations: { 1: tagStep(2) }, current: 3 }
    expect(thrown(() => runMigrations(storeAt(1), 1, gapped)).message).toContain(
      'No migration is registered from schema version 2 to 3.',
    )
  })

  it('names the failing step, keeps the cause, and leaves the caller’s store untouched', () => {
    const cause = new Error('boom')
    const destructive: MigrateFn = (store) => {
      ;(store as WholeStore).engagements.length = 0
      throw cause
    }
    const original = storeAt(1)
    const error = thrown(() => runMigrations(original, 1, { migrations: { 1: destructive }, current: 2 }))
    expect(error.message).toBe('Migration from schema version 1 to 2 failed: boom')
    expect(error.cause).toBe(cause)
    expect(original).toEqual(storeAt(1))
  })

  it('reports issue paths when the migrated store does not validate', () => {
    const corrupting: MigrateFn = (store) => {
      const next = store as WholeStore
      next.meta.schemaVersion = 2
      const first = next.engagements[0]
      if (first !== undefined) (first.company as { currency: string }).currency = 'BGN'
      return next
    }
    const error = thrown(() => runMigrations(storeAt(1), 1, { migrations: { 1: corrupting }, current: 2 }))
    expect(error.message).toBe('The migrated data does not validate at schema version 2.')
    expect(error.issues.map((issue) => issue.path)).toEqual([['engagements', 0, 'company', 'currency']])
  })

  it('refuses a result whose meta.schemaVersion was not advanced', () => {
    const forgetful: MigrateFn = (store) => store
    expect(thrown(() => runMigrations(storeAt(1), 1, { migrations: { 1: forgetful }, current: 2 })).message).toContain(
      'A migration did not update meta.schemaVersion.',
    )
  })
})
