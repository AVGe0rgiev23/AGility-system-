import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import storeV1 from '../schema/__fixtures__/store-v1.json'
import { calibrationRecord, engagement, library, meta, newEngagement, wholeStore } from '../schema/__fixtures__/records'
import { defaultConfig } from '../schema/config'
import { seedQuestionSets } from '../schema/seed-question-sets'
import type { Engagement } from '../schema/engagement'
import { CURRENT_SCHEMA_VERSION } from '../schema/version'
import { plant, plantedStore, readRaw } from './__fixtures__/raw-idb'
import { createRepository, FOLDER_HANDLE_KEY, type LoadResult, type Repository, type StoreChange } from './repository'

const T1 = '2026-09-16T09:00:00.000Z'
const T2 = '2026-09-17T09:00:00.000Z'

let databaseCount = 0
const open: Repository[] = []

// A repository on its own fresh database, with a clock the test moves and a record of every write.
function setup(name = `repository-test-${++databaseCount}`) {
  const clock = { now: T1 }
  const changes: StoreChange[] = []
  const repository = createRepository({
    databaseName: name,
    clock: () => clock.now,
    appVersion: '0.1.0',
    onWrite: (change) => {
      changes.push(change)
    },
  })
  open.push(repository)
  return { name, clock, changes, repository }
}

afterEach(() => {
  for (const repository of open.splice(0)) repository.close()
})

function loaded(result: LoadResult): Extract<LoadResult, { status: 'loaded' }> {
  if (result.status !== 'loaded') throw new Error(`expected a loaded store, got ${result.reason}: ${result.message}`)
  return result
}

function refusal(result: LoadResult): Extract<LoadResult, { status: 'refused' }> {
  if (result.status !== 'refused') throw new Error('expected the load to be refused')
  return result
}

describe('load: fresh database', () => {
  it('seeds meta, the default Config and a Library holding only the standard question sets, and loads them', async () => {
    const { repository, changes } = setup()
    const result = loaded(await repository.load())
    expect(result.seeded).toBe(true)
    expect(result.store.meta).toEqual({ schemaVersion: CURRENT_SCHEMA_VERSION, createdAt: T1, lastMigratedAt: null, appVersion: '0.1.0' })
    expect(result.store.config).toEqual(defaultConfig())
    expect(result.store.library).toEqual({ patterns: [], questionSets: seedQuestionSets(), templates: [], calibration: [] })
    expect(result.store.engagements).toEqual([])
    expect(changes.map((change) => change.kind)).toEqual(['store'])
    expect(loaded(await repository.load()).seeded).toBe(false)
  })
})

describe('load: round-trip persistence', () => {
  it('returns what was saved from a second repository on the same database', async () => {
    const first = setup()
    await first.repository.load()
    await first.repository.saveEngagement(newEngagement())
    await first.repository.saveEngagement(engagement())
    const config = defaultConfig()
    config.pricing.targetHourlyRate = 72
    await first.repository.saveConfig(config)
    await first.repository.saveLibrary(library())
    // The first load after saving recomputes the fixture's placeholder caches and writes them back.
    const settled = loaded(await first.repository.load())
    first.repository.close()

    const second = setup(first.name)
    second.clock.now = T2
    const reopened = loaded(await second.repository.load())
    expect(reopened.problems).toEqual([])
    expect(reopened.recomputed).toEqual([])
    expect(reopened.store).toEqual(settled.store)
    expect(reopened.store.config?.pricing.targetHourlyRate).toBe(72)
    expect(reopened.store.engagements.find((entry) => entry.id === 'eng-2')).toEqual({ ...newEngagement(), updatedAt: T1 })
  })
})

describe('load: corrupt records', () => {
  it('reports a corrupt engagement, loads the others, and leaves the corrupt one stored', async () => {
    const { name, repository } = setup()
    await repository.load()
    await repository.saveEngagement(newEngagement())
    const corrupt = { id: 'eng-bad', company: 'not a company' }
    await plant(name, [{ table: 'engagements', value: corrupt }])

    const result = loaded(await repository.load())
    expect(result.store.engagements.map((entry) => entry.id)).toEqual(['eng-2'])
    expect(result.problems.map(({ table, key }) => ({ table, key }))).toEqual([{ table: 'engagements', key: 'eng-bad' }])
    expect(result.problems[0]?.issues.length).toBeGreaterThan(0)
    expect(await readRaw(name, 'engagements', 'eng-bad')).toEqual(corrupt)
  })

  it('loads a corrupt Config as null, reported, with no defaults substituted and nothing recomputed', async () => {
    const { name, repository } = setup()
    await repository.load()
    await repository.saveEngagement(engagement())
    const corrupt = { ...defaultConfig(), pricing: 'cheap' }
    await plant(name, [{ table: 'config', key: 'config', value: corrupt }])

    const result = loaded(await repository.load())
    expect(result.store.config).toBeNull()
    expect(result.problems.map(({ table }) => table)).toEqual(['config'])
    expect(result.recomputeSkipped).toBe(true)
    expect(result.recomputed).toEqual([])
    expect(result.store.engagements[0]?.opportunities[0]?.scoring?.inputsHash).toBe('h-scoring')
    expect(await readRaw(name, 'config', 'config')).toEqual(corrupt)
  })
})

describe('load: derived-data recompute', () => {
  it('recomputes a stale inputsHash, writes it back and leaves updatedAt alone', async () => {
    const { name, repository, changes } = setup()
    await repository.load()
    // Saved at T1 with the fixture's placeholder hashes, which no engine produces.
    await repository.saveEngagement(engagement())
    changes.length = 0

    const result = loaded(await repository.load())
    expect(result.recomputed).toEqual(['eng-1'])
    const [recomputed] = result.store.engagements
    expect(recomputed?.opportunities[0]?.scoring?.inputsHash).not.toBe('h-scoring')
    expect(recomputed?.updatedAt).toBe(T1)
    expect(changes.map((change) => change.kind)).toEqual(['engagement'])

    const stored = (await readRaw(name, 'engagements', 'eng-1')) as Engagement
    expect(stored.opportunities[0]?.scoring?.inputsHash).toBe(recomputed?.opportunities[0]?.scoring?.inputsHash)
    expect(stored.updatedAt).toBe(T1)
  })

  it('leaves a matching hash alone on the next load', async () => {
    const { clock, repository, changes } = setup()
    await repository.load()
    await repository.saveEngagement(engagement())
    const first = loaded(await repository.load())
    changes.length = 0
    clock.now = T2
    const second = loaded(await repository.load())
    expect(second.recomputed).toEqual([])
    expect(second.store.engagements).toEqual(first.store.engagements)
    expect(changes).toEqual([])
  })

  it('recomputes after a Config change', async () => {
    const { repository } = setup()
    await repository.load()
    await repository.saveEngagement(engagement())
    await repository.load()
    const config = defaultConfig()
    config.pricing.targetHourlyRate = 90
    await repository.saveConfig(config)
    const result = loaded(await repository.load())
    expect(result.recomputed).toEqual(['eng-1'])
    expect(result.store.engagements[0]?.scope?.estimate?.indicativePrice).toBeCloseTo((result.store.engagements[0]?.scope?.estimate?.totalHours ?? NaN) * 90, 8)
  })
})

describe('load: schema versions', () => {
  it('migrates a v1 store on load, stamps lastMigratedAt, persists it, and does not migrate again', async () => {
    const { name, clock, repository, changes } = setup()
    await repository.readRawStore()
    await plant(name, plantedStore(structuredClone(storeV1)), { clearFirst: true })
    clock.now = T2

    const result = loaded(await repository.load())
    expect(result.migratedFrom).toBe(1)
    expect(result.store.meta).toMatchObject({ schemaVersion: CURRENT_SCHEMA_VERSION, lastMigratedAt: T2, appVersion: '0.1.0' })
    // The migration dropped every cache, so the load recomputed them.
    expect(result.recomputed).toEqual(['eng-1'])
    expect(result.problems).toEqual([])
    expect(changes[0]?.kind).toBe('store')
    expect(await readRaw(name, 'meta', 'meta')).toMatchObject({ schemaVersion: CURRENT_SCHEMA_VERSION, lastMigratedAt: T2 })

    const again = loaded(await repository.load())
    expect(again.migratedFrom).toBeNull()
    expect(again.recomputed).toEqual([])
  })

  it('refuses a store from a newer schema version and writes nothing', async () => {
    const { name, repository, changes } = setup()
    await repository.load()
    changes.length = 0
    const newer = { ...meta(), schemaVersion: CURRENT_SCHEMA_VERSION + 1 }
    await plant(name, [{ table: 'meta', key: 'meta', value: newer }, { table: 'engagements', value: { id: 'eng-future', shape: 'unknown' } }])

    const result = refusal(await repository.load())
    expect(result.reason).toBe('newer-version')
    expect(result.message).toContain(`schema version ${CURRENT_SCHEMA_VERSION + 1}`)
    expect(result.message).toContain('The app is older than the data.')
    expect(await readRaw(name, 'meta', 'meta')).toEqual(newer)
    expect(await readRaw(name, 'engagements', 'eng-future')).toEqual({ id: 'eng-future', shape: 'unknown' })
    expect(changes).toEqual([])
  })

  it('refuses a v1 store whose migration fails, leaving it stored as it was', async () => {
    const { name, repository, changes } = setup()
    await repository.readRawStore()
    const broken = structuredClone(storeV1)
    const firstSample = broken.library.calibration[0]?.samples[0]
    if (firstSample === undefined) throw new Error('the v1 fixture has a calibration sample')
    firstSample.estimatedHours = 0
    await plant(name, plantedStore(broken), { clearFirst: true })

    const result = refusal(await repository.load())
    expect(result.reason).toBe('migration-failed')
    expect(result.issues.map((issue) => issue.path)).toEqual([['library', 'calibration', 0, 'samples', 0, 'estimatedHours']])
    expect(await readRaw(name, 'meta', 'meta')).toMatchObject({ schemaVersion: 1 })
    expect(changes).toEqual([])
  })

  it('refuses data with no meta record instead of seeding over it', async () => {
    const { name, repository } = setup()
    await repository.readRawStore()
    await plant(name, [{ table: 'engagements', value: newEngagement() }])
    expect(refusal(await repository.load()).reason).toBe('corrupt-meta')
    expect(await readRaw(name, 'meta', 'meta')).toBeUndefined()
  })

  it('refuses a meta record that does not validate', async () => {
    const { name, repository } = setup()
    await repository.load()
    await plant(name, [{ table: 'meta', key: 'meta', value: { ...meta(), schemaVersion: 'two' } }])
    const result = refusal(await repository.load())
    expect(result.reason).toBe('corrupt-meta')
    expect(result.issues.map((issue) => issue.path)).toEqual([['schemaVersion']])
  })
})

describe('writes', () => {
  it('saveEngagement validates, bumps updatedAt and reports the previous record', async () => {
    const { clock, repository, changes } = setup()
    await repository.load()
    changes.length = 0
    const saved = await repository.saveEngagement(newEngagement())
    expect(saved.updatedAt).toBe(T1)
    clock.now = T2
    const renamed = await repository.saveEngagement({ ...saved, company: { ...saved.company, name: 'Solo Bakery Ltd' } })
    expect(renamed.updatedAt).toBe(T2)
    expect(changes).toEqual([
      { kind: 'engagement', engagement: saved, previous: null },
      { kind: 'engagement', engagement: renamed, previous: saved },
    ])
  })

  it('rejects an invalid engagement before writing anything', async () => {
    const { name, repository, changes } = setup()
    await repository.load()
    changes.length = 0
    const invalid = { ...newEngagement(), stage: 'SOLD' } as unknown as Engagement
    await expect(repository.saveEngagement(invalid)).rejects.toThrow()
    expect(await readRaw(name, 'engagements', 'eng-2')).toBeUndefined()
    expect(changes).toEqual([])
  })

  it('deleteEngagement removes the record and reports what it was', async () => {
    const { name, repository, changes } = setup()
    await repository.load()
    const saved = await repository.saveEngagement(newEngagement())
    changes.length = 0
    await repository.deleteEngagement('eng-2')
    expect(await readRaw(name, 'engagements', 'eng-2')).toBeUndefined()
    expect(changes).toEqual([{ kind: 'engagement-deleted', id: 'eng-2', previous: saved }])
  })

  it('saveConfig and saveLibrary validate before writing and report the write', async () => {
    const { repository, changes } = setup()
    await repository.load()
    changes.length = 0
    const broken = defaultConfig()
    broken.pricing.targetHourlyRate = 0
    await expect(repository.saveConfig(broken)).rejects.toThrow()
    await repository.saveConfig(defaultConfig())
    await repository.saveLibrary(library())
    expect(changes.map((change) => change.kind)).toEqual(['config', 'library'])
  })

  it('replaceStore swaps the whole store in one write, keeps the folder handle, and keeps each updatedAt', async () => {
    const { repository, changes } = setup()
    await repository.load()
    await repository.saveEngagement({ ...newEngagement(), id: 'eng-old' })
    await repository.saveFolderHandle({ kind: 'directory', name: 'agility-os-data' })
    changes.length = 0

    const store = wholeStore()
    await repository.replaceStore(store)
    const raw = await repository.readRawStore()
    expect(raw.engagements.map((entry) => (entry as Engagement).id).sort()).toEqual(['eng-1', 'eng-2'])
    expect((raw.engagements as Engagement[]).map((entry) => entry.updatedAt).sort()).toEqual(
      store.engagements.map((entry) => entry.updatedAt).sort(),
    )
    expect(await repository.loadFolderHandle()).toEqual({ kind: 'directory', name: 'agility-os-data' })
    expect(changes.map((change) => change.kind)).toEqual(['store'])
  })

  it('stores the folder handle beside Config, records its key in Config.storage, and clears both', async () => {
    const { repository, changes } = setup()
    await repository.load()
    changes.length = 0
    await repository.saveFolderHandle({ kind: 'directory', name: 'agility-os-data' })
    await repository.recordSyncTime(T2)
    let result = loaded(await repository.load())
    expect(result.store.config?.storage).toEqual({ syncFolderHandleId: FOLDER_HANDLE_KEY, autoSyncOnWrite: true, lastSyncAt: T2 })
    expect(await repository.loadFolderHandle()).toEqual({ kind: 'directory', name: 'agility-os-data' })

    await repository.clearFolderHandle()
    result = loaded(await repository.load())
    expect(result.store.config?.storage.syncFolderHandleId).toBeNull()
    expect(await repository.loadFolderHandle()).toBeUndefined()
    // Bookkeeping about the mirror is not announced to it.
    expect(changes).toEqual([])
  })

  it('does not fail a committed write when the listener throws', async () => {
    const repository = createRepository({
      databaseName: `repository-test-${++databaseCount}`,
      clock: () => T1,
      appVersion: '0.1.0',
      onWrite: () => {
        throw new Error('mirror down')
      },
    })
    open.push(repository)
    await repository.load()
    await expect(repository.saveLibrary({ ...library(), calibration: [calibrationRecord()] })).resolves.toBeDefined()
    expect(loaded(await repository.load()).store.library?.calibration).toEqual([calibrationRecord()])
  })
})
