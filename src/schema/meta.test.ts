import { describe, expect, expectTypeOf, it } from 'vitest'
import { issuePaths, meta, roundTrip } from './__fixtures__/records'
import { MetaSchema, type Meta } from './meta'
import { CURRENT_SCHEMA_VERSION } from './version'

describe('MetaSchema', () => {
  it('accepts a never-migrated store', () => {
    expect(MetaSchema.parse(meta())).toEqual(meta())
  })

  it('accepts a migration timestamp', () => {
    expect(issuePaths(MetaSchema, { ...meta(), lastMigratedAt: '2026-10-01T09:00:00.000Z' })).toEqual([])
  })

  it('rejects a schema version that no migration chain could reach', () => {
    for (const schemaVersion of [0, -1, 1.5, '1']) {
      expect(issuePaths(MetaSchema, { ...meta(), schemaVersion })).toEqual(['schemaVersion'])
    }
  })

  it('requires lastMigratedAt, even as null', () => {
    const { lastMigratedAt: _omitted, ...withoutMigration } = meta()
    expect(issuePaths(MetaSchema, withoutMigration)).toEqual(['lastMigratedAt'])
  })

  it('survives a JSON round trip unchanged', () => {
    expect(MetaSchema.parse(roundTrip(meta()))).toEqual(meta())
  })

  it('infers the spec types', () => {
    expectTypeOf<Meta>().toEqualTypeOf<{
      schemaVersion: number
      createdAt: string
      lastMigratedAt: string | null
      appVersion: string
    }>()
  })
})

describe('CURRENT_SCHEMA_VERSION', () => {
  it('is v5, and a valid Meta version', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(5)
    expect(issuePaths(MetaSchema, { ...meta(), schemaVersion: CURRENT_SCHEMA_VERSION })).toEqual([])
  })
})
