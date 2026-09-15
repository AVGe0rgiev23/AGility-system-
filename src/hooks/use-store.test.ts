import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { newEngagement, wholeStore } from '../schema/__fixtures__/records'
import { MemoryFolder } from '../storage/__fixtures__/memory-folder'
import type { LoadResult } from '../storage/repository'
import { engagementFolderName, type SyncStatus } from '../storage/sync'
import { bootStore, createStoreRuntime, type StoreRuntime } from './use-store'

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
