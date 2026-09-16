import { useRef, useState } from 'react'
import type { ImportPreparation, ImportRefusal, PreparedImport, StoreDiff } from '../storage/transfer'
import type { ActionResult } from './use-store'

// Import from a file and restore from a folder, as one flow of pure steps. Nothing is written until
// the diff has been shown and confirmed, and a replacement that removes or changes anything needs an
// explicit acknowledgement first. The steps: idle, preparing, then prepared (the diff) or refused,
// then applying, then loaded. A preparation or apply that throws ends in failed.

export type TransferSource = { kind: 'file'; name: string } | { kind: 'folder' }

export interface DiffCounts {
  added: number
  removed: number
  changed: number
}

export type TransferFlow =
  | { step: 'idle' }
  // `attempt` ties a result to the request that asked for it, so a preparation that finishes after
  // being cancelled, or after a newer one started, is dropped.
  | { step: 'preparing'; source: TransferSource; attempt: number }
  | { step: 'prepared'; source: TransferSource; prepared: PreparedImport; acknowledged: boolean }
  | { step: 'refused'; source: TransferSource; refusal: ImportRefusal }
  | { step: 'applying'; source: TransferSource; prepared: PreparedImport }
  | { step: 'loaded'; source: TransferSource; counts: DiffCounts }
  | { step: 'failed'; source: TransferSource; stage: 'prepare' | 'apply'; message: string }

export const IDLE: TransferFlow = { step: 'idle' }

// Records, not fields: the Config is one record, counted as changed when any of its keys differs.
export function diffCounts(diff: StoreDiff): DiffCounts {
  const collections = [diff.engagements, diff.library.patterns, diff.library.questionSets, diff.library.templates, diff.library.calibration]
  const total = (key: 'added' | 'removed' | 'changed') => collections.reduce((sum, collection) => sum + collection[key].length, 0)
  return { added: total('added'), removed: total('removed'), changed: total('changed') + (diff.config.changedKeys.length > 0 ? 1 : 0) }
}

// Adding records loses nothing. Removing or changing one replaces what is stored, so it is acknowledged first.
export function needsAcknowledgement(diff: StoreDiff): boolean {
  const counts = diffCounts(diff)
  return counts.removed > 0 || counts.changed > 0
}

export function confirmationLabel(counts: DiffCounts): string {
  return `Replace the whole store: ${counts.added} added, ${counts.removed} removed, ${counts.changed} changed`
}

export function beginPreparing(flow: TransferFlow, source: TransferSource, attempt: number): TransferFlow {
  // A store being replaced is not interrupted.
  if (flow.step === 'applying') return flow
  return { step: 'preparing', source, attempt }
}

// Null means nothing was chosen, such as a closed folder picker.
export function receivePreparation(flow: TransferFlow, attempt: number, preparation: ImportPreparation | null): TransferFlow {
  if (flow.step !== 'preparing' || flow.attempt !== attempt) return flow
  if (preparation === null) return IDLE
  if (!preparation.ok) return { step: 'refused', source: flow.source, refusal: preparation }
  return { step: 'prepared', source: flow.source, prepared: preparation, acknowledged: false }
}

export function failPreparing(flow: TransferFlow, attempt: number, message: string): TransferFlow {
  if (flow.step !== 'preparing' || flow.attempt !== attempt) return flow
  return { step: 'failed', source: flow.source, stage: 'prepare', message }
}

export function acknowledge(flow: TransferFlow, acknowledged: boolean): TransferFlow {
  return flow.step === 'prepared' ? { ...flow, acknowledged } : flow
}

export function canConfirm(flow: TransferFlow): boolean {
  return flow.step === 'prepared' && (flow.acknowledged || !needsAcknowledgement(flow.prepared.diff))
}

export function beginApplying(flow: TransferFlow): TransferFlow {
  if (flow.step !== 'prepared' || !canConfirm(flow)) return flow
  return { step: 'applying', source: flow.source, prepared: flow.prepared }
}

export function finishApplying(flow: TransferFlow, result: ActionResult): TransferFlow {
  if (flow.step !== 'applying') return flow
  if (!result.ok) return { step: 'failed', source: flow.source, stage: 'apply', message: result.message }
  return { step: 'loaded', source: flow.source, counts: diffCounts(flow.prepared.diff) }
}

// Back to idle from anywhere but applying, which cannot be taken back halfway.
export function cancel(flow: TransferFlow): TransferFlow {
  return flow.step === 'applying' ? flow : IDLE
}

export interface TransferActions {
  prepareImport: (text: string) => Promise<ImportPreparation>
  prepareRestore: () => Promise<ImportPreparation | null>
  applyImport: (prepared: PreparedImport) => Promise<ActionResult>
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function useTransferFlow(actions: TransferActions) {
  const [flow, setFlow] = useState<TransferFlow>(IDLE)
  const attempts = useRef(0)

  const prepare = async (source: TransferSource, run: () => Promise<ImportPreparation | null>) => {
    const attempt = ++attempts.current
    setFlow((current) => beginPreparing(current, source, attempt))
    try {
      const preparation = await run()
      setFlow((current) => receivePreparation(current, attempt, preparation))
    } catch (error) {
      setFlow((current) => failPreparing(current, attempt, describeError(error)))
    }
  }

  return {
    flow,
    canConfirm: canConfirm(flow),
    importFile: (file: { name: string; text: () => Promise<string> }) =>
      prepare({ kind: 'file', name: file.name }, async () => actions.prepareImport(await file.text())),
    restoreFromFolder: () => prepare({ kind: 'folder' }, actions.prepareRestore),
    acknowledge: (acknowledged: boolean) => setFlow((current) => acknowledge(current, acknowledged)),
    confirm: async () => {
      if (flow.step !== 'prepared' || !canConfirm(flow)) return
      setFlow(beginApplying(flow))
      const result = await actions.applyImport(flow.prepared)
      setFlow((current) => finishApplying(current, result))
    },
    cancel: () => setFlow(cancel),
  }
}
