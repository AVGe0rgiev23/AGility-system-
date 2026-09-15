import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import storeV1 from '../schema/__fixtures__/store-v1.json'
import { engagement, newEngagement, pattern, wholeStore } from '../schema/__fixtures__/records'
import { defaultConfig } from '../schema/config'
import type { WholeStore } from '../schema/store'
import { CURRENT_SCHEMA_VERSION } from '../schema/version'
import { MemoryFolder } from './__fixtures__/memory-folder'
import { plant } from './__fixtures__/raw-idb'
import { createRepository, FOLDER_HANDLE_KEY, type LoadResult, type Repository } from './repository'
import { createFolderSync } from './sync'
import { applyImport, exportStore, findForbiddenKeys, prepareFolderRestore, prepareImportText, type ImportPreparation, type PreparedImport } from './transfer'

const T1 = '2026-09-16T09:00:00.000Z'
const T2 = '2026-09-17T09:00:00.000Z'

let databaseCount = 0
const open: Repository[] = []

function repositoryOn(name = `transfer-test-${++databaseCount}`) {
  const repository = createRepository({ databaseName: name, clock: () => T1, appVersion: '0.1.0' })
  open.push(repository)
  return { name, repository }
}

afterEach(() => {
  for (const repository of open.splice(0)) repository.close()
})

function wipe(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('could not delete'))
  })
}

function prepared(result: ImportPreparation): PreparedImport {
  if (!result.ok) throw new Error(`expected an importable file, got ${result.reason}: ${result.message}`)
  return result
}

function refused(result: ImportPreparation): Exclude<ImportPreparation, PreparedImport> {
  if (result.ok) throw new Error('expected the import to be refused')
  return result
}

function loaded(result: LoadResult): Extract<LoadResult, { status: 'loaded' }> {
  if (result.status !== 'loaded') throw new Error(`expected a loaded store, got ${result.reason}`)
  return result
}

// A repository holding the full fixture store, loaded once so its caches are settled.
async function populated() {
  const source = repositoryOn()
  await source.repository.load()
  await source.repository.replaceStore(wholeStore())
  const settled = loaded(await source.repository.load())
  return { ...source, settled }
}

describe('exportStore', () => {
  it('writes every stored record, corrupt ones included, as one JSON file', async () => {
    const { name, repository } = await populated()
    const corrupt = { id: 'eng-bad', company: 'not a company' }
    await plant(name, [{ table: 'engagements', value: corrupt }])
    const { filename, text } = await exportStore(repository, T2)
    expect(filename).toBe('agility-os-export-2026-09-17.json')
    expect(JSON.parse(text)).toEqual(await repository.readRawStore())
    expect((JSON.parse(text) as { engagements: unknown[] }).engagements).toContainEqual(corrupt)
  })
})

describe('export, wipe, import', () => {
  it('restores the whole store into a wiped database, after a diff and nothing before it', async () => {
    const { name, repository, settled } = await populated()
    const { text } = await exportStore(repository, T2)
    repository.close()
    await wipe(name)

    const fresh = repositoryOn(name)
    await fresh.repository.load()
    const before = await fresh.repository.readRawStore()
    const preparation = prepared(await prepareImportText(text, fresh.repository, T2))
    expect(preparation.diff.engagements.added.map((entry) => entry.label)).toEqual(['Rila Logistics', 'Solo Bakery'])
    expect(await fresh.repository.readRawStore()).toEqual(before)

    const restored = loaded(await applyImport(preparation, fresh.repository))
    expect(restored.store).toEqual(settled.store)
    expect(restored.problems).toEqual([])
  })
})

describe('prepareImportText refusals', () => {
  it('rejects a __proto__ key, pollutes nothing and writes nothing', async () => {
    const { repository } = await populated()
    const before = await repository.readRawStore()
    const text = JSON.stringify(wholeStore()).replace('{"meta":', '{"__proto__":{"polluted":true},"meta":')
    const result = refused(await prepareImportText(text, repository, T2))
    expect(result.reason).toBe('forbidden-keys')
    expect(result.reason === 'forbidden-keys' && result.paths).toEqual(['__proto__'])
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(await repository.readRawStore()).toEqual(before)
  })

  it('rejects constructor and prototype keys at any depth, naming each path', () => {
    const parsed = JSON.parse(
      JSON.stringify(wholeStore())
        .replaceAll('"company":{', '"company":{"__proto__":{"x":1},')
        .replace('"agency":{', '"agency":{"constructor":{"prototype":{}},'),
    ) as unknown
    expect(findForbiddenKeys(parsed)).toEqual(['config.agency.constructor', 'engagements.0.company.__proto__', 'engagements.1.company.__proto__'])
    expect(findForbiddenKeys({ a: [{ b: { prototype: 1 } }] })).toEqual(['a.0.b.prototype'])
  })

  it('rejects a file that is not JSON', async () => {
    const { repository } = repositoryOn()
    await repository.load()
    expect(refused(await prepareImportText('{ "meta": ', repository, T2)).reason).toBe('invalid-json')
  })

  it('refuses an import from a newer schema version', async () => {
    const { repository } = repositoryOn()
    await repository.load()
    const newer = { ...wholeStore(), meta: { ...wholeStore().meta, schemaVersion: CURRENT_SCHEMA_VERSION + 1 } }
    const result = refused(await prepareImportText(JSON.stringify(newer), repository, T2))
    expect(result.reason).toBe('newer-version')
    expect(result.message).toContain(`schema version ${CURRENT_SCHEMA_VERSION + 1}`)
  })

  it('refuses a store that does not validate, with the issue paths', async () => {
    const { repository } = repositoryOn()
    await repository.load()
    const invalid = { ...wholeStore(), config: { ...defaultConfig(), agencyCurrency: 'GBP' } }
    const result = refused(await prepareImportText(JSON.stringify(invalid), repository, T2))
    expect(result.reason).toBe('invalid')
    expect(result.reason === 'invalid' && result.issues.map((issue) => issue.path)).toEqual([['config', 'agencyCurrency']])
  })

  it('refuses a store with no readable schema version', async () => {
    const { repository } = repositoryOn()
    await repository.load()
    const { meta: _omitted, ...withoutMeta } = wholeStore()
    expect(refused(await prepareImportText(JSON.stringify(withoutMeta), repository, T2)).reason).toBe('invalid')
  })

  it('refuses two engagements sharing an id', async () => {
    const { repository } = repositoryOn()
    await repository.load()
    const store: WholeStore = { ...wholeStore(), engagements: [engagement(), { ...newEngagement(), id: 'eng-1' }] }
    const result = refused(await prepareImportText(JSON.stringify(store), repository, T2))
    expect(result.reason === 'duplicate-ids' && result.ids).toEqual(['eng-1'])
  })
})

describe('prepareImportText migration and diff', () => {
  it('migrates a v1 export while preparing, and the applied store loads without migrating again', async () => {
    const { repository } = repositoryOn()
    await repository.load()
    const preparation = prepared(await prepareImportText(JSON.stringify(storeV1), repository, T2))
    expect(preparation.migratedFrom).toBe(1)
    expect(preparation.store.meta).toMatchObject({ schemaVersion: CURRENT_SCHEMA_VERSION, lastMigratedAt: T2 })
    expect(preparation.diff.schemaVersion).toEqual({ current: CURRENT_SCHEMA_VERSION, incoming: CURRENT_SCHEMA_VERSION, migratedFrom: 1 })
    const result = loaded(await applyImport(preparation, repository))
    expect(result.migratedFrom).toBeNull()
    expect(result.recomputed).toEqual(['eng-1'])
  })

  it('lists added, removed and changed records and changed Config keys, with the storage block kept', async () => {
    const { repository } = await populated()
    const incoming = wholeStore()
    const [first] = incoming.engagements
    if (first === undefined) throw new Error('fixture store has engagements')
    incoming.engagements = [{ ...first, tags: ['logistics', 'renewal'] }, { ...newEngagement(), id: 'eng-3', company: { ...newEngagement().company, name: 'New Client' } }]
    incoming.library.patterns = [...incoming.library.patterns, { ...pattern(), id: 'pat-crm-sync', name: 'CRM sync' }]
    incoming.config.pricing.targetHourlyRate = 75
    incoming.config.storage.syncFolderHandleId = 'from-another-machine'

    const { diff } = prepared(await prepareImportText(JSON.stringify(incoming), repository, T2))
    expect(diff.engagements.added).toEqual([{ id: 'eng-3', label: 'New Client' }])
    expect(diff.engagements.removed).toEqual([{ id: 'eng-2', label: 'Solo Bakery' }])
    expect(diff.engagements.changed).toEqual([{ id: 'eng-1', label: 'Rila Logistics' }])
    expect(diff.library.patterns).toEqual({ added: [{ id: 'pat-crm-sync', label: 'CRM sync' }], removed: [], changed: [], unchanged: 1 })
    expect(diff.library.calibration.unchanged).toBe(1)
    expect(diff.config).toEqual({ changedKeys: ['pricing'], storageKept: true })
  })

  it('keeps this machine’s storage block and folder handle when the import is applied', async () => {
    const { repository } = await populated()
    await repository.saveFolderHandle({ kind: 'directory', name: 'agility-os-data' })
    const incoming = wholeStore()
    incoming.config.storage = { syncFolderHandleId: null, autoSyncOnWrite: false, lastSyncAt: '2020-01-01T00:00:00.000Z' }
    const preparation = prepared(await prepareImportText(JSON.stringify(incoming), repository, T2))
    const result = loaded(await applyImport(preparation, repository))
    expect(result.store.config?.storage).toEqual({ syncFolderHandleId: FOLDER_HANDLE_KEY, autoSyncOnWrite: true, lastSyncAt: null })
    expect(await repository.loadFolderHandle()).toEqual({ kind: 'directory', name: 'agility-os-data' })
  })
})

describe('prepareFolderRestore', () => {
  async function mirroredFolder(repository: Repository): Promise<MemoryFolder> {
    const folder = new MemoryFolder('agility-os-data')
    const sync = createFolderSync({ repository, clock: () => T1, pickFolder: () => Promise.resolve(folder) })
    await sync.connect()
    return folder
  }

  it('restores a mirrored folder into another database through the same diff', async () => {
    const source = await populated()
    const folder = await mirroredFolder(source.repository)

    const target = repositoryOn()
    await target.repository.load()
    const preparation = prepared(await prepareFolderRestore(folder, target.repository, T2))
    expect(preparation.diff.engagements.added.map((entry) => entry.id)).toEqual(['eng-1', 'eng-2'])
    const restored = loaded(await applyImport(preparation, target.repository))
    expect(restored.store.engagements).toEqual(source.settled.store.engagements)
    expect(restored.store.library).toEqual(source.settled.store.library)
  })

  it('refuses a folder with an unreadable file', async () => {
    const source = await populated()
    const folder = await mirroredFolder(source.repository)
    await folder.put('library/patterns.json', '[ not json')
    const result = refused(await prepareFolderRestore(folder, source.repository, T2))
    expect(result.reason === 'unreadable-folder' && result.errors.map((error) => error.path)).toEqual(['library/patterns.json'])
  })

  it('refuses a folder whose .schema-version disagrees with its meta.json', async () => {
    const source = await populated()
    const folder = await mirroredFolder(source.repository)
    await folder.put('.schema-version', '1\n')
    const result = refused(await prepareFolderRestore(folder, source.repository, T2))
    expect(result.reason).toBe('invalid')
    expect(result.message).toContain('Expected data at schema version 1')
  })
})
