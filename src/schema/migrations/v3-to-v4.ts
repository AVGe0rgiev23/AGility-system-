import type { MigrateFn } from './run-migrations'

// Version 4 refuses a currency on a TracedValue whose unit is not money. The engines tell money
// by currency alone, so { unit: 'percent', currency: 'EUR' } would be converted at an FX rate.
// No data changes shape, so only the version advances. A v3 value that breaks the rule is not
// repaired: dropping its currency could turn a real cost into a bare number, so it stays as
// stored and the migration fails with its issue path for Alex to fix by hand.

// Mutates its argument, which is always the copy runMigrations hands it.
export const migrateV3ToV4: MigrateFn = (store) => {
  if (typeof store !== 'object' || store === null || Array.isArray(store)) return store
  const { meta } = store as Record<string, unknown>
  if (typeof meta === 'object' && meta !== null && !Array.isArray(meta)) {
    ;(meta as Record<string, unknown>).schemaVersion = 4
  }
  return store
}
