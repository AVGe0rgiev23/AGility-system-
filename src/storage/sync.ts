import type { Config } from '../schema/config'
import type { Engagement } from '../schema/engagement'
import type { RawStore, Repository, StoreChange } from './repository'

// The disk mirror (ARCHITECTURE, Persistence). Strictly one-way and strictly additive: the app
// writes files and never reads them back during normal operation, and it never deletes from the
// folder, because that folder is the git-tracked backup. Folders it no longer writes to are
// reported as stale for Alex to delete by hand. Reading happens only in readFolderStore, for an
// explicit restore.

// The parts of the File System Access API this module uses. TypeScript's DOM library has no
// showDirectoryPicker, permission methods or async key iteration, and a narrow interface also
// lets tests use an in-memory folder.
export interface FolderWritable {
  write(data: string): Promise<void>
  close(): Promise<void>
}

export interface FolderFileHandle {
  createWritable(): Promise<FolderWritable>
  getFile(): Promise<{ text(): Promise<string> }>
}

export interface FolderHandle {
  readonly kind: 'directory'
  readonly name: string
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FolderHandle>
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FolderFileHandle>
  keys(): AsyncIterable<string>
  queryPermission(descriptor: { mode: 'readwrite' }): Promise<PermissionState>
  requestPermission(descriptor: { mode: 'readwrite' }): Promise<PermissionState>
}

export type SyncStatus =
  | { kind: 'unsupported' }
  | { kind: 'disconnected' }
  | { kind: 'needs-permission'; folderName: string }
  | { kind: 'connected'; folderName: string; lastSyncAt: string | null; staleFolders: string[] }
  | { kind: 'error'; folderName: string; message: string; staleFolders: string[] }

type SyncRepository = Pick<Repository, 'readRawStore' | 'saveFolderHandle' | 'loadFolderHandle' | 'clearFolderHandle' | 'recordSyncTime'>

export interface FolderSyncOptions {
  repository: SyncRepository
  clock: () => string
  // The browser's folder picker, or undefined where the File System Access API is missing.
  pickFolder: (() => Promise<FolderHandle>) | undefined
}

export const LIBRARY_FILES = {
  patterns: 'patterns.json',
  questionSets: 'question-sets.json',
  templates: 'templates.json',
  calibration: 'calibration.json',
} as const

// The picker from the browser, feature-detected. Chromium browsers have it; Safari and Firefox do
// not, and fall back to manual export and import.
export function browserFolderPicker(): (() => Promise<FolderHandle>) | undefined {
  // The API is absent from TypeScript's DOM library, so the global is described here.
  const scope = globalThis as { showDirectoryPicker?: (options: { mode: 'readwrite'; id: string }) => Promise<FolderHandle> }
  const show = scope.showDirectoryPicker
  if (typeof show !== 'function') return undefined
  return () => show.call(globalThis, { mode: 'readwrite', id: 'agility-os-data' })
}

// The persistent banner text for every state short of a healthy connection.
export function warningFor(status: SyncStatus): string | null {
  switch (status.kind) {
    case 'unsupported':
      return 'This browser cannot mirror to a folder. Your data lives only in this browser: export it regularly and keep the file safe.'
    case 'disconnected':
      return 'No folder is connected. Your data lives only in this browser until you connect a folder or export it.'
    case 'needs-permission':
      return `The folder '${status.folderName}' needs permission again before changes can be mirrored to it.`
    case 'error':
      return `Mirroring to '${status.folderName}' failed: ${status.message}. Your changes are safe in this browser and will be written on the next save or sync.`
    case 'connected':
      return status.staleFolders.length === 0
        ? null
        : `These engagement folders are no longer written to and can be deleted by hand: ${status.staleFolders.join(', ')}.`
  }
}

// <slug>-<shortid>. The slug is for reading the folder in a file browser; the id keeps names unique.
export function engagementFolderName(id: string, companyName: string): string {
  const slug =
    companyName
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 40)
      .replace(/^-+|-+$/g, '') || 'engagement'
  const shortId = id.replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toLowerCase() || 'noid'
  return `${slug}-${shortId}`
}

// Names from a raw record, which may be corrupt; the mirror copies it all the same.
function rawFolderName(value: unknown, index: number): string {
  const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  const id = typeof record.id === 'string' ? record.id : `record${index}`
  const company = typeof record.company === 'object' && record.company !== null ? (record.company as Record<string, unknown>) : {}
  return engagementFolderName(id, typeof company.name === 'string' ? company.name : '')
}

function folderOf(engagement: Engagement): string {
  return engagementFolderName(engagement.id, engagement.company.name)
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function isFolderHandle(value: unknown): value is FolderHandle {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    candidate.kind === 'directory' &&
    typeof candidate.getDirectoryHandle === 'function' &&
    typeof candidate.getFileHandle === 'function' &&
    typeof candidate.queryPermission === 'function'
  )
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function writeText(root: FolderHandle, path: readonly string[], content: string): Promise<void> {
  let folder = root
  for (const segment of path.slice(0, -1)) folder = await folder.getDirectoryHandle(segment, { create: true })
  const fileName = path.at(-1)
  if (fileName === undefined) throw new Error('an empty path has no file to write')
  const writable = await (await folder.getFileHandle(fileName, { create: true })).createWritable()
  await writable.write(content)
  await writable.close()
}

export function createFolderSync(options: FolderSyncOptions) {
  const { repository, clock, pickFolder } = options
  let handle: FolderHandle | null = null
  let status: SyncStatus = pickFolder === undefined ? { kind: 'unsupported' } : { kind: 'disconnected' }
  let autoSyncOnWrite = true
  const stale = new Set<string>()
  // Mirror writes run one at a time, so two quick saves can never interleave inside one file.
  let queue: Promise<unknown> = Promise.resolve()

  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task)
    queue = run.catch(() => undefined)
    return run
  }

  const staleFolders = () => [...stale].sort()

  // Runs one mirror task against the connected folder. A failure becomes the error status and is
  // never thrown: the data is already safe in IndexedDB.
  async function mirrorWith(task: (root: FolderHandle) => Promise<void>): Promise<void> {
    await enqueue(async () => {
      const root = handle
      if (root === null) return
      try {
        await task(root)
        const at = clock()
        await repository.recordSyncTime(at)
        status = { kind: 'connected', folderName: root.name, lastSyncAt: at, staleFolders: staleFolders() }
      } catch (error) {
        status = { kind: 'error', folderName: root.name, message: describeError(error), staleFolders: staleFolders() }
      }
    })
  }

  async function writeLibrary(root: FolderHandle, library: unknown): Promise<void> {
    if (typeof library !== 'object' || library === null) return
    const record = library as Record<string, unknown>
    for (const [key, file] of Object.entries(LIBRARY_FILES)) {
      if (record[key] !== undefined) await writeText(root, ['library', file], json(record[key]))
    }
  }

  // Everything stored, corrupt records included, so the folder is an exact copy that can be
  // fixed by hand. Folders already on disk that this store does not write are reported, not removed.
  async function writeStore(root: FolderHandle, store: RawStore): Promise<void> {
    const meta = typeof store.meta === 'object' && store.meta !== null ? (store.meta as Record<string, unknown>) : {}
    if (typeof meta.schemaVersion === 'number') await writeText(root, ['.schema-version'], `${meta.schemaVersion}\n`)
    if (store.meta !== undefined) await writeText(root, ['meta.json'], json(store.meta))
    if (store.config !== undefined) await writeText(root, ['config.json'], json(store.config))
    await writeLibrary(root, store.library)
    const written = new Set<string>()
    for (const [index, engagement] of store.engagements.entries()) {
      const folder = rawFolderName(engagement, index)
      written.add(folder)
      await writeText(root, ['engagements', folder, 'engagement.json'], json(engagement))
    }
    stale.clear()
    const engagementsFolder = await root.getDirectoryHandle('engagements', { create: true })
    for await (const name of engagementsFolder.keys()) {
      if (!written.has(name)) stale.add(name)
    }
  }

  async function activate(root: FolderHandle): Promise<SyncStatus> {
    handle = root
    status = { kind: 'connected', folderName: root.name, lastSyncAt: null, staleFolders: [] }
    await syncNow()
    return status
  }

  async function syncNow(): Promise<void> {
    await mirrorWith(async (root) => writeStore(root, await repository.readRawStore()))
  }

  return {
    status: (): SyncStatus => status,

    // Called on startup with the loaded Config's storage block. Without a user gesture the browser
    // cannot grant permission, so a stored folder may come back as needs-permission.
    async restore(storage: Config['storage'] | null): Promise<SyncStatus> {
      autoSyncOnWrite = storage?.autoSyncOnWrite ?? true
      if (pickFolder === undefined) return status
      const stored = await repository.loadFolderHandle()
      if (!isFolderHandle(stored)) {
        status = { kind: 'disconnected' }
        return status
      }
      if ((await stored.queryPermission({ mode: 'readwrite' })) === 'granted') return activate(stored)
      handle = null
      status = { kind: 'needs-permission', folderName: stored.name }
      return status
    },

    // From a user gesture: pick a folder, keep its handle, mirror everything into it.
    async connect(): Promise<SyncStatus> {
      if (pickFolder === undefined) return status
      let picked: FolderHandle
      try {
        picked = await pickFolder()
      } catch (error) {
        // Closing the picker is not a failure; the previous state stands.
        if (error instanceof DOMException && error.name === 'AbortError') return status
        status = { kind: 'error', folderName: handle?.name ?? '', message: describeError(error), staleFolders: staleFolders() }
        return status
      }
      if ((await picked.requestPermission({ mode: 'readwrite' })) !== 'granted') {
        status = { kind: 'needs-permission', folderName: picked.name }
        return status
      }
      await repository.saveFolderHandle(picked)
      return activate(picked)
    },

    // From a user gesture, for a stored folder whose permission lapsed.
    async reconnect(): Promise<SyncStatus> {
      const stored = await repository.loadFolderHandle()
      if (!isFolderHandle(stored)) return status
      if ((await stored.requestPermission({ mode: 'readwrite' })) !== 'granted') {
        status = { kind: 'needs-permission', folderName: stored.name }
        return status
      }
      return activate(stored)
    },

    // Forgets the folder. Nothing in it is touched.
    async disconnect(): Promise<SyncStatus> {
      await enqueue(async () => {
        handle = null
        stale.clear()
        await repository.clearFolderHandle()
      })
      status = pickFolder === undefined ? { kind: 'unsupported' } : { kind: 'disconnected' }
      return status
    },

    syncNow,

    // The repository's onWrite listener, so an arrow: it is passed around detached from this object.
    // Writes only what changed, unless the whole store did.
    mirror: async (change: StoreChange): Promise<void> => {
      if (change.kind === 'config') autoSyncOnWrite = change.config.storage.autoSyncOnWrite
      if (change.kind === 'store') autoSyncOnWrite = change.store.config.storage.autoSyncOnWrite
      if (!autoSyncOnWrite) return
      await mirrorWith(async (root) => {
        switch (change.kind) {
          case 'engagement': {
            const folder = folderOf(change.engagement)
            await writeText(root, ['engagements', folder, 'engagement.json'], json(change.engagement))
            stale.delete(folder)
            // A renamed company writes to a new folder. The old one keeps its last copy until deleted by hand.
            if (change.previous !== null && folderOf(change.previous) !== folder) stale.add(folderOf(change.previous))
            return
          }
          case 'engagement-deleted':
            if (change.previous !== null) stale.add(folderOf(change.previous))
            return
          case 'config':
            await writeText(root, ['config.json'], json(change.config))
            return
          case 'library':
            await writeLibrary(root, change.library)
            return
          case 'store':
            await writeStore(root, change.store)
            return
        }
      })
    },
  }
}

export type FolderSync = ReturnType<typeof createFolderSync>

export interface FolderRead {
  // From .schema-version, or null when the file is missing or not a whole number.
  schemaVersion: number | null
  store: { meta: unknown; config: unknown; library: Record<string, unknown>; engagements: unknown[] }
  // Files that could not be read or parsed, and engagements that appear in more than one folder.
  errors: { path: string; message: string }[]
}

async function readText(folder: FolderHandle, name: string): Promise<string | undefined> {
  try {
    return await (await (await folder.getFileHandle(name)).getFile()).text()
  } catch (error) {
    if (error instanceof DOMException && (error.name === 'NotFoundError' || error.name === 'TypeMismatchError')) return undefined
    throw error
  }
}

async function childFolder(folder: FolderHandle, name: string): Promise<FolderHandle | undefined> {
  try {
    return await folder.getDirectoryHandle(name)
  } catch (error) {
    if (error instanceof DOMException && (error.name === 'NotFoundError' || error.name === 'TypeMismatchError')) return undefined
    throw error
  }
}

// Reads a mirrored folder back into a raw store, for an explicit restore only. Nothing here is
// validated; transfer.ts runs the same checks, migration and diff as a JSON import.
export async function readFolderStore(root: FolderHandle): Promise<FolderRead> {
  const errors: FolderRead['errors'] = []
  const parse = (path: string, text: string | undefined): unknown => {
    if (text === undefined) return undefined
    try {
      return JSON.parse(text) as unknown
    } catch (error) {
      errors.push({ path, message: `not valid JSON: ${describeError(error)}` })
      return undefined
    }
  }

  const versionText = await readText(root, '.schema-version')
  const versionValue = versionText?.trim()
  const schemaVersion = versionValue !== undefined && /^\d+$/.test(versionValue) ? Number(versionValue) : null
  if (versionText !== undefined && schemaVersion === null) {
    errors.push({ path: '.schema-version', message: `'${versionText.trim()}' is not a schema version` })
  }

  const library: Record<string, unknown> = {}
  const libraryFolder = await childFolder(root, 'library')
  for (const [key, file] of Object.entries(LIBRARY_FILES)) {
    library[key] = libraryFolder === undefined ? undefined : parse(`library/${file}`, await readText(libraryFolder, file))
  }

  const engagements: unknown[] = []
  const foldersById = new Map<string, string>()
  const engagementsFolder = await childFolder(root, 'engagements')
  if (engagementsFolder !== undefined) {
    const names: string[] = []
    for await (const name of engagementsFolder.keys()) names.push(name)
    for (const name of names.sort()) {
      const folder = await childFolder(engagementsFolder, name)
      if (folder === undefined) continue
      const path = `engagements/${name}/engagement.json`
      const value = parse(path, await readText(folder, 'engagement.json'))
      if (value === undefined) continue
      const id = typeof value === 'object' && value !== null && typeof (value as Record<string, unknown>).id === 'string'
        ? ((value as Record<string, unknown>).id as string)
        : undefined
      const earlier = id === undefined ? undefined : foldersById.get(id)
      if (id !== undefined && earlier !== undefined) {
        // An additive mirror keeps a renamed company's old folder; restoring both would be ambiguous.
        errors.push({ path, message: `engagement '${id}' is also in 'engagements/${earlier}'; delete the stale folder by hand and restore again` })
        continue
      }
      if (id !== undefined) foldersById.set(id, name)
      engagements.push(value)
    }
  }

  return {
    schemaVersion,
    store: {
      meta: parse('meta.json', await readText(root, 'meta.json')),
      config: parse('config.json', await readText(root, 'config.json')),
      library,
      engagements,
    },
    errors,
  }
}
