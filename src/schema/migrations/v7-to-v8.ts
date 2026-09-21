import type { MigrateFn } from './run-migrations'

// Version 8 adds the capture rules the process and opportunity editors rely on: a process and an
// opportunity are named, a step says what it does, systems, pain points and compliance flags are
// neither blank nor repeated, a process or pattern is linked once, the primary pattern is one of the
// linked ones, a share is at most 100, a detected tool is named and categorised once, and process and
// opportunity ids are unique in their engagement. No data changes shape, so only the version advances.
// A v7 record that breaks a rule is not repaired: it stays as stored and the migration fails with its
// issue path for Alex to fix by hand.

// Mutates its argument, which is always the copy runMigrations hands it.
export const migrateV7ToV8: MigrateFn = (store) => {
  if (typeof store !== 'object' || store === null || Array.isArray(store)) return store
  const { meta } = store as Record<string, unknown>
  if (typeof meta === 'object' && meta !== null && !Array.isArray(meta)) {
    ;(meta as Record<string, unknown>).schemaVersion = 8
  }
  return store
}
