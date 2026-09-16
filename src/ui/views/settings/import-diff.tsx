import { useId, type ReactNode } from 'react'
import { canConfirm, confirmationLabel, diffCounts, needsAcknowledgement, type TransferFlow, type TransferSource } from '../../../hooks/use-transfer-flow'
import type { CollectionDiff, ImportRefusal, StoreDiff } from '../../../storage/transfer'
import { Table } from '../../primitives/table'
import { BUTTON } from './config-controls'

// Every step of an import or restore after it starts: what is being read, what would change, why it was
// refused, and what happened. Nothing is written until the confirm button, and the button names what
// it replaces.

const PRIMARY = 'h-6 shrink-0 rounded-sm bg-accent px-2 text-sm text-fg transition-colors hover:bg-accent/80 disabled:bg-surface disabled:text-muted'

export interface ImportDiffProps {
  flow: TransferFlow
  // Settings edits not yet saved are lost when the store is replaced, so they are named first.
  unsavedSettings: boolean
  onAcknowledge: (acknowledged: boolean) => void
  onConfirm: () => void
  onCancel: () => void
  onExportFirst: () => void
}

function sourceName(source: TransferSource): string {
  return source.kind === 'file' ? `the file '${source.name}'` : 'the chosen folder'
}

function title(source: TransferSource, what: string): string {
  return `${source.kind === 'file' ? 'Import' : 'Restore from folder'}: ${what}`
}

function Panel({ heading, tone = 'fg', children }: { heading: string; tone?: 'fg' | 'danger'; children: ReactNode }) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="my-2 border px-3 py-2">
      <h3 id={id} className={`pb-1 text-sm font-medium ${tone === 'danger' ? 'text-danger' : ''}`}>
        {heading}
      </h3>
      {children}
    </section>
  )
}

const COLLECTIONS: { key: string; label: string; pick: (diff: StoreDiff) => CollectionDiff }[] = [
  { key: 'engagements', label: 'Engagements', pick: (diff) => diff.engagements },
  { key: 'patterns', label: 'Patterns', pick: (diff) => diff.library.patterns },
  { key: 'questionSets', label: 'Question sets', pick: (diff) => diff.library.questionSets },
  { key: 'templates', label: 'Templates', pick: (diff) => diff.library.templates },
  { key: 'calibration', label: 'Calibration', pick: (diff) => diff.library.calibration },
]

function versionText(value: unknown): string {
  return typeof value === 'number' ? `v${value}` : 'unreadable'
}

function DiffDetails({ diff }: { diff: StoreDiff }) {
  const { schemaVersion, config } = diff
  const counts = COLLECTIONS.map(({ key, label, pick }) => ({ key, label, collection: pick(diff) }))
  const records = counts.flatMap(({ key, label, collection }) =>
    (['added', 'removed', 'changed'] as const).flatMap((change) => collection[change].map((entry) => ({ key: `${key}-${change}-${entry.id}`, label, change, entry }))),
  )

  return (
    <>
      <dl className="text-sm">
        <div className="grid grid-cols-[11rem_minmax(0,1fr)] gap-x-3 py-0.5">
          <dt className="text-muted">Schema version</dt>
          <dd>
            stored <span className="num">{versionText(schemaVersion.current)}</span>, replaced with <span className="num">{versionText(schemaVersion.incoming)}</span>
            {schemaVersion.migratedFrom === null ? null : (
              <>
                {' '}
                after migrating from <span className="num">{versionText(schemaVersion.migratedFrom)}</span>
              </>
            )}
          </dd>
        </div>
        <div className="grid grid-cols-[11rem_minmax(0,1fr)] gap-x-3 py-0.5">
          <dt className="text-muted">Config</dt>
          <dd>
            {config.changedKeys.length === 0 ? (
              'unchanged'
            ) : (
              <>
                changes <span className="num">{config.changedKeys.join(', ')}</span>
              </>
            )}
          </dd>
        </div>
        <div className="grid grid-cols-[11rem_minmax(0,1fr)] gap-x-3 py-0.5">
          <dt className="text-muted">Folder settings</dt>
          <dd>
            {config.storageKept
              ? "This machine's storage settings are kept, since the incoming ones point at a folder connection that does not exist here."
              : 'The stored Config does not validate, so the storage settings come from the incoming data.'}
          </dd>
        </div>
      </dl>

      <div className="pt-2">
        <Table
          caption="Records added, removed, changed and unchanged, by collection"
          columns={[
            { id: 'collection', header: 'Collection', cell: (row) => row.label },
            { id: 'added', header: 'Added', numeric: true, cell: (row) => row.collection.added.length },
            { id: 'removed', header: 'Removed', numeric: true, cell: (row) => row.collection.removed.length },
            { id: 'changed', header: 'Changed', numeric: true, cell: (row) => row.collection.changed.length },
            { id: 'unchanged', header: 'Unchanged', numeric: true, cell: (row) => row.collection.unchanged },
          ]}
          rows={counts}
          rowKey={(row) => row.key}
          empty="No collections"
        />
      </div>

      {records.length === 0 ? null : (
        <div className="pt-2">
          <Table
            caption="Each record added, removed or changed"
            columns={[
              { id: 'collection', header: 'Collection', cell: (row) => row.label },
              { id: 'change', header: 'Change', cell: (row) => <span className={`num ${row.change === 'added' ? '' : 'text-warn'}`}>{row.change}</span> },
              { id: 'label', header: 'Record', cell: (row) => row.entry.label },
              { id: 'id', header: 'Id', cell: (row) => <span className="num">{row.entry.id}</span> },
            ]}
            rows={records}
            rowKey={(row) => row.key}
            empty="Nothing added, removed or changed"
          />
        </div>
      )}
    </>
  )
}

function RefusalDetails({ refusal }: { refusal: ImportRefusal }) {
  switch (refusal.reason) {
    case 'invalid-json':
    case 'newer-version':
      return null
    case 'forbidden-keys':
    case 'duplicate-ids': {
      const items = refusal.reason === 'forbidden-keys' ? refusal.paths : refusal.ids
      return (
        <ul className="pt-1 text-sm">
          {items.map((item) => (
            <li key={item} className="num">
              {item}
            </li>
          ))}
        </ul>
      )
    }
    case 'unreadable-folder':
      return (
        <Table
          caption="Files that could not be read"
          columns={[
            { id: 'path', header: 'Path', cell: (row) => <span className="num">{row.path}</span> },
            { id: 'message', header: 'Problem', cell: (row) => row.message },
          ]}
          rows={refusal.errors}
          rowKey={(row) => `${row.path}-${row.message}`}
          empty="No files"
        />
      )
    case 'invalid': {
      const issues = refusal.issues.map((issue, index) => ({ issue, index }))
      return issues.length === 0 ? null : (
        <Table
          caption="Validation issues"
          columns={[
            { id: 'path', header: 'Path', cell: (row) => <span className="num">{row.issue.path.length === 0 ? '(root)' : row.issue.path.map(String).join('.')}</span> },
            { id: 'message', header: 'Problem', cell: (row) => row.issue.message },
          ]}
          rows={issues}
          rowKey={(row) => String(row.index)}
          empty="No issues"
        />
      )
    }
  }
}

export function ImportDiff({ flow, unsavedSettings, onAcknowledge, onConfirm, onCancel, onExportFirst }: ImportDiffProps) {
  const acknowledgeId = useId()

  switch (flow.step) {
    case 'idle':
      return null

    case 'preparing':
      return (
        <Panel heading={title(flow.source, 'reading')}>
          <p className="text-sm text-muted">Reading and checking {sourceName(flow.source)}. Nothing is written.</p>
          <div className="flex gap-2 pt-2">
            <button type="button" className={BUTTON} onClick={onCancel}>
              Cancel
            </button>
          </div>
        </Panel>
      )

    case 'refused':
      return (
        <Panel heading={title(flow.source, 'refused')} tone="danger">
          <p className="text-sm">
            <span className="num text-xs text-danger">{flow.refusal.reason}</span> {flow.refusal.message}
          </p>
          <RefusalDetails refusal={flow.refusal} />
          <div className="flex gap-2 pt-2">
            <button type="button" className={BUTTON} onClick={onCancel}>
              Dismiss
            </button>
          </div>
        </Panel>
      )

    case 'failed':
      return (
        <Panel heading={title(flow.source, flow.stage === 'prepare' ? 'could not be read' : 'the store was not replaced')} tone="danger">
          <p className="text-sm">
            {flow.message}
            {flow.stage === 'apply' ? ' The store was left as it was.' : ' Nothing was changed.'}
          </p>
          <div className="flex gap-2 pt-2">
            <button type="button" className={BUTTON} onClick={onCancel}>
              Dismiss
            </button>
          </div>
        </Panel>
      )

    case 'applying':
      return (
        <Panel heading={title(flow.source, 'replacing the store')}>
          <p className="text-sm text-muted">Replacing the whole store and recomputing its caches.</p>
        </Panel>
      )

    case 'loaded':
      return (
        <Panel heading={title(flow.source, 'done')}>
          <p className="text-sm">
            The store was replaced from {sourceName(flow.source)}: <span className="num">{flow.counts.added}</span> added,{' '}
            <span className="num">{flow.counts.removed}</span> removed, <span className="num">{flow.counts.changed}</span> changed. Every cached result was
            recomputed.
          </p>
          <div className="flex gap-2 pt-2">
            <button type="button" className={BUTTON} onClick={onCancel}>
              Dismiss
            </button>
          </div>
        </Panel>
      )

    case 'prepared': {
      const { diff } = flow.prepared
      const counts = diffCounts(diff)
      const acknowledgement = needsAcknowledgement(diff)
      return (
        <Panel heading={title(flow.source, 'review before replacing')}>
          <p className="pb-2 text-sm">
            {`${flow.source.kind === 'file' ? 'The file' : 'The folder'} was checked and nothing has been written. Confirming replaces the whole store with it.`}
          </p>
          <DiffDetails diff={diff} />
          {unsavedSettings ? <p className="pt-2 text-sm text-warn">Your unsaved Settings changes will be discarded.</p> : null}
          {acknowledgement ? (
            <label htmlFor={acknowledgeId} className="flex items-start gap-2 pt-2 text-sm">
              <input id={acknowledgeId} type="checkbox" checked={flow.acknowledged} onChange={(event) => onAcknowledge(event.target.checked)} className="mt-0.5" />
              <span>
                I understand that <span className="num">{counts.removed}</span> removed and <span className="num">{counts.changed}</span> changed records are
                replaced, and are gone unless the current store is exported first.
              </span>
            </label>
          ) : null}
          <div className="flex flex-wrap gap-2 pt-2">
            <button type="button" className={BUTTON} onClick={onExportFirst}>
              Export the current store first
            </button>
            <button type="button" className={PRIMARY} disabled={!canConfirm(flow)} onClick={onConfirm}>
              {confirmationLabel(counts)}
            </button>
            <button type="button" className={BUTTON} onClick={onCancel}>
              Cancel
            </button>
          </div>
        </Panel>
      )
    }
  }
}
