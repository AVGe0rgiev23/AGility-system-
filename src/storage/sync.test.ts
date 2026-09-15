import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { engagement, newEngagement, wholeStore } from '../schema/__fixtures__/records'
import type { WholeStore } from '../schema/store'
import { MemoryFolder } from './__fixtures__/memory-folder'
import { createRepository, type RawStore, type Repository } from './repository'
import {
  browserFolderPicker,
  createFolderSync,
  engagementFolderName,
  readFolderStore,
  warningFor,
  type FolderSync,
  type SyncStatus,
} from './sync'

const T1 = '2026-09-16T09:00:00.000Z'

const LAYOUT = [
  '.schema-version',
  'config.json',
  'engagements/rila-logistics-eng1/engagement.json',
  'engagements/solo-bakery-eng2/engagement.json',
  'library/calibration.json',
  'library/patterns.json',
  'library/question-sets.json',
  'library/templates.json',
  'meta.json',
]

function stubRepository(store: RawStore = wholeStore()) {
  const state = { store, handle: undefined as unknown, syncTimes: [] as string[] }
  const repository = {
    readRawStore: () => Promise.resolve(state.store),
    saveFolderHandle: (handle: unknown) => {
      state.handle = handle
      return Promise.resolve()
    },
    loadFolderHandle: () => Promise.resolve(state.handle),
    clearFolderHandle: () => {
      state.handle = undefined
      return Promise.resolve()
    },
    recordSyncTime: (at: string) => {
      state.syncTimes.push(at)
      return Promise.resolve()
    },
  }
  return { state, repository }
}

function setup(store?: RawStore) {
  const folder = new MemoryFolder('agility-os-data')
  const { state, repository } = stubRepository(store)
  const sync = createFolderSync({ repository, clock: () => T1, pickFolder: () => Promise.resolve(folder) })
  return { folder, state, sync }
}

function parsed(folder: MemoryFolder, path: string): unknown {
  const text = folder.read(path)
  if (text === undefined) throw new Error(`no file at ${path}`)
  return JSON.parse(text) as unknown
}

function staleOf(status: SyncStatus): string[] {
  return status.kind === 'connected' || status.kind === 'error' ? status.staleFolders : []
}

describe('feature detection and warnings', () => {
  it('reports unsupported without the File System Access API, with a persistent export warning', () => {
    expect(browserFolderPicker()).toBeUndefined()
    const sync = createFolderSync({ repository: stubRepository().repository, clock: () => T1, pickFolder: undefined })
    expect(sync.status()).toEqual({ kind: 'unsupported' })
    expect(warningFor(sync.status())).toContain('export it regularly')
  })

  it('starts disconnected where the API exists, and warns that no folder is connected', () => {
    const { sync } = setup()
    expect(sync.status()).toEqual({ kind: 'disconnected' })
    expect(warningFor(sync.status())).toContain('No folder is connected')
  })

  it('has no warning once connected with nothing stale', async () => {
    const { sync } = setup()
    expect(warningFor(await sync.connect())).toBeNull()
  })
})

describe('engagementFolderName', () => {
  it('builds <slug>-<shortid> from the company name and id', () => {
    expect(engagementFolderName('eng-1', 'Rila Logistics')).toBe('rila-logistics-eng1')
    expect(engagementFolderName('3f2a9c1e-77aa-4c1b-9d2e-000000000000', 'Café  Ünïcode, Ltd.')).toBe('cafe-unicode-ltd-3f2a9c1e')
  })

  it('falls back to a generic slug when the name has no Latin letters or digits', () => {
    expect(engagementFolderName('eng-9', 'Рила Логистика')).toBe('engagement-eng9')
  })
})

describe('connect', () => {
  it('mirrors the whole store to the documented layout and keeps the handle', async () => {
    const { folder, state, sync } = setup()
    const status = await sync.connect()
    expect(status).toEqual({ kind: 'connected', folderName: 'agility-os-data', lastSyncAt: T1, staleFolders: [] })
    expect(folder.paths()).toEqual(LAYOUT)
    const store = wholeStore()
    expect(folder.read('.schema-version')).toBe(`${store.meta.schemaVersion}\n`)
    expect(parsed(folder, 'meta.json')).toEqual(store.meta)
    expect(parsed(folder, 'config.json')).toEqual(store.config)
    expect(parsed(folder, 'library/question-sets.json')).toEqual(store.library.questionSets)
    expect(parsed(folder, 'engagements/rila-logistics-eng1/engagement.json')).toEqual(store.engagements[0])
    expect(folder.read('config.json')?.endsWith('}\n')).toBe(true)
    expect(state.handle).toBe(folder)
    expect(state.syncTimes).toEqual([T1])
  })

  it('keeps the previous state when the picker is closed', async () => {
    const { repository } = stubRepository()
    const sync = createFolderSync({
      repository,
      clock: () => T1,
      pickFolder: () => Promise.reject(new DOMException('closed', 'AbortError')),
    })
    expect(await sync.connect()).toEqual({ kind: 'disconnected' })
  })

  it('reports needs-permission when write access is refused', async () => {
    const { folder, state, sync } = setup()
    folder.grants = 'denied'
    expect(await sync.connect()).toEqual({ kind: 'needs-permission', folderName: 'agility-os-data' })
    expect(folder.paths()).toEqual([])
    expect(state.handle).toBeUndefined()
  })
})

describe('mirroring writes', () => {
  it('writes only the engagement that changed', async () => {
    const { folder, sync } = setup()
    await sync.connect()
    const saved = { ...engagement(), tags: ['logistics', 'priority'] }
    await sync.mirror({ kind: 'engagement', engagement: saved, previous: engagement() })
    expect(parsed(folder, 'engagements/rila-logistics-eng1/engagement.json')).toEqual(saved)
    expect(folder.writesTo('engagements/rila-logistics-eng1/engagement.json')).toBe(2)
    expect(folder.writesTo('engagements/solo-bakery-eng2/engagement.json')).toBe(1)
    expect(folder.writesTo('config.json')).toBe(1)
  })

  it('writes config.json and the four library files on their own changes', async () => {
    const { folder, sync } = setup()
    await sync.connect()
    const store = wholeStore()
    await sync.mirror({ kind: 'config', config: store.config })
    await sync.mirror({ kind: 'library', library: store.library })
    expect(folder.writesTo('config.json')).toBe(2)
    expect(folder.writesTo('library/patterns.json')).toBe(2)
    expect(folder.writesTo('meta.json')).toBe(1)
  })

  it('writes a renamed company to a new folder, keeps the old copy, and reports the old folder as stale', async () => {
    const { folder, sync } = setup()
    await sync.connect()
    const renamed = { ...engagement(), company: { ...engagement().company, name: 'Rila Freight' } }
    await sync.mirror({ kind: 'engagement', engagement: renamed, previous: engagement() })
    expect(parsed(folder, 'engagements/rila-freight-eng1/engagement.json')).toEqual(renamed)
    expect(parsed(folder, 'engagements/rila-logistics-eng1/engagement.json')).toEqual(engagement())
    expect(staleOf(sync.status())).toEqual(['rila-logistics-eng1'])
    expect(warningFor(sync.status())).toContain('rila-logistics-eng1')
  })

  it('reports a deleted engagement’s folder as stale and removes nothing', async () => {
    const { folder, sync } = setup()
    await sync.connect()
    const before = folder.paths()
    await sync.mirror({ kind: 'engagement-deleted', id: 'eng-2', previous: newEngagement() })
    expect(folder.paths()).toEqual(before)
    expect(staleOf(sync.status())).toEqual(['solo-bakery-eng2'])
  })

  it('reports folders on disk that the store no longer writes, after a full mirror, and deletes none', async () => {
    const { folder, sync } = setup()
    await folder.put('engagements/old-client-eng7/engagement.json', '{}\n')
    await folder.put('engagements/old-client-eng7/rendered/proposal-v1.html', '<p>kept</p>')
    await sync.connect()
    expect(staleOf(sync.status())).toEqual(['old-client-eng7'])
    expect(folder.read('engagements/old-client-eng7/rendered/proposal-v1.html')).toBe('<p>kept</p>')

    const store: WholeStore = { ...wholeStore(), engagements: [newEngagement()] }
    await sync.mirror({ kind: 'store', store })
    expect(staleOf(sync.status())).toEqual(['old-client-eng7', 'rila-logistics-eng1'])
    expect(folder.paths()).toContain('engagements/rila-logistics-eng1/engagement.json')
  })

  it('turns a failed write into an error status without throwing, and recovers on the next write', async () => {
    const { folder, sync } = setup()
    await sync.connect()
    folder.failure = new Error('disk full')
    await expect(sync.mirror({ kind: 'config', config: wholeStore().config })).resolves.toBeUndefined()
    expect(sync.status()).toMatchObject({ kind: 'error', folderName: 'agility-os-data', message: 'disk full' })
    expect(warningFor(sync.status())).toContain('safe in this browser')
    folder.failure = null
    await sync.mirror({ kind: 'config', config: wholeStore().config })
    expect(sync.status().kind).toBe('connected')
  })

  it('skips per-write mirroring when autoSyncOnWrite is off, while a manual sync still writes', async () => {
    const { folder, sync } = setup()
    await sync.connect()
    const config = wholeStore().config
    config.storage.autoSyncOnWrite = false
    await sync.mirror({ kind: 'config', config })
    await sync.mirror({ kind: 'engagement', engagement: { ...newEngagement(), tags: ['late'] }, previous: newEngagement() })
    expect(folder.writesTo('config.json')).toBe(1)
    expect(folder.writesTo('engagements/solo-bakery-eng2/engagement.json')).toBe(1)
    await sync.syncNow()
    expect(folder.writesTo('config.json')).toBe(2)
  })

  it('writes nothing when no folder is connected', async () => {
    const { folder, sync } = setup()
    await sync.mirror({ kind: 'config', config: wholeStore().config })
    expect(folder.paths()).toEqual([])
  })

  it('keeps the last of several quick writes to one file', async () => {
    const { folder, sync } = setup()
    await sync.connect()
    const versions = [1, 2, 3].map((n) => ({ ...newEngagement(), tags: [`v${n}`] }))
    await Promise.all(versions.map((version) => sync.mirror({ kind: 'engagement', engagement: version, previous: null })))
    expect(parsed(folder, 'engagements/solo-bakery-eng2/engagement.json')).toEqual(versions[2])
  })
})

describe('restore, reconnect and disconnect', () => {
  it('reconnects a stored folder that still has permission and catches it up', async () => {
    const { folder, state, sync } = setup()
    state.handle = folder
    const status = await sync.restore(wholeStore().config.storage)
    expect(status.kind).toBe('connected')
    expect(folder.paths()).toEqual(LAYOUT)
  })

  it('asks for permission again rather than writing when it has lapsed, then writes on reconnect', async () => {
    const { folder, state, sync } = setup()
    state.handle = folder
    folder.permission = 'prompt'
    expect(await sync.restore(wholeStore().config.storage)).toEqual({ kind: 'needs-permission', folderName: 'agility-os-data' })
    await sync.mirror({ kind: 'config', config: wholeStore().config })
    expect(folder.paths()).toEqual([])
    expect((await sync.reconnect()).kind).toBe('connected')
    expect(folder.paths()).toEqual(LAYOUT)
  })

  it('treats a stored value that is not a folder handle as disconnected', async () => {
    const { state, sync } = setup()
    state.handle = { kind: 'directory', name: 'cloned without methods' }
    expect(await sync.restore(null)).toEqual({ kind: 'disconnected' })
  })

  it('forgets the folder on disconnect without touching it', async () => {
    const { folder, state, sync } = setup()
    await sync.connect()
    const before = folder.paths()
    expect(await sync.disconnect()).toEqual({ kind: 'disconnected' })
    expect(state.handle).toBeUndefined()
    await sync.mirror({ kind: 'config', config: wholeStore().config })
    expect(folder.paths()).toEqual(before)
    expect(folder.writesTo('config.json')).toBe(1)
  })
})

describe('readFolderStore', () => {
  it('reads a mirrored folder back into the store it came from', async () => {
    const { folder, sync } = setup()
    await sync.connect()
    const read = await readFolderStore(folder)
    expect(read.errors).toEqual([])
    expect(read.schemaVersion).toBe(wholeStore().meta.schemaVersion)
    const store = wholeStore()
    expect(read.store.meta).toEqual(store.meta)
    expect(read.store.config).toEqual(store.config)
    expect(read.store.library).toEqual(store.library)
    expect(read.store.engagements).toEqual(store.engagements)
  })

  it('reports unparseable files and an unreadable version', async () => {
    const folder = new MemoryFolder('broken')
    await folder.put('.schema-version', 'two\n')
    await folder.put('config.json', '{ not json')
    const read = await readFolderStore(folder)
    expect(read.schemaVersion).toBeNull()
    expect(read.errors.map((error) => error.path)).toEqual(['.schema-version', 'config.json'])
    expect(read.store.config).toBeUndefined()
  })

  it('refuses to guess between two folders holding the same engagement', async () => {
    const { folder, sync } = setup()
    await sync.connect()
    const renamed = { ...engagement(), company: { ...engagement().company, name: 'Rila Freight' } }
    await sync.mirror({ kind: 'engagement', engagement: renamed, previous: engagement() })
    const read = await readFolderStore(folder)
    expect(read.errors).toEqual([
      {
        path: 'engagements/rila-logistics-eng1/engagement.json',
        message: "engagement 'eng-1' is also in 'engagements/rila-freight-eng1'; delete the stale folder by hand and restore again",
      },
    ])
  })
})

describe('wired to the repository', () => {
  let repository: Repository | undefined
  afterEach(() => repository?.close())

  it('mirrors a saved engagement to disk through onWrite', async () => {
    const folder = new MemoryFolder('agility-os-data')
    // The app's wiring: the repository announces writes to a sync that needs the repository itself,
    // so the listener looks the sync up when it runs, after both exist.
    repository = createRepository({
      databaseName: 'sync-wired-test',
      clock: () => T1,
      appVersion: '0.1.0',
      onWrite: (change) => sync.mirror(change),
    })
    const sync: FolderSync = createFolderSync({ repository, clock: () => T1, pickFolder: () => Promise.resolve(folder) })
    await repository.load()
    await sync.connect()
    const saved = await repository.saveEngagement(newEngagement())
    expect(parsed(folder, 'engagements/solo-bakery-eng2/engagement.json')).toEqual(saved)
  })
})
