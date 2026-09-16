import { useCallback, useEffect, useState } from 'react'
import { ConfigSchema, type Config } from '../schema/config'
import { createRepository, FOLDER_HANDLE_KEY, type LoadResult, type Repository } from '../storage/repository'
import { createFolderSync, warningFor, type FolderHandle, type FolderSync, type SyncStatus } from '../storage/sync'
import { applyImport, exportStore, prepareFolderRestore, prepareImportText, type ImportPreparation, type PreparedImport } from '../storage/transfer'

export interface StoreRuntimeOptions {
  clock: () => string
  appVersion: string
  // The browser's folder picker, or undefined where the File System Access API is missing.
  pickFolder: (() => Promise<FolderHandle>) | undefined
  // The app uses the default database; each test opens its own.
  databaseName?: string
}

type Loaded = Extract<LoadResult, { status: 'loaded' }>
type Refused = Extract<LoadResult, { status: 'refused' }>

export type BootedStore =
  | { phase: 'refused'; refusal: Refused }
  | { phase: 'loaded'; load: Loaded; sync: SyncStatus; syncError: string | null }

export type StoreState = { phase: 'loading' } | BootedStore

export interface StoreRuntime {
  repository: Repository
  sync: FolderSync
  clock: () => string
  appVersion: string
  // Also used to choose a mirrored folder to restore from.
  pickFolder: (() => Promise<FolderHandle>) | undefined
  // Loads once however often it is called, so StrictMode's second effect run cannot load twice.
  boot(): Promise<BootedStore>
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function bootStore(
  repository: Pick<Repository, 'load'>,
  sync: Pick<FolderSync, 'restore' | 'status'>,
): Promise<BootedStore> {
  const load = await repository.load()
  // Nothing was loaded, so the folder is left exactly as it is.
  if (load.status === 'refused') return { phase: 'refused', refusal: load }
  try {
    return { phase: 'loaded', load, sync: await sync.restore(load.store.config?.storage ?? null), syncError: null }
  } catch (error) {
    // The data is loaded and safe in IndexedDB; a folder that cannot be restored must not hide it.
    return { phase: 'loaded', load, sync: sync.status(), syncError: describeError(error) }
  }
}

export function createStoreRuntime(options: StoreRuntimeOptions): StoreRuntime {
  const { clock, appVersion, pickFolder, databaseName } = options
  // The repository announces writes to a sync that needs the repository itself, so the listener
  // looks the sync up when a write happens, after both exist.
  const repository = createRepository({ databaseName, clock, appVersion, onWrite: (change) => sync.mirror(change) })
  const sync = createFolderSync({ repository, clock, pickFolder })
  let booting: Promise<BootedStore> | null = null
  return { repository, sync, clock, appVersion, pickFolder, boot: () => (booting ??= bootStore(repository, sync)) }
}

// The state after a reload. A reload that is refused replaces the page, exactly as at boot. The folder
// restore error from boot still stands: a reload does not restore the folder again.
export function afterReload(load: LoadResult, sync: SyncStatus, syncError: string | null): BootedStore {
  return load.status === 'refused' ? { phase: 'refused', refusal: load } : { phase: 'loaded', load, sync, syncError }
}

// Saves a Config edited in Settings, then reloads, which recomputes every cache that reads Config.
// The folder handle id and last sync time are not the form's to set: connecting a folder or a mirror
// write after the form was opened changes them in storage, and the form's copy would put them back.
// So they are taken from what is stored. Throws, writing nothing, when the Config does not validate.
export async function saveSettings(repository: Pick<Repository, 'readRawStore' | 'loadFolderHandle' | 'saveConfig' | 'load'>, config: Config): Promise<LoadResult> {
  const stored = ConfigSchema.safeParse((await repository.readRawStore()).config)
  const handleStored = (await repository.loadFolderHandle()) !== undefined
  const storage: Config['storage'] = {
    ...config.storage,
    syncFolderHandleId: handleStored ? FOLDER_HANDLE_KEY : null,
    lastSyncAt: stored.success ? stored.data.storage.lastSyncAt : config.storage.lastSyncAt,
  }
  await repository.saveConfig({ ...config, storage })
  return repository.load()
}

// Null when the browser has no folder picker or the picker was closed: nothing was chosen, so there
// is nothing to report.
export async function prepareRestore(
  pickFolder: (() => Promise<FolderHandle>) | undefined,
  repository: Pick<Repository, 'readRawStore'>,
  now: string,
): Promise<ImportPreparation | null> {
  if (pickFolder === undefined) return null
  let folder: FolderHandle
  try {
    folder = await pickFolder()
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null
    throw error
  }
  return prepareFolderRestore(folder, repository, now)
}

export type ActionResult = { ok: true } | { ok: false; message: string }

export interface StoreHandle {
  state: StoreState
  // The persistent banner text for every sync state short of a healthy connection.
  syncWarning: string | null
  // Connecting needs a user gesture: the browser grants folder permission only from one.
  connect: () => Promise<void>
  reconnect: () => Promise<void>
  disconnect: () => Promise<void>
  syncNow: () => Promise<void>
  saveConfig: (config: Config) => Promise<ActionResult>
  exportStore: () => Promise<{ filename: string; text: string }>
  // Nothing is written by either; only applyImport writes, after the diff is confirmed.
  prepareImport: (text: string) => Promise<ImportPreparation>
  prepareRestore: () => Promise<ImportPreparation | null>
  applyImport: (prepared: PreparedImport) => Promise<ActionResult>
  // False where the browser cannot pick a folder, so there is nothing to restore from.
  canPickFolder: boolean
}

export function useStore(runtime: StoreRuntime): StoreHandle {
  const [state, setState] = useState<StoreState>({ phase: 'loading' })

  useEffect(() => {
    let current = true
    void runtime.boot().then((booted) => {
      if (current) setState(booted)
    })
    return () => {
      current = false
    }
  }, [runtime])

  const follow = useCallback(
    async (step: () => Promise<SyncStatus>) => {
      let sync: SyncStatus
      let syncError: string | null = null
      try {
        sync = await step()
      } catch (error) {
        sync = runtime.sync.status()
        syncError = describeError(error)
      }
      setState((previous) => (previous.phase === 'loaded' ? { ...previous, sync, syncError } : previous))
    },
    [runtime],
  )

  // A save or import writes through the mirror, so the sync status is read again with the reload.
  const reload = useCallback(
    async (write: () => Promise<LoadResult>): Promise<ActionResult> => {
      try {
        const load = await write()
        setState((previous) => afterReload(load, runtime.sync.status(), previous.phase === 'loaded' ? previous.syncError : null))
        return { ok: true }
      } catch (error) {
        setState((previous) => (previous.phase === 'loaded' ? { ...previous, sync: runtime.sync.status() } : previous))
        return { ok: false, message: describeError(error) }
      }
    },
    [runtime],
  )

  const connect = useCallback(() => follow(() => runtime.sync.connect()), [follow, runtime])
  const reconnect = useCallback(() => follow(() => runtime.sync.reconnect()), [follow, runtime])
  const disconnect = useCallback(() => follow(() => runtime.sync.disconnect()), [follow, runtime])
  const syncNow = useCallback(
    () =>
      follow(async () => {
        await runtime.sync.syncNow()
        return runtime.sync.status()
      }),
    [follow, runtime],
  )
  const saveConfig = useCallback((config: Config) => reload(() => saveSettings(runtime.repository, config)), [reload, runtime])
  const applyPrepared = useCallback((prepared: PreparedImport) => reload(() => applyImport(prepared, runtime.repository)), [reload, runtime])

  return {
    state,
    syncWarning: state.phase === 'loaded' ? warningFor(state.sync) : null,
    connect,
    reconnect,
    disconnect,
    syncNow,
    saveConfig,
    exportStore: () => exportStore(runtime.repository, runtime.clock()),
    prepareImport: (text: string) => prepareImportText(text, runtime.repository, runtime.clock()),
    prepareRestore: () => prepareRestore(runtime.pickFolder, runtime.repository, runtime.clock()),
    applyImport: applyPrepared,
    canPickFolder: runtime.pickFolder !== undefined,
  }
}
