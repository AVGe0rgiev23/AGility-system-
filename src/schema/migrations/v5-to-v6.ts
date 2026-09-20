import type { MigrateFn } from './run-migrations'

// Version 6 adds the capture rules engagement editing relies on: a company and each contact have a
// name, a website, contact email and employee count are well-formed when present, tags are non-blank
// and distinct, and a next action has text and a real due date. No data changes shape, so only the
// version advances. A v5 record that breaks a rule is not repaired: guessing a name or dropping a
// malformed address would change what Alex entered, so it stays as stored and the migration fails
// with its issue path for Alex to fix by hand.

// Mutates its argument, which is always the copy runMigrations hands it.
export const migrateV5ToV6: MigrateFn = (store) => {
  if (typeof store !== 'object' || store === null || Array.isArray(store)) return store
  const { meta } = store as Record<string, unknown>
  if (typeof meta === 'object' && meta !== null && !Array.isArray(meta)) {
    ;(meta as Record<string, unknown>).schemaVersion = 6
  }
  return store
}
