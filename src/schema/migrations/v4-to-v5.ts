import type { MigrateFn } from './run-migrations'

// Version 5 makes a run-cost item's monthlyCost nullable, and requires it only on an item that is
// not usage-based. Every v4 item carries a number, which is still valid, so no data changes shape
// and only the version advances. A usage-based v4 item keeps the number v4 made it carry: it is
// ignored while the item stays usage-based, and dropping it would be a repair, which a migration
// never makes.

// Mutates its argument, which is always the copy runMigrations hands it.
export const migrateV4ToV5: MigrateFn = (store) => {
  if (typeof store !== 'object' || store === null || Array.isArray(store)) return store
  const { meta } = store as Record<string, unknown>
  if (typeof meta === 'object' && meta !== null && !Array.isArray(meta)) {
    ;(meta as Record<string, unknown>).schemaVersion = 5
  }
  return store
}
