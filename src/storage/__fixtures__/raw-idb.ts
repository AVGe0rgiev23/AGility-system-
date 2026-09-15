// Test-only access to the IndexedDB database underneath the repository, bypassing it on purpose
// to plant what the repository would never write: corrupt records and stores at other schema
// versions. Uses the raw IndexedDB API, since only the repository may use Dexie.

type Table = 'engagements' | 'library' | 'config' | 'meta'
const TABLES: Table[] = ['engagements', 'library', 'config', 'meta']

function open(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error(`could not open ${name}`))
  })
}

function settle(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('transaction failed'))
    transaction.onabort = () => reject(transaction.error ?? new Error('transaction aborted'))
  })
}

export interface Planted {
  table: Table
  value: unknown
  // Singleton tables use out-of-line keys ('meta', 'config', 'library'); engagements use their id.
  key?: string
}

// The database must already exist: call something on the repository first so Dexie creates the tables.
export async function plant(name: string, records: Planted[], { clearFirst = false } = {}): Promise<void> {
  const db = await open(name)
  try {
    const transaction = db.transaction(TABLES, 'readwrite')
    const done = settle(transaction)
    if (clearFirst) for (const table of TABLES) transaction.objectStore(table).clear()
    for (const { table, value, key } of records) {
      const store = transaction.objectStore(table)
      if (key === undefined) store.put(value)
      else store.put(value, key)
    }
    await done
  } finally {
    db.close()
  }
}

// A whole store laid out table by table, as the repository stores it.
export function plantedStore(store: { meta: unknown; config: unknown; library: unknown; engagements: unknown[] }): Planted[] {
  return [
    { table: 'meta', key: 'meta', value: store.meta },
    { table: 'config', key: 'config', value: store.config },
    { table: 'library', key: 'library', value: store.library },
    ...store.engagements.map((value) => ({ table: 'engagements' as const, value })),
  ]
}

export async function readRaw(name: string, table: Table, key: string): Promise<unknown> {
  const db = await open(name)
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(table, 'readonly').objectStore(table).get(key)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('read failed'))
    })
  } finally {
    db.close()
  }
}
