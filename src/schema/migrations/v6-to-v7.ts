import type { MigrateFn } from './run-migrations'

// Version 7 adds the rules the question-set editor and the discovery runner rely on: questions and sets
// are well-formed, a question maps only to a path its kind can fill and has one source for its unit, a
// condition that names an earlier question tests it in a way its kind allows, an answer's value suits
// its kind, and stated tools and compliance entries are neither blank nor repeated. Questions gain an
// optional unit, which no v6 question has. No data changes shape, so only the version advances. A v6
// record that breaks a rule is not repaired: it stays as stored and the migration fails with its issue
// path for Alex to fix by hand.

// Mutates its argument, which is always the copy runMigrations hands it.
export const migrateV6ToV7: MigrateFn = (store) => {
  if (typeof store !== 'object' || store === null || Array.isArray(store)) return store
  const { meta } = store as Record<string, unknown>
  if (typeof meta === 'object' && meta !== null && !Array.isArray(meta)) {
    ;(meta as Record<string, unknown>).schemaVersion = 7
  }
  return store
}
