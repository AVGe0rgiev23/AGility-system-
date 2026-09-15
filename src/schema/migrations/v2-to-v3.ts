import type { MigrateFn } from './run-migrations'

// Version 3 gives every section override a snapshot of the values it read (baseInputs) and a
// rebase trail (rebasedFrom). An override written before v3 has neither, so both are set to
// null: the snapshot is unknown, and the edit has never been kept over changed data. The hash is
// left exactly as stored, so no override becomes conflicted by the upgrade itself. Nothing else
// is touched: data that breaks a v3 rule fails validation with its issue path instead of being
// dropped or repaired.

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function objectsIn(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter(isObject) : []
}

// Mutates its argument, which is always the copy runMigrations hands it.
export const migrateV2ToV3: MigrateFn = (store) => {
  if (!isObject(store)) return store
  for (const engagement of objectsIn(store.engagements)) {
    if (!isObject(engagement.artifacts)) continue
    for (const artifact of Object.values(engagement.artifacts)) {
      if (!isObject(artifact)) continue
      for (const override of objectsIn(artifact.overrides)) {
        override.baseInputs = null
        override.rebasedFrom = null
      }
    }
  }
  if (isObject(store.meta)) store.meta.schemaVersion = 3
  return store
}
