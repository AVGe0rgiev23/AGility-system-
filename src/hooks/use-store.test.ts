import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { newEngagement, wholeStore } from '../schema/__fixtures__/records'
import { ConfigSchema, defaultConfig } from '../schema/config'
import { MemoryFolder } from '../storage/__fixtures__/memory-folder'
import { plant } from '../storage/__fixtures__/raw-idb'
import { FOLDER_HANDLE_KEY, type LoadResult } from '../storage/repository'
import { engagementFolderName, type SyncStatus } from '../storage/sync'
import { afterReload, bootStore, createStoreRuntime, deleteAndReload, prepareRestore, saveAndReload, saveSettings, type StoreRuntime } from './use-store'

const T1 = '2026-09-15T09:00:00.000Z'

let runtime: StoreRuntime | undefined
afterEach(() => runtime?.repository.close())

function loaded(): Extract<LoadResult, { status: 'loaded' }> {
  const store = wholeStore()
  return { status: 'loaded', store, problems: [], seeded: false, migratedFrom: null, recomputed: [], recomputeSkipped: false }
}

describe('createStoreRuntime', () => {
  it('seeds an empty database, with sync unsupported where the browser has no folder picker', async () => {
    runtime = createStoreRuntime({ databaseName: 'boot-unsupported', clock: () => T1, appVersion: '0.1.0', pickFolder: undefined })
    const booted = await runtime.boot()
    expect(booted.phase).toBe('loaded')
    if (booted.phase !== 'loaded') return
    expect(booted.load.seeded).toBe(true)
    expect(booted.sync).toEqual({ kind: 'unsupported' })
    expect(booted.syncError).toBeNull()
  })

  it('reports no folder connected where the browser has a folder picker', async () => {
    const folder = new MemoryFolder('agility-os-data')
    runtime = createStoreRuntime({ databaseName: 'boot-disconnected', clock: () => T1, appVersion: '0.1.0', pickFolder: () => Promise.resolve(folder) })
    expect(await runtime.boot()).toMatchObject({ phase: 'loaded', sync: { kind: 'disconnected' } })
  })

  it('loads once however often boot is called, as StrictMode runs effects twice', async () => {
    let ticks = 0
    const clock = () => new Date(Date.UTC(2026, 8, 15, 9, 0, ticks++)).toISOString()
    runtime = createStoreRuntime({ databaseName: 'boot-once', clock, appVersion: '0.1.0', pickFolder: undefined })
    const first = runtime.boot()
    expect(runtime.boot()).toBe(first)
    const booted = await first
    const ticksAfterBoot = ticks
    await runtime.boot()
    expect(ticks).toBe(ticksAfterBoot)
    expect(booted.phase).toBe('loaded')
  })

  it('mirrors a saved engagement to a connected folder, through the late-bound write listener', async () => {
    const folder = new MemoryFolder('agility-os-data')
    runtime = createStoreRuntime({ databaseName: 'boot-mirror', clock: () => T1, appVersion: '0.1.0', pickFolder: () => Promise.resolve(folder) })
    await runtime.boot()
    expect(await runtime.sync.connect()).toMatchObject({ kind: 'connected', folderName: 'agility-os-data' })
    const saved = await runtime.repository.saveEngagement(newEngagement())
    const path = `engagements/${engagementFolderName(saved.id, saved.company.name)}/engagement.json`
    expect(JSON.parse(folder.read(path) ?? 'null')).toEqual(saved)
  })
})

describe('bootStore', () => {
  it('restores the folder from the loaded Config storage block', async () => {
    const load = loaded()
    const restore = vi.fn((): Promise<SyncStatus> => Promise.resolve({ kind: 'disconnected' }))
    const booted = await bootStore({ load: () => Promise.resolve(load) }, { restore, status: () => ({ kind: 'disconnected' }) })
    expect(restore).toHaveBeenCalledWith(load.store.config?.storage)
    expect(booted).toEqual({ phase: 'loaded', load, sync: { kind: 'disconnected' }, syncError: null })
  })

  it('restores with no storage block when the stored Config did not validate', async () => {
    const load = loaded()
    load.store.config = null
    const restore = vi.fn((): Promise<SyncStatus> => Promise.resolve({ kind: 'disconnected' }))
    await bootStore({ load: () => Promise.resolve(load) }, { restore, status: () => ({ kind: 'disconnected' }) })
    expect(restore).toHaveBeenCalledWith(null)
  })

  it('returns a refusal without touching the folder', async () => {
    const refusal: LoadResult = { status: 'refused', reason: 'newer-version', message: 'The app is older than the data.', issues: [] }
    const restore = vi.fn((): Promise<SyncStatus> => Promise.resolve({ kind: 'disconnected' }))
    const booted = await bootStore({ load: () => Promise.resolve(refusal) }, { restore, status: () => ({ kind: 'disconnected' }) })
    expect(booted).toEqual({ phase: 'refused', refusal })
    expect(restore).not.toHaveBeenCalled()
  })

  it('still loads the store when restoring the folder throws, and reports why', async () => {
    const load = loaded()
    const booted = await bootStore(
      { load: () => Promise.resolve(load) },
      { restore: () => Promise.reject(new Error('the permission query failed')), status: () => ({ kind: 'disconnected' }) },
    )
    expect(booted).toEqual({ phase: 'loaded', load, sync: { kind: 'disconnected' }, syncError: 'the permission query failed' })
  })
})

describe('saveSettings', () => {
  it('saves the Config and reloads the store with it', async () => {
    runtime = createStoreRuntime({ databaseName: 'settings-save', clock: () => T1, appVersion: '0.1.0', pickFolder: undefined })
    await runtime.boot()
    const config = defaultConfig()
    config.pricing.targetHourlyRate = 72.5
    config.storage.autoSyncOnWrite = false
    const load = await saveSettings(runtime.repository, config)
    expect(load.status).toBe('loaded')
    if (load.status !== 'loaded') return
    expect(load.store.config).toEqual(config)
    expect(ConfigSchema.parse((await runtime.repository.readRawStore()).config)).toEqual(config)
  })

  it('keeps the folder handle id and last sync time that a connect stored after the form was opened', async () => {
    const folder = new MemoryFolder('agility-os-data')
    runtime = createStoreRuntime({ databaseName: 'settings-connect', clock: () => T1, appVersion: '0.1.0', pickFolder: () => Promise.resolve(folder) })
    const booted = await runtime.boot()
    if (booted.phase !== 'loaded' || booted.load.store.config === null) throw new Error('expected a loaded Config')
    const opened = booted.load.store.config
    expect(opened.storage).toEqual({ syncFolderHandleId: null, autoSyncOnWrite: true, lastSyncAt: null })

    await runtime.sync.connect()
    const load = await saveSettings(runtime.repository, { ...opened, pricing: { ...opened.pricing, targetHourlyRate: 80 } })
    if (load.status !== 'loaded' || load.store.config === null) throw new Error('expected a loaded Config')
    expect(load.store.config.pricing.targetHourlyRate).toBe(80)
    expect(load.store.config.storage).toEqual({ syncFolderHandleId: FOLDER_HANDLE_KEY, autoSyncOnWrite: true, lastSyncAt: T1 })
    expect(JSON.parse(folder.read('config.json') ?? 'null')).toMatchObject({ pricing: { targetHourlyRate: 80 } })
  })

  it('records no folder once disconnected, whatever the form still holds', async () => {
    const folder = new MemoryFolder('agility-os-data')
    runtime = createStoreRuntime({ databaseName: 'settings-disconnect', clock: () => T1, appVersion: '0.1.0', pickFolder: () => Promise.resolve(folder) })
    await runtime.boot()
    await runtime.sync.connect()
    const stale = ConfigSchema.parse((await runtime.repository.readRawStore()).config)
    await runtime.sync.disconnect()
    const load = await saveSettings(runtime.repository, stale)
    expect(load).toMatchObject({ status: 'loaded', store: { config: { storage: { syncFolderHandleId: null, lastSyncAt: T1 } } } })
  })

  it('records a stored folder handle when saving over an unusable stored Config', async () => {
    const folder = new MemoryFolder('agility-os-data')
    const databaseName = 'settings-corrupt'
    runtime = createStoreRuntime({ databaseName, clock: () => T1, appVersion: '0.1.0', pickFolder: () => Promise.resolve(folder) })
    await runtime.boot()
    await runtime.sync.connect()
    await plant(databaseName, [{ table: 'config', key: 'config', value: { pricing: 'not a config' } }])
    expect(await runtime.repository.load()).toMatchObject({ status: 'loaded', store: { config: null } })

    const load = await saveSettings(runtime.repository, defaultConfig())
    // The last sync time is the mirror's own record of writing the saved Config to the folder.
    expect(load).toMatchObject({ status: 'loaded', store: { config: { storage: { syncFolderHandleId: FOLDER_HANDLE_KEY, lastSyncAt: T1 } } } })
    expect(JSON.parse(folder.read('config.json') ?? 'null')).toMatchObject({ pricing: defaultConfig().pricing })
  })

  it('throws and writes nothing when the Config does not validate', async () => {
    runtime = createStoreRuntime({ databaseName: 'settings-invalid', clock: () => T1, appVersion: '0.1.0', pickFolder: undefined })
    await runtime.boot()
    const broken = defaultConfig()
    broken.roi.horizonYears = 2.5
    await expect(saveSettings(runtime.repository, broken)).rejects.toThrow()
    expect((await runtime.repository.readRawStore()).config).toEqual(defaultConfig())
  })
})

describe('prepareRestore', () => {
  it('prepares a restore from a chosen mirrored folder, with a diff and nothing written', async () => {
    const folder = new MemoryFolder('agility-os-data')
    runtime = createStoreRuntime({ databaseName: 'restore-source', clock: () => T1, appVersion: '0.1.0', pickFolder: () => Promise.resolve(folder) })
    await runtime.boot()
    await runtime.sync.connect()
    await runtime.repository.saveEngagement(newEngagement())
    runtime.repository.close()

    runtime = createStoreRuntime({ databaseName: 'restore-target', clock: () => T1, appVersion: '0.1.0', pickFolder: () => Promise.resolve(folder) })
    await runtime.boot()
    const before = await runtime.repository.readRawStore()
    const preparation = await prepareRestore(runtime.pickFolder, runtime.repository, T1)
    expect(preparation).toMatchObject({ ok: true, diff: { engagements: { added: [{ id: newEngagement().id }], removed: [], changed: [] } } })
    expect(await runtime.repository.readRawStore()).toEqual(before)
  })

  it('returns null when the browser has no picker or the picker is closed', async () => {
    const repository = { readRawStore: vi.fn() }
    expect(await prepareRestore(undefined, repository, T1)).toBeNull()
    expect(await prepareRestore(() => Promise.reject(new DOMException('closed', 'AbortError')), repository, T1)).toBeNull()
    expect(repository.readRawStore).not.toHaveBeenCalled()
  })

  it('passes on any other picker failure', async () => {
    const repository = { readRawStore: vi.fn() }
    await expect(prepareRestore(() => Promise.reject(new DOMException('blocked', 'SecurityError')), repository, T1)).rejects.toThrow('blocked')
  })
})

describe('afterReload', () => {
  it('keeps the boot folder error on a loaded store and replaces the page on a refusal', () => {
    const load = loaded()
    expect(afterReload(load, { kind: 'unsupported' }, 'the permission query failed')).toEqual({
      phase: 'loaded',
      load,
      sync: { kind: 'unsupported' },
      syncError: 'the permission query failed',
    })
    const refusal: LoadResult = { status: 'refused', reason: 'database-unavailable', message: 'gone', issues: [] }
    expect(afterReload(refusal, { kind: 'unsupported' }, null)).toEqual({ phase: 'refused', refusal })
  })
})

describe('saveAndReload and deleteAndReload', () => {
  it('saves an engagement, bumping updatedAt, and reloads the store with it', async () => {
    runtime = createStoreRuntime({ databaseName: 'engagement-save', clock: () => T1, appVersion: '0.1.0', pickFolder: undefined })
    await runtime.boot()
    const created = { ...newEngagement(), updatedAt: '2026-01-01T00:00:00.000Z' }
    const load = await saveAndReload(runtime.repository, created)
    if (load.status !== 'loaded') throw new Error('expected a loaded store')
    expect(load.store.engagements).toEqual([{ ...created, updatedAt: T1 }])
  })

  it('refuses an engagement that breaks a capture rule and writes nothing', async () => {
    runtime = createStoreRuntime({ databaseName: 'engagement-invalid', clock: () => T1, appVersion: '0.1.0', pickFolder: undefined })
    await runtime.boot()
    const broken = { ...newEngagement(), company: { ...newEngagement().company, name: ' ' } }
    await expect(saveAndReload(runtime.repository, broken)).rejects.toThrow()
    expect((await runtime.repository.readRawStore()).engagements).toEqual([])
  })

  it('deletes an engagement and reloads without it, leaving its folder on disk reported as stale', async () => {
    const folder = new MemoryFolder('agility-os-data')
    runtime = createStoreRuntime({ databaseName: 'engagement-delete', clock: () => T1, appVersion: '0.1.0', pickFolder: () => Promise.resolve(folder) })
    await runtime.boot()
    await runtime.sync.connect()
    const kept = { ...newEngagement(), id: 'eng-kept' }
    await saveAndReload(runtime.repository, newEngagement())
    await saveAndReload(runtime.repository, kept)
    const name = engagementFolderName(newEngagement().id, newEngagement().company.name)

    const load = await deleteAndReload(runtime.repository, newEngagement().id)
    if (load.status !== 'loaded') throw new Error('expected a loaded store')
    expect(load.store.engagements.map((item) => item.id)).toEqual(['eng-kept'])
    expect(folder.read(`engagements/${name}/engagement.json`)).toBeDefined()
    expect(runtime.sync.status()).toMatchObject({ kind: 'connected', staleFolders: [name] })
  })
})
