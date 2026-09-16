import type { ChangeEvent, ReactNode } from 'react'
import type { TransferFlow } from '../../../hooks/use-transfer-flow'
import type { Meta } from '../../../schema/meta'
import { CURRENT_SCHEMA_VERSION } from '../../../schema/version'
import { BUTTON, FormSection } from '../form-controls'
import { ImportDiff } from './import-diff'

// The store as a whole: its versions and times, export, import from a file and restore from a mirrored
// folder. Versions and times are identifiers, not figures, so they carry no source.

export interface StorePanelProps {
  meta: Meta
  // The version of the app running now; meta.appVersion is the one that created or last migrated the store.
  appVersion: string
  canPickFolder: boolean
  flow: TransferFlow
  unsavedSettings: boolean
  exportError: string | null
  onExport: () => void
  onImportFile: (file: File) => void
  onRestore: () => void
  onAcknowledge: (acknowledged: boolean) => void
  onConfirm: () => void
  onCancel: () => void
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[11rem_minmax(0,1fr)] gap-x-3 py-1 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="num min-w-0">{children}</dd>
    </div>
  )
}

export function StorePanel(props: StorePanelProps) {
  const { meta, appVersion, canPickFolder, flow, exportError } = props
  // Starting another import mid-way would drop the one on screen; replacing the store cannot be interrupted.
  const busy = flow.step === 'preparing' || flow.step === 'applying'

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Cleared so choosing the same file again still reads it.
    event.target.value = ''
    if (file !== undefined) props.onImportFile(file)
  }

  return (
    <FormSection id="settings-store" title="Store">
      <dl>
        <Row label="Schema version">
          v{meta.schemaVersion}
          <span className="text-muted"> stored, v{CURRENT_SCHEMA_VERSION} supported by this app</span>
        </Row>
        <Row label="App version">
          {appVersion}
          <span className="text-muted"> running, {meta.appVersion} created or last migrated the store</span>
        </Row>
        <Row label="Created">{meta.createdAt}</Row>
        <Row label="Last migrated">{meta.lastMigratedAt ?? <span className="text-muted">never</span>}</Row>
      </dl>

      <div className="flex flex-wrap items-center gap-2 py-1">
        <button type="button" className={BUTTON} onClick={props.onExport} disabled={flow.step === 'applying'}>
          Export
        </button>
        <label className={`${BUTTON} inline-flex cursor-pointer items-center has-[:focus-visible]:outline has-[:focus-visible]:outline-accent ${busy ? 'pointer-events-none text-muted' : ''}`}>
          Import from file
          <input type="file" accept=".json,application/json" className="sr-only" disabled={busy} onChange={chooseFile} />
        </label>
        {canPickFolder ? (
          <button type="button" className={BUTTON} onClick={props.onRestore} disabled={busy}>
            Restore from folder
          </button>
        ) : null}
      </div>
      <p className="text-xs text-muted">
        Export writes every stored record, including any that do not validate. Import and restore check everything first and show what would change; nothing is
        written until you confirm.
      </p>
      {exportError === null ? null : (
        <p role="alert" className="pt-1 text-sm text-danger">
          The store could not be exported: {exportError}
        </p>
      )}

      <ImportDiff
        flow={flow}
        unsavedSettings={props.unsavedSettings}
        onAcknowledge={props.onAcknowledge}
        onConfirm={props.onConfirm}
        onCancel={props.onCancel}
        onExportFirst={props.onExport}
      />
    </FormSection>
  )
}
