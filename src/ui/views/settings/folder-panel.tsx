import type { ReactNode } from 'react'
import type { SyncStatus } from '../../../storage/sync'
import { Table } from '../../primitives/table'
import { BUTTON, SettingsSection } from './config-controls'

export type FolderAction = 'connect' | 'reconnect' | 'sync' | 'disconnect'

// What a person can do from each state. Sync now is offered whenever a folder is in use, since with
// mirroring on every write switched off it is the only way the folder gets written.
export function folderActions(sync: SyncStatus): FolderAction[] {
  switch (sync.kind) {
    case 'unsupported':
      return []
    case 'disconnected':
      return ['connect']
    case 'needs-permission':
      return ['reconnect', 'connect', 'disconnect']
    case 'connected':
    case 'error':
      return ['sync', 'connect', 'disconnect']
  }
}

const LABELS: Record<FolderAction, (sync: SyncStatus) => string> = {
  connect: (sync) => (sync.kind === 'disconnected' ? 'Connect folder' : 'Connect a different folder'),
  reconnect: () => 'Reconnect',
  sync: () => 'Sync now',
  disconnect: () => 'Disconnect',
}

export interface FolderPanelProps {
  sync: SyncStatus
  // Why the folder stored from a previous session could not be restored at startup.
  syncError: string | null
  onAction: (action: FolderAction) => void
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[11rem_minmax(0,1fr)] gap-x-3 py-1 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  )
}

export function FolderPanel({ sync, syncError, onAction }: FolderPanelProps) {
  const folderName = sync.kind === 'unsupported' || sync.kind === 'disconnected' ? null : sync.folderName
  const staleFolders = sync.kind === 'connected' || sync.kind === 'error' ? sync.staleFolders : []
  const actions = folderActions(sync)

  return (
    <SettingsSection id="settings-folder" title="Folder">
      <dl>
        <Row label="Status">
          <span className={`num ${sync.kind === 'connected' ? '' : sync.kind === 'error' ? 'text-danger' : 'text-warn'}`}>{sync.kind}</span>
        </Row>
        <Row label="Folder">{folderName === null ? <span className="num text-muted">none</span> : <span className="num">{folderName}</span>}</Row>
        {sync.kind === 'connected' ? (
          <Row label="Last sync">{sync.lastSyncAt === null ? <span className="num text-muted">not yet</span> : <span className="num">{sync.lastSyncAt}</span>}</Row>
        ) : null}
      </dl>

      {sync.kind === 'unsupported' ? (
        <p className="py-1 text-sm text-warn">
          This browser cannot connect a folder, so nothing is mirrored to disk. Use Export below to keep a copy of the store, and Import to bring one back.
        </p>
      ) : null}
      {sync.kind === 'needs-permission' ? (
        <p className="py-1 text-sm text-warn">The browser needs permission again before anything can be written to this folder.</p>
      ) : null}
      {sync.kind === 'error' ? (
        <p role="alert" className="py-1 text-sm text-danger">
          The last write to the folder failed: {sync.message}. Your data is safe in this browser and is written on the next save or sync.
        </p>
      ) : null}
      {syncError === null ? null : (
        <p role="alert" className="py-1 text-sm text-danger">
          The folder could not be restored at startup: {syncError}
        </p>
      )}

      {actions.length === 0 ? null : (
        <div className="flex gap-2 py-1">
          {actions.map((action) => (
            <button key={action} type="button" className={BUTTON} onClick={() => onAction(action)}>
              {LABELS[action](sync)}
            </button>
          ))}
        </div>
      )}

      {staleFolders.length === 0 ? null : (
        <div className="pt-2">
          <h3 className="pb-1 text-sm text-muted">Stale folders</h3>
          <Table
            caption="Engagement folders no longer written to"
            columns={[
              { id: 'folder', header: 'Folder', cell: (name) => <span className="num">engagements/{name}</span> },
              { id: 'action', header: 'Action', cell: () => <span className="text-muted">delete by hand</span> },
            ]}
            rows={staleFolders}
            rowKey={(name) => name}
            empty="No stale folders"
          />
          <p className="pt-1 text-xs text-muted">
            A renamed or deleted engagement leaves its old folder behind. The mirror never deletes from the folder, since it is the backup, so delete these by
            hand once you are sure.
          </p>
        </div>
      )}
    </SettingsSection>
  )
}
