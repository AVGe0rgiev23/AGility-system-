import type { z } from 'zod'
import { WholeStoreSchema, type WholeStore } from '../store'
import { CURRENT_SCHEMA_VERSION } from '../version'
import { migrateV1ToV2 } from './v1-to-v2'
import { migrateV2ToV3 } from './v2-to-v3'

// Takes the whole store at version N and returns it at N + 1, including setting
// meta.schemaVersion to N + 1. One file per bump in this folder, registered below.
export type MigrateFn = (store: unknown) => unknown

// Keyed by the version each migration upgrades from.
export const MIGRATIONS: Readonly<Record<number, MigrateFn>> = {
  1: migrateV1ToV2,
  2: migrateV2ToV3,
}

export interface MigrationChain {
  migrations: Readonly<Record<number, MigrateFn>>
  current: number
}

export class MigrationError extends Error {
  override readonly name = 'MigrationError'
  readonly issues: z.core.$ZodIssue[]

  constructor(message: string, options: { issues?: z.core.$ZodIssue[]; cause?: unknown } = {}) {
    super(message, { cause: options.cause })
    this.issues = options.issues ?? []
  }
}

// Brings a whole store from `from` up to the current schema version and validates it.
// Pure: it never writes, so the caller replaces the stored data only when this returns.
// `chain` exists so the step loop can be tested against a fake chain.
export function runMigrations(
  store: unknown,
  from: number,
  chain: MigrationChain = { migrations: MIGRATIONS, current: CURRENT_SCHEMA_VERSION },
): WholeStore {
  const { migrations, current } = chain

  if (!Number.isInteger(from) || from < 1) {
    throw new MigrationError(`Schema version ${String(from)} is not valid. Versions are whole numbers starting at 1.`)
  }
  // Refused rather than parsed: Zod would strip every field this app does not know,
  // and the downgrade would look like a success.
  if (from > current) {
    throw new MigrationError(
      `This data is at schema version ${from}, but this app only supports up to schema version ${current}. ` +
        'The app is older than the data. Update the app and try again. Nothing was changed.',
    )
  }
  const stated = statedVersion(store)
  if (stated !== undefined && stated !== from) {
    throw new MigrationError(
      `Expected data at schema version ${from}, but its meta says ${JSON.stringify(stated)}. ` +
        'The version record and the data disagree, so nothing was migrated.',
    )
  }

  // Migrations get a copy, so one that fails halfway leaves the caller's data untouched.
  let working: unknown = structuredClone(store)
  for (let version = from; version < current; version++) {
    const migrate = migrations[version]
    if (migrate === undefined) {
      throw new MigrationError(`No migration is registered from schema version ${version} to ${version + 1}.`)
    }
    try {
      working = migrate(working)
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause)
      throw new MigrationError(`Migration from schema version ${version} to ${version + 1} failed: ${reason}`, {
        cause,
      })
    }
  }

  const result = WholeStoreSchema.safeParse(working)
  if (!result.success) {
    throw new MigrationError(`The migrated data does not validate at schema version ${current}.`, {
      issues: result.error.issues,
    })
  }
  if (result.data.meta.schemaVersion !== current) {
    throw new MigrationError(
      `The migrated data says schema version ${result.data.meta.schemaVersion}, but it should be ${current}. ` +
        'A migration did not update meta.schemaVersion.',
    )
  }
  return result.data
}

// Read without trusting the shape, since the store's schema is exactly what is in question.
function statedVersion(store: unknown): unknown {
  if (typeof store !== 'object' || store === null || !('meta' in store)) return undefined
  const { meta } = store
  if (typeof meta !== 'object' || meta === null || !('schemaVersion' in meta)) return undefined
  return meta.schemaVersion
}
