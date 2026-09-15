import type { z } from 'zod'
import { buildCalibrationLookup } from '../engines/calibration'
import { ConfigSchema, defaultConfig, type Config } from '../schema/config'
import { EngagementSchema, type Engagement } from '../schema/engagement'
import { LibrarySchema, type Library } from '../schema/library'
import { MetaSchema, type Meta } from '../schema/meta'
import { MigrationError, runMigrations } from '../schema/migrations/run-migrations'
import { WholeStoreSchema, type WholeStore } from '../schema/store'
import { CURRENT_SCHEMA_VERSION } from '../schema/version'
import { createDatabase, DATABASE_NAME } from './db'
import { recomputeDerived } from './derived'

// Every read and write of the working store goes through here. Reads are never trusted: each
// record is validated, and one that fails is reported and left in storage untouched rather
// than thrown past or overwritten, so a single corrupt record cannot take the app down.

const RECORD_KEY = { library: 'library', config: 'config', meta: 'meta' } as const

// The folder handle is not data, so it is never exported or mirrored. It lives in the config
// table under this key, which Config.storage.syncFolderHandleId records.
export const FOLDER_HANDLE_KEY = 'sync-folder-handle'

export type StoreTable = 'engagements' | 'library' | 'config' | 'meta'
type Issue = z.core.$ZodIssue

export interface StoreProblem {
  table: StoreTable
  key: string
  message: string
  issues: Issue[]
}

export interface LoadedStore {
  meta: Meta
  // Null when the stored record does not validate. Defaults are never substituted: they would
  // change every price, and a later save would overwrite the stored record without anyone asking.
  config: Config | null
  library: Library | null
  // Only the records that validate. The rest are reported and stay stored as they were.
  engagements: Engagement[]
}

export type RefusalReason = 'database-unavailable' | 'newer-version' | 'corrupt-meta' | 'migration-failed'

export type LoadResult =
  | {
      status: 'loaded'
      store: LoadedStore
      problems: StoreProblem[]
      seeded: boolean
      migratedFrom: number | null
      // Ids of engagements whose cached engine results were recomputed and written back.
      recomputed: string[]
      // True when Config or Library did not validate: the engines need both, so nothing was recomputed.
      recomputeSkipped: boolean
    }
  | { status: 'refused'; reason: RefusalReason; message: string; issues: Issue[] }

// Exactly what is stored, unvalidated: the export and the full folder mirror copy it byte for
// byte, so a corrupt record is preserved where it can be fixed by hand.
export interface RawStore {
  meta: unknown
  config: unknown
  library: unknown
  engagements: unknown[]
}

export type StoreChange =
  | { kind: 'engagement'; engagement: Engagement; previous: Engagement | null }
  | { kind: 'engagement-deleted'; id: string; previous: Engagement | null }
  | { kind: 'config'; config: Config }
  | { kind: 'library'; library: Library }
  // The whole store was replaced: seeded, migrated, imported or restored.
  | { kind: 'store'; store: WholeStore }

export interface RepositoryOptions {
  // The app uses the default; each test opens its own database.
  databaseName?: string
  clock: () => string
  appVersion: string
  // Called after each write has committed, which is how the folder mirror hears of it. It reports
  // its own failures: a throw from it never fails a write that is already stored.
  onWrite?: (change: StoreChange) => void | Promise<void>
}

export type Repository = ReturnType<typeof createRepository>

function emptyLibrary(): Library {
  return { patterns: [], questionSets: [], templates: [], calibration: [] }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// Read without trusting the shape, since the meta record is exactly what is in question.
function statedVersion(meta: unknown): unknown {
  if (typeof meta !== 'object' || meta === null || !('schemaVersion' in meta)) return undefined
  return meta.schemaVersion
}

function recordKey(value: unknown, index: number): string {
  if (typeof value === 'object' && value !== null && 'id' in value && typeof value.id === 'string') return value.id
  return `#${index}`
}

export function createRepository(options: RepositoryOptions) {
  const { clock, appVersion, onWrite } = options
  const db = createDatabase(options.databaseName ?? DATABASE_NAME)
  const allTables = [db.engagements, db.library, db.config, db.meta]

  const refused = (reason: RefusalReason, message: string, issues: Issue[] = []): LoadResult => ({
    status: 'refused',
    reason,
    message,
    issues,
  })

  async function notify(change: StoreChange): Promise<void> {
    if (onWrite === undefined) return
    try {
      await onWrite(change)
    } catch {
      // The listener owns its failures (the mirror reports them in its status). The data is stored.
    }
  }

  async function readRawStore(): Promise<RawStore> {
    return db.transaction('r', allTables, async () => ({
      meta: await db.meta.get(RECORD_KEY.meta),
      config: await db.config.get(RECORD_KEY.config),
      library: await db.library.get(RECORD_KEY.library),
      engagements: await db.engagements.toArray(),
    }))
  }

  // Engagements are cleared and rewritten; the config table is not cleared, so the folder handle
  // stored beside the Config record survives a replace.
  async function writeWholeStore(store: WholeStore): Promise<void> {
    await db.transaction('rw', allTables, async () => {
      await db.engagements.clear()
      await db.engagements.bulkPut(store.engagements)
      await db.library.put(store.library, RECORD_KEY.library)
      await db.config.put(store.config, RECORD_KEY.config)
      await db.meta.put(store.meta, RECORD_KEY.meta)
    })
  }

  async function readEngagement(id: string): Promise<Engagement | null> {
    const parsed = EngagementSchema.safeParse(await db.engagements.get(id))
    return parsed.success ? parsed.data : null
  }

  async function seed(): Promise<LoadResult> {
    const store: WholeStore = {
      meta: { schemaVersion: CURRENT_SCHEMA_VERSION, createdAt: clock(), lastMigratedAt: null, appVersion },
      config: defaultConfig(),
      library: emptyLibrary(),
      engagements: [],
    }
    await writeWholeStore(store)
    await notify({ kind: 'store', store })
    return {
      status: 'loaded',
      store: { meta: store.meta, config: store.config, library: store.library, engagements: [] },
      problems: [],
      seeded: true,
      migratedFrom: null,
      recomputed: [],
      recomputeSkipped: false,
    }
  }

  async function loadStore(): Promise<LoadResult> {
    let raw = await readRawStore()

    if (raw.meta === undefined) {
      if (raw.config === undefined && raw.library === undefined && raw.engagements.length === 0) return seed()
      return refused(
        'corrupt-meta',
        'The store holds data but no meta record, so its schema version is unknown. Nothing was loaded or changed.',
      )
    }

    // Refused before anything else is read into the app: parsing newer data would strip every
    // field this app does not know, and a later write would make the loss permanent.
    const version = statedVersion(raw.meta)
    if (typeof version === 'number' && Number.isInteger(version) && version > CURRENT_SCHEMA_VERSION) {
      return refused(
        'newer-version',
        `This data is at schema version ${version}, but this app only supports up to schema version ${CURRENT_SCHEMA_VERSION}. ` +
          'The app is older than the data. Update the app and try again. Nothing was changed.',
      )
    }

    let migratedFrom: number | null = null
    if (typeof version === 'number' && Number.isInteger(version) && version >= 1 && version < CURRENT_SCHEMA_VERSION) {
      let migrated: WholeStore
      try {
        migrated = runMigrations(raw, version)
      } catch (error) {
        // runMigrations works on a copy and never writes, so the stored data is exactly as it was.
        if (error instanceof MigrationError) return refused('migration-failed', error.message, error.issues)
        return refused('migration-failed', describeError(error))
      }
      const stamped: WholeStore = { ...migrated, meta: { ...migrated.meta, lastMigratedAt: clock(), appVersion } }
      await writeWholeStore(stamped)
      await notify({ kind: 'store', store: stamped })
      raw = stamped
      migratedFrom = version
    }

    const meta = MetaSchema.safeParse(raw.meta)
    if (!meta.success) {
      return refused('corrupt-meta', 'The meta record does not validate, so the schema version cannot be trusted. Nothing was loaded or changed.', meta.error.issues)
    }

    const problems: StoreProblem[] = []
    const config = ConfigSchema.safeParse(raw.config)
    if (!config.success) {
      problems.push({
        table: 'config',
        key: RECORD_KEY.config,
        message: 'The stored Config does not validate. It is unavailable until a Config is saved, imported or restored; the stored record is unchanged.',
        issues: config.error.issues,
      })
    }
    const library = LibrarySchema.safeParse(raw.library)
    if (!library.success) {
      problems.push({
        table: 'library',
        key: RECORD_KEY.library,
        message: 'The stored Library does not validate. It is unavailable until a Library is saved, imported or restored; the stored record is unchanged.',
        issues: library.error.issues,
      })
    }
    let engagements: Engagement[] = []
    for (const [index, value] of raw.engagements.entries()) {
      const parsed = EngagementSchema.safeParse(value)
      if (parsed.success) {
        engagements.push(parsed.data)
      } else {
        const key = recordKey(value, index)
        problems.push({
          table: 'engagements',
          key,
          message: `Engagement '${key}' does not validate, so it was left out. It is still stored, unchanged.`,
          issues: parsed.error.issues,
        })
      }
    }

    const recomputed: string[] = []
    const recomputeSkipped = !config.success || !library.success
    if (config.success && library.success) {
      const context = {
        config: config.data,
        patterns: library.data.patterns,
        calibration: buildCalibrationLookup(library.data.calibration),
        now: clock(),
      }
      const written: { engagement: Engagement; previous: Engagement }[] = []
      engagements = engagements.map((engagement) => {
        const result = recomputeDerived(engagement, context)
        if (result.replaced.length > 0) {
          recomputed.push(engagement.id)
          written.push({ engagement: result.engagement, previous: engagement })
        }
        return result.engagement
      })
      if (written.length > 0) {
        // Written back as they are: a recompute is not an edit, so updatedAt is not bumped.
        await db.engagements.bulkPut(written.map(({ engagement }) => engagement))
        for (const { engagement, previous } of written) await notify({ kind: 'engagement', engagement, previous })
      }
    }

    return {
      status: 'loaded',
      store: {
        meta: meta.data,
        config: config.success ? config.data : null,
        library: library.success ? library.data : null,
        engagements,
      },
      problems,
      seeded: false,
      migratedFrom,
      recomputed,
      recomputeSkipped,
    }
  }

  // Machine-local bookkeeping about the mirror itself. Not announced to onWrite: the mirror is its
  // only reader, and announcing its own sync time would make it mirror again, forever.
  async function updateStorageSettings(patch: Partial<Config['storage']>): Promise<void> {
    await db.transaction('rw', db.config, async () => {
      const parsed = ConfigSchema.safeParse(await db.config.get(RECORD_KEY.config))
      if (!parsed.success) return
      await db.config.put({ ...parsed.data, storage: { ...parsed.data.storage, ...patch } }, RECORD_KEY.config)
    })
  }

  return {
    // Opens, seeds, migrates, validates and recomputes. Never throws: every failure is a refusal.
    async load(): Promise<LoadResult> {
      try {
        return await loadStore()
      } catch (error) {
        return refused('database-unavailable', `The browser database could not be read or written: ${describeError(error)}`)
      }
    },

    readRawStore,

    // Validated before anything is written, so an invalid record throws and nothing is stored.
    async saveEngagement(engagement: Engagement): Promise<Engagement> {
      const next = EngagementSchema.parse({ ...engagement, updatedAt: clock() })
      const previous = await db.transaction('rw', db.engagements, async () => {
        const before = await readEngagement(next.id)
        await db.engagements.put(next)
        return before
      })
      await notify({ kind: 'engagement', engagement: next, previous })
      return next
    },

    async deleteEngagement(id: string): Promise<void> {
      const previous = await db.transaction('rw', db.engagements, async () => {
        const before = await readEngagement(id)
        await db.engagements.delete(id)
        return before
      })
      await notify({ kind: 'engagement-deleted', id, previous })
    },

    async saveConfig(config: Config): Promise<Config> {
      const next = ConfigSchema.parse(config)
      await db.config.put(next, RECORD_KEY.config)
      await notify({ kind: 'config', config: next })
      return next
    },

    async saveLibrary(library: Library): Promise<Library> {
      const next = LibrarySchema.parse(library)
      await db.library.put(next, RECORD_KEY.library)
      await notify({ kind: 'library', library: next })
      return next
    },

    // A full replace for import and restore, in one transaction. Records keep their own updatedAt.
    async replaceStore(store: WholeStore): Promise<WholeStore> {
      const next = WholeStoreSchema.parse(store)
      await writeWholeStore(next)
      await notify({ kind: 'store', store: next })
      return next
    },

    async saveFolderHandle(handle: unknown): Promise<void> {
      await db.config.put(handle, FOLDER_HANDLE_KEY)
      await updateStorageSettings({ syncFolderHandleId: FOLDER_HANDLE_KEY })
    },

    async loadFolderHandle(): Promise<unknown> {
      return db.config.get(FOLDER_HANDLE_KEY)
    },

    async clearFolderHandle(): Promise<void> {
      await db.config.delete(FOLDER_HANDLE_KEY)
      await updateStorageSettings({ syncFolderHandleId: null })
    },

    async recordSyncTime(at: string): Promise<void> {
      await updateStorageSettings({ lastSyncAt: at })
    },

    close(): void {
      db.close()
    },
  }
}
