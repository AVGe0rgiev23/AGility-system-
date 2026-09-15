import type { MigrateFn } from './run-migrations'

// Version 2 changed what the engines produce: warnings became code and message objects,
// breakdown rows gained an audience, ROI ratios became nullable and are null at a zero price,
// ROI warnings are judged on the conservative scenario, and money is told by its currency.
// A cached result is recomputed only when its inputsHash stops matching, and the hash covers
// the inputs, not engine behaviour, so a v1 cache would otherwise be served forever. Caches are
// never authoritative (ARCHITECTURE, Derived data policy), so each one is set to null and
// recomputed on load, with the same hash as before. Nothing else is touched: data that breaks a
// v2 rule is left as it is, and fails validation with its issue path instead of being dropped.

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function objectsIn(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter(isObject) : []
}

// Mutates its argument, which is always the copy runMigrations hands it.
export const migrateV1ToV2: MigrateFn = (store) => {
  if (!isObject(store)) return store
  for (const engagement of objectsIn(store.engagements)) {
    for (const opportunity of objectsIn(engagement.opportunities)) {
      opportunity.scoring = null
    }
    if (isObject(engagement.scope)) {
      engagement.scope.estimate = null
      engagement.scope.runCost = null
      engagement.scope.roi = null
    }
  }
  if (isObject(store.meta)) store.meta.schemaVersion = 2
  return store
}
