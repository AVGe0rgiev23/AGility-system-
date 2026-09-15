import { useCallback, useEffect, useState } from 'react'
import { createRepository, type LoadResult, type Repository } from '../storage/repository'
import { createFolderSync, warningFor, type FolderHandle, type FolderSync, type SyncStatus } from '../storage/sync'

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
  return { repository, sync, boot: () => (booting ??= bootStore(repository, sync)) }
}

export interface StoreHandle {
  state: StoreState
  // The persistent banner text for every sync state short of a healthy connection.
  syncWarning: string | null
  // Both need a user gesture: the browser grants folder permission only from one.
  connect: () => Promise<void>
  reconnect: () => Promise<void>
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

  const connect = useCallback(() => follow(() => runtime.sync.connect()), [follow, runtime])
  const reconnect = useCallback(() => follow(() => runtime.sync.reconnect()), [follow, runtime])

  return { state, syncWarning: state.phase === 'loaded' ? warningFor(state.sync) : null, connect, reconnect }
}
