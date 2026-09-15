import type { z } from 'zod'
import { canonicalJson } from '../engines/inputs-hash'
import { ConfigSchema, type Config } from '../schema/config'
import type { Library } from '../schema/library'
import { MigrationError, runMigrations } from '../schema/migrations/run-migrations'
import type { WholeStore } from '../schema/store'
import { CURRENT_SCHEMA_VERSION } from '../schema/version'
import type { LoadResult, RawStore, Repository } from './repository'
import { readFolderStore, type FolderHandle } from './sync'

// Export, import and restore-from-folder. An import is prepared first, with nothing written: it is
// checked, migrated, validated and diffed against what is stored, and only a confirmed
// preparation is applied, as one full-store replace.

type Issue = z.core.$ZodIssue
type TransferRepository = Pick<Repository, 'readRawStore' | 'replaceStore' | 'load'>

// Keys that could reach an object's prototype if a later step ever copied parsed data with a
// plain assignment. Zod would strip them, but an import carrying one is refused outright.
export const FORBIDDEN_KEYS: readonly string[] = ['__proto__', 'constructor', 'prototype']

export interface DiffEntry {
  id: string
  label: string
}

export interface CollectionDiff {
  added: DiffEntry[]
  removed: DiffEntry[]
  changed: DiffEntry[]
  unchanged: number
}

export interface StoreDiff {
  schemaVersion: { current: unknown; incoming: number; migratedFrom: number | null }
  // Top-level Config keys whose content differs. The storage block is never among them.
  config: { changedKeys: string[]; storageKept: boolean }
  library: Record<keyof Library, CollectionDiff>
  engagements: CollectionDiff
}

export interface PreparedImport {
  ok: true
  store: WholeStore
  diff: StoreDiff
  migratedFrom: number | null
}

export type ImportRefusal =
  | { ok: false; reason: 'invalid-json'; message: string }
  | { ok: false; reason: 'forbidden-keys'; message: string; paths: string[] }
  | { ok: false; reason: 'unreadable-folder'; message: string; errors: { path: string; message: string }[] }
  | { ok: false; reason: 'newer-version'; message: string }
  | { ok: false; reason: 'invalid'; message: string; issues: Issue[] }
  | { ok: false; reason: 'duplicate-ids'; message: string; ids: string[] }

export type ImportPreparation = PreparedImport | ImportRefusal

// Every stored byte, unvalidated, so a corrupt record leaves the browser too and can be fixed by hand.
export async function exportStore(repository: Pick<Repository, 'readRawStore'>, now: string): Promise<{ filename: string; text: string }> {
  const raw = await repository.readRawStore()
  return { filename: `agility-os-export-${now.slice(0, 10)}.json`, text: `${JSON.stringify(raw, null, 2)}\n` }
}

// Paths of every own key named in FORBIDDEN_KEYS, at any depth. JSON.parse makes "__proto__" an
// ordinary own key, so Object.keys sees it.
export function findForbiddenKeys(value: unknown, path: readonly string[] = []): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => findForbiddenKeys(item, [...path, String(index)]))
  if (typeof value !== 'object' || value === null) return []
  const record = value as Record<string, unknown>
  return Object.keys(record).flatMap((key) =>
    FORBIDDEN_KEYS.includes(key) ? [[...path, key].join('.')] : findForbiddenKeys(record[key], [...path, key]),
  )
}

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>)[key] : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function diffCollection(
  current: unknown,
  incoming: readonly unknown[],
  idOf: (item: unknown) => string | undefined,
  labelOf: (item: unknown) => string | undefined,
): CollectionDiff {
  const diff: CollectionDiff = { added: [], removed: [], changed: [], unchanged: 0 }
  const before = new Map<string, unknown>()
  for (const [index, item] of (Array.isArray(current) ? current : []).entries()) {
    // A stored record with no readable id is still replaced, so it is listed as removed, by position.
    before.set(idOf(item) ?? `#${index}`, item)
  }
  const kept = new Set<string>()
  for (const item of incoming) {
    const id = idOf(item) ?? ''
    kept.add(id)
    const entry = { id, label: labelOf(item) ?? id }
    const old = before.get(id)
    if (old === undefined) diff.added.push(entry)
    else if (canonicalJson(old) === canonicalJson(item)) diff.unchanged++
    else diff.changed.push(entry)
  }
  for (const [id, item] of before) {
    if (!kept.has(id)) diff.removed.push({ id, label: labelOf(item) ?? id })
  }
  return diff
}

const byId = (item: unknown) => text(field(item, 'id'))
const byName = (item: unknown) => text(field(item, 'name'))

function diffStores(current: RawStore, incoming: WholeStore, migratedFrom: number | null, storageKept: boolean): StoreDiff {
  const currentKeys = typeof current.config === 'object' && current.config !== null ? Object.keys(current.config) : []
  const configKeys = new Set([...Object.keys(incoming.config), ...currentKeys])
  configKeys.delete('storage')
  const changedKeys = [...configKeys]
    .filter((key) => canonicalJson(field(current.config, key)) !== canonicalJson(field(incoming.config, key)))
    .sort()
  return {
    schemaVersion: { current: field(current.meta, 'schemaVersion'), incoming: incoming.meta.schemaVersion, migratedFrom },
    config: { changedKeys, storageKept },
    library: {
      patterns: diffCollection(field(current.library, 'patterns'), incoming.library.patterns, byId, byName),
      questionSets: diffCollection(field(current.library, 'questionSets'), incoming.library.questionSets, byId, byName),
      templates: diffCollection(field(current.library, 'templates'), incoming.library.templates, byId, byName),
      calibration: diffCollection(
        field(current.library, 'calibration'),
        incoming.library.calibration,
        (item) => text(field(item, 'patternId')),
        (item) => text(field(item, 'patternId')),
      ),
    },
    engagements: diffCollection(current.engagements, incoming.engagements, byId, (item) => text(field(field(item, 'company'), 'name'))),
  }
}

function prepare(raw: unknown, from: unknown, current: RawStore, now: string): ImportPreparation {
  const paths = findForbiddenKeys(raw)
  if (paths.length > 0) {
    return { ok: false, reason: 'forbidden-keys', message: `The import contains keys that are never allowed: ${paths.join(', ')}. Nothing was changed.`, paths }
  }
  if (typeof from !== 'number' || !Number.isInteger(from) || from < 1) {
    return { ok: false, reason: 'invalid', message: 'The import has no readable schema version, so it cannot be checked. Nothing was changed.', issues: [] }
  }
  if (from > CURRENT_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: 'newer-version',
      message: `The import is at schema version ${from}, but this app only supports up to schema version ${CURRENT_SCHEMA_VERSION}. Update the app and try again. Nothing was changed.`,
    }
  }

  let store: WholeStore
  try {
    // Refuses a meta version that disagrees with `from`, runs every migration step and validates the result.
    store = runMigrations(raw, from)
  } catch (error) {
    const issues = error instanceof MigrationError ? error.issues : []
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, reason: 'invalid', message: `${message} Nothing was changed.`, issues }
  }

  const ids = store.engagements.map((engagement) => engagement.id)
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))]
  if (duplicates.length > 0) {
    return { ok: false, reason: 'duplicate-ids', message: `More than one engagement has the id ${duplicates.join(', ')}. Nothing was changed.`, ids: duplicates }
  }

  const migratedFrom = from < CURRENT_SCHEMA_VERSION ? from : null
  if (migratedFrom !== null) store = { ...store, meta: { ...store.meta, lastMigratedAt: now } }

  // The storage block describes this machine's folder connection, not the data. An imported one
  // would point at a folder handle that does not exist here and silently stop the mirror.
  const local = ConfigSchema.safeParse(current.config)
  const storage: Config['storage'] | null = local.success ? local.data.storage : null
  if (storage !== null) store = { ...store, config: { ...store.config, storage } }

  return { ok: true, store, diff: diffStores(current, store, migratedFrom, storage !== null), migratedFrom }
}

export async function prepareImportText(text: string, repository: Pick<Repository, 'readRawStore'>, now: string): Promise<ImportPreparation> {
  let raw: unknown
  try {
    raw = JSON.parse(text) as unknown
  } catch (error) {
    return { ok: false, reason: 'invalid-json', message: `The file is not valid JSON: ${error instanceof Error ? error.message : String(error)}. Nothing was changed.` }
  }
  return prepare(raw, field(field(raw, 'meta'), 'schemaVersion'), await repository.readRawStore(), now)
}

// Behind the same checks and diff as a JSON import. The folder's .schema-version is the version
// the data is read at, and a meta.json that disagrees with it is refused.
export async function prepareFolderRestore(folder: FolderHandle, repository: Pick<Repository, 'readRawStore'>, now: string): Promise<ImportPreparation> {
  const read = await readFolderStore(folder)
  if (read.errors.length > 0) {
    return {
      ok: false,
      reason: 'unreadable-folder',
      message: `The folder could not be read cleanly: ${read.errors.map((error) => `${error.path} (${error.message})`).join('; ')}. Nothing was changed.`,
      errors: read.errors,
    }
  }
  return prepare(read.store, read.schemaVersion, await repository.readRawStore(), now)
}

// Applies a confirmed preparation as one full-store replace, then loads, so the caches recompute.
export async function applyImport(prepared: PreparedImport, repository: TransferRepository): Promise<LoadResult> {
  await repository.replaceStore(prepared.store)
  return repository.load()
}
