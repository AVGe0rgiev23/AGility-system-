import type { ReactNode } from 'react'
import type { BootedStore } from '../../hooks/use-store'
import { Table } from '../primitives/table'

type LoadedStore = Extract<BootedStore, { phase: 'loaded' }>
type Refusal = Extract<BootedStore, { phase: 'refused' }>['refusal']
type Issue = Refusal['issues'][number]

const BUTTON = 'h-6 shrink-0 rounded-sm bg-accent px-2 text-sm text-fg transition-colors hover:bg-accent/80'

function issuePath(issue: Issue): string {
  return issue.path.length === 0 ? '(root)' : issue.path.map(String).join('.')
}

function Notice({ tone, label, children, action }: { tone: 'warn' | 'danger' | 'muted'; label: string; children: ReactNode; action?: ReactNode }) {
  const toneClass = tone === 'warn' ? 'text-warn' : tone === 'danger' ? 'text-danger' : 'text-muted'
  return (
    <div className="flex min-h-8 items-center gap-3 border-b px-4 py-1 text-sm">
      <span className={`num w-20 shrink-0 text-xs ${toneClass}`}>{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </div>
  )
}

function IssueList({ issues }: { issues: readonly Issue[] }) {
  return (
    <ul>
      {issues.map((issue, index) => (
        <li key={index}>
          <span className="num">{issuePath(issue)}</span>: {issue.message}
        </li>
      ))}
    </ul>
  )
}

export interface StoreNoticesProps {
  store: LoadedStore
  // From warningFor: null only for a healthy connection.
  syncWarning: string | null
  onConnect: () => void
  onReconnect: () => void
}

export function StoreNotices({ store, syncWarning, onConnect, onReconnect }: StoreNoticesProps) {
  const { load, sync, syncError } = store
  const problems = load.problems.map((problem, index) => ({ ...problem, index }))
  const action =
    sync.kind === 'disconnected' ? (
      <button type="button" className={BUTTON} onClick={onConnect}>
        Connect folder
      </button>
    ) : sync.kind === 'needs-permission' ? (
      <button type="button" className={BUTTON} onClick={onReconnect}>
        Reconnect
      </button>
    ) : undefined

  return (
    <section aria-label="Store status">
      {syncWarning === null ? null : (
        <Notice tone="warn" label="SYNC" action={action}>
          {syncWarning}
        </Notice>
      )}
      {syncError === null ? null : (
        <Notice tone="danger" label="FOLDER">
          The folder could not be restored: {syncError}
        </Notice>
      )}
      {load.migratedFrom === null ? null : (
        <Notice tone="muted" label="MIGRATED">
          The store was migrated from schema <span className="num">v{load.migratedFrom}</span> to{' '}
          <span className="num">v{load.store.meta.schemaVersion}</span>.
        </Notice>
      )}
      {load.recomputeSkipped ? (
        <Notice tone="warn" label="RECOMPUTE">
          Cached engine results were not recomputed, because the stored Config or Library does not validate.
        </Notice>
      ) : null}
      {problems.length === 0 ? null : (
        <details className="border-b">
          <summary className="cursor-pointer px-4 py-1.5 text-sm">
            <span className="num text-xs text-danger">STORE</span>{' '}
            <span className="num">{problems.length}</span> stored {problems.length === 1 ? 'record does' : 'records do'} not validate.
            Each is left out and still stored, unchanged.
          </summary>
          <div className="px-4 pb-2">
            <Table
              caption="Stored records that do not validate"
              columns={[
                { id: 'table', header: 'Table', cell: (row) => <span className="num">{row.table}</span> },
                { id: 'key', header: 'Record', cell: (row) => <span className="num">{row.key}</span> },
                { id: 'message', header: 'Problem', cell: (row) => row.message },
                { id: 'issues', header: 'Issues', cell: (row) => <IssueList issues={row.issues} /> },
              ]}
              rows={problems}
              rowKey={(row) => String(row.index)}
              empty="No problems"
            />
          </div>
        </details>
      )}
    </section>
  )
}

export function StoreRefusal({ refusal }: { refusal: Refusal }) {
  const issues = refusal.issues.map((issue, index) => ({ issue, index }))
  return (
    <section aria-labelledby="store-refusal-heading">
      <header className="flex h-10 items-center gap-3 border-b px-4">
        <h1 id="store-refusal-heading" className="text-base font-medium">
          The store was not loaded
        </h1>
        <span className="num text-xs text-danger">{refusal.reason}</span>
      </header>
      <p className="px-4 py-3 text-sm">{refusal.message}</p>
      {issues.length === 0 ? null : (
        <div className="px-4">
          <Table
            caption="Validation issues"
            columns={[
              { id: 'path', header: 'Path', cell: (row) => <span className="num">{issuePath(row.issue)}</span> },
              { id: 'message', header: 'Problem', cell: (row) => row.issue.message },
            ]}
            rows={issues}
            rowKey={(row) => String(row.index)}
            empty="No issues"
          />
        </div>
      )}
    </section>
  )
}

export function StoreLoading() {
  return <p className="px-4 py-3 text-sm text-muted">Loading the store…</p>
}
