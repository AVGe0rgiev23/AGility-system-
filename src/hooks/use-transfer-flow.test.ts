import { describe, expect, it } from 'vitest'
import { engagement, newEngagement, pattern, wholeStore } from '../schema/__fixtures__/records'
import type { RawStore } from '../storage/repository'
import { prepareImportText, type ImportRefusal, type PreparedImport, type StoreDiff } from '../storage/transfer'
import {
  acknowledge,
  beginApplying,
  beginPreparing,
  cancel,
  canConfirm,
  confirmationLabel,
  diffCounts,
  failPreparing,
  finishApplying,
  IDLE,
  needsAcknowledgement,
  receivePreparation,
  type TransferFlow,
} from './use-transfer-flow'

const T1 = '2026-09-16T09:00:00.000Z'
const FILE = { kind: 'file', name: 'agility-os-export-2026-09-16.json' } as const

function emptyCollection() {
  return { added: [], removed: [], changed: [], unchanged: 0 }
}

function diff(patch: Partial<StoreDiff> = {}): StoreDiff {
  return {
    schemaVersion: { current: 4, incoming: 4, migratedFrom: null },
    config: { changedKeys: [], storageKept: true },
    library: { patterns: emptyCollection(), questionSets: emptyCollection(), templates: emptyCollection(), calibration: emptyCollection() },
    engagements: emptyCollection(),
    ...patch,
  }
}

function preparedWith(storeDiff: StoreDiff): PreparedImport {
  return { ok: true, store: wholeStore(), diff: storeDiff, migratedFrom: null }
}

// A real preparation: the stored side holds one engagement and the file brings another plus a new pattern.
async function realPreparation(): Promise<PreparedImport> {
  const stored = wholeStore()
  const current: RawStore = { ...stored, engagements: [engagement()] }
  const incoming = { ...stored, library: { ...stored.library, patterns: [...stored.library.patterns, { ...pattern(), id: 'pat-new', name: 'New pattern' }] }, engagements: [newEngagement()] }
  incoming.config = { ...incoming.config, pricing: { ...incoming.config.pricing, targetHourlyRate: 80 } }
  const preparation = await prepareImportText(JSON.stringify(incoming), { readRawStore: () => Promise.resolve(current) }, T1)
  if (!preparation.ok) throw new Error(`expected an importable file: ${preparation.message}`)
  return preparation
}

const REFUSAL: ImportRefusal = { ok: false, reason: 'forbidden-keys', message: 'The import contains keys that are never allowed: __proto__.', paths: ['__proto__'] }

describe('counting a diff', () => {
  it('counts records across engagements and every library collection, and the Config as one changed record', async () => {
    const counts = diffCounts((await realPreparation()).diff)
    expect(counts).toEqual({ added: 2, removed: 1, changed: 1 })
    expect(confirmationLabel(counts)).toBe('Replace the whole store: 2 added, 1 removed, 1 changed')
  })

  it('needs an acknowledgement only when something is removed or changed', () => {
    const entry = { id: 'x', label: 'X' }
    expect(needsAcknowledgement(diff())).toBe(false)
    expect(needsAcknowledgement(diff({ engagements: { ...emptyCollection(), added: [entry] } }))).toBe(false)
    expect(needsAcknowledgement(diff({ engagements: { ...emptyCollection(), removed: [entry] } }))).toBe(true)
    expect(needsAcknowledgement(diff({ library: { ...diff().library, templates: { ...emptyCollection(), changed: [entry] } } }))).toBe(true)
    expect(needsAcknowledgement(diff({ config: { changedKeys: ['pricing'], storageKept: true } }))).toBe(true)
  })
})

describe('preparing', () => {
  it('shows the diff of a preparation, unacknowledged', async () => {
    const prepared = await realPreparation()
    const flow = receivePreparation(beginPreparing(IDLE, FILE, 1), 1, prepared)
    expect(flow).toEqual({ step: 'prepared', source: FILE, prepared, acknowledged: false })
  })

  it('shows a refusal with its reason', () => {
    expect(receivePreparation(beginPreparing(IDLE, FILE, 1), 1, REFUSAL)).toEqual({ step: 'refused', source: FILE, refusal: REFUSAL })
  })

  it('goes back to idle when nothing was chosen', () => {
    expect(receivePreparation(beginPreparing(IDLE, { kind: 'folder' }, 1), 1, null)).toEqual(IDLE)
  })

  it('reports a preparation that threw', () => {
    expect(failPreparing(beginPreparing(IDLE, { kind: 'folder' }, 3), 3, 'The folder could not be read')).toEqual({
      step: 'failed',
      source: { kind: 'folder' },
      stage: 'prepare',
      message: 'The folder could not be read',
    })
  })

  it('drops a result for a cancelled or superseded preparation', () => {
    const second = beginPreparing(beginPreparing(IDLE, FILE, 1), { kind: 'folder' }, 2)
    expect(receivePreparation(second, 1, REFUSAL)).toBe(second)
    expect(failPreparing(second, 1, 'late')).toBe(second)
    const cancelled = cancel(beginPreparing(IDLE, FILE, 1))
    expect(receivePreparation(cancelled, 1, REFUSAL)).toBe(cancelled)
  })

  it('never interrupts a store being replaced', () => {
    const applying: TransferFlow = { step: 'applying', source: FILE, prepared: preparedWith(diff()) }
    expect(beginPreparing(applying, { kind: 'folder' }, 2)).toBe(applying)
  })
})

describe('confirming', () => {
  it('confirms a purely additive import without an acknowledgement', () => {
    const flow = receivePreparation(beginPreparing(IDLE, FILE, 1), 1, preparedWith(diff()))
    expect(canConfirm(flow)).toBe(true)
    expect(beginApplying(flow)).toMatchObject({ step: 'applying', source: FILE })
  })

  it('needs the acknowledgement ticked before replacing anything stored', async () => {
    const flow = receivePreparation(beginPreparing(IDLE, FILE, 1), 1, await realPreparation())
    expect(canConfirm(flow)).toBe(false)
    expect(beginApplying(flow)).toBe(flow)
    const ticked = acknowledge(flow, true)
    expect(canConfirm(ticked)).toBe(true)
    expect(beginApplying(ticked).step).toBe('applying')
    expect(canConfirm(acknowledge(ticked, false))).toBe(false)
  })

  it('acknowledges and confirms nothing outside a prepared diff', () => {
    const refused: TransferFlow = { step: 'refused', source: FILE, refusal: REFUSAL }
    expect(acknowledge(refused, true)).toBe(refused)
    expect(canConfirm(refused)).toBe(false)
    expect(beginApplying(refused)).toBe(refused)
    expect(canConfirm(IDLE)).toBe(false)
  })
})

describe('applying', () => {
  it('ends loaded with the counts of what was replaced', async () => {
    const prepared = await realPreparation()
    const applying: TransferFlow = { step: 'applying', source: FILE, prepared }
    expect(finishApplying(applying, { ok: true })).toEqual({ step: 'loaded', source: FILE, counts: { added: 2, removed: 1, changed: 1 } })
  })

  it('reports a failed apply', () => {
    const applying: TransferFlow = { step: 'applying', source: { kind: 'folder' }, prepared: preparedWith(diff()) }
    expect(finishApplying(applying, { ok: false, message: 'QuotaExceededError' })).toEqual({
      step: 'failed',
      source: { kind: 'folder' },
      stage: 'apply',
      message: 'QuotaExceededError',
    })
    expect(finishApplying(IDLE, { ok: true })).toBe(IDLE)
  })

  it('cannot be cancelled halfway, and every other step can', () => {
    const applying: TransferFlow = { step: 'applying', source: FILE, prepared: preparedWith(diff()) }
    expect(cancel(applying)).toBe(applying)
    const others: TransferFlow[] = [
      { step: 'preparing', source: FILE, attempt: 1 },
      { step: 'prepared', source: FILE, prepared: preparedWith(diff()), acknowledged: true },
      { step: 'refused', source: FILE, refusal: REFUSAL },
      { step: 'loaded', source: FILE, counts: { added: 0, removed: 0, changed: 0 } },
      { step: 'failed', source: FILE, stage: 'apply', message: 'x' },
    ]
    for (const flow of others) expect(cancel(flow), flow.step).toEqual(IDLE)
  })
})
