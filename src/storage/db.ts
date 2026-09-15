import { Dexie, type Table } from 'dexie'

// The browser's working store. Only repository.ts may use it (lint enforces this), and every
// table holds `unknown`, so nothing read back is usable until Zod has validated it.

export const DATABASE_NAME = 'agility-os'

// Engagements are keyed by their own id. Library, config and meta hold one record each under a
// fixed out-of-line key, which the repository names.
export type AgilityDatabase = Dexie & {
  engagements: Table<unknown, string>
  library: Table<unknown, string>
  config: Table<unknown, string>
  meta: Table<unknown, string>
}

// A factory rather than one shared instance, so each test can open its own database by name.
export function createDatabase(name: string = DATABASE_NAME): AgilityDatabase {
  // Dexie creates the table properties at runtime from stores() below; the cast names them for TypeScript.
  const db = new Dexie(name) as AgilityDatabase
  // Dexie's structural version: which tables and keys exist. It is unrelated to Meta.schemaVersion,
  // the version of the data itself, and changes only when a table or key does.
  db.version(1).stores({ engagements: 'id', library: '', config: '', meta: '' })
  return db
}
