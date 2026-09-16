import { useState } from 'react'
import { useConfigForm, type ConfigFormView } from '../../../hooks/use-config-form'
import type { BootedStore, StoreHandle } from '../../../hooks/use-store'
import { useTransferFlow } from '../../../hooks/use-transfer-flow'
import type { StoreProblem } from '../../../storage/repository'
import { saveJsonFile } from '../../save-file'
import { Table } from '../../primitives/table'
import { BUTTON, SettingsSection } from './config-controls'
import { ConfigSections } from './config-sections'
import { FolderPanel, type FolderAction, type FolderPanelProps } from './folder-panel'
import { StorePanel, type StorePanelProps } from './store-panel'

type LoadedStore = Extract<BootedStore, { phase: 'loaded' }>

const PRIMARY = 'h-6 shrink-0 rounded-sm bg-accent px-2 text-sm text-fg transition-colors hover:bg-accent/80 disabled:bg-surface disabled:text-muted'

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export interface SettingsScreenProps {
  form: ConfigFormView
  // Why the stored Config did not load, when it did not.
  configProblems: readonly StoreProblem[]
  saving: boolean
  saveError: string | null
  onSave: () => void
  folder: FolderPanelProps
  store: Omit<StorePanelProps, 'unsavedSettings'>
}

function saveStatus(form: ConfigFormView, saving: boolean): { text: string; tone: string } {
  if (saving) return { text: 'Saving…', tone: 'text-muted' }
  if (!form.changed) return { text: 'No unsaved changes', tone: 'text-muted' }
  const count = form.issues.length
  if (count > 0) return { text: `Unsaved changes: ${count} ${count === 1 ? 'problem' : 'problems'} to fix before saving`, tone: 'text-danger' }
  return { text: 'Unsaved changes', tone: 'text-warn' }
}

// The screen, given everything it shows. SettingsView holds the state; this only renders it.
export function SettingsScreen({ form, configProblems, saving, saveError, onSave, folder, store }: SettingsScreenProps) {
  const status = saveStatus(form, saving)
  const issues = configProblems.flatMap((problem) => problem.issues).map((issue, index) => ({ issue, index }))

  return (
    <section aria-labelledby="page-heading">
      {/* Kept in view while scrolling, since Save is the one action every edit below leads to. */}
      <header className="sticky top-0 z-10 flex h-10 items-center gap-3 border-b bg-bg px-4">
        <h1 id="page-heading" className="text-base font-medium">
          Settings
        </h1>
        <span role="status" className={`ml-auto text-sm ${status.tone}`}>
          {status.text}
        </span>
        <button type="button" className={BUTTON} disabled={!form.changed || saving} onClick={form.discard}>
          Discard changes
        </button>
        <button type="button" className={PRIMARY} disabled={!form.canSave || saving} onClick={onSave}>
          Save
        </button>
      </header>

      {saveError === null ? null : (
        <p role="alert" className="border-b px-4 py-2 text-sm text-danger">
          The Config was not saved: {saveError}
        </p>
      )}

      {form.otherProblems.length === 0 ? null : (
        <section aria-labelledby="settings-other-problems" className="border-b px-4 py-3">
          <h2 id="settings-other-problems" className="pb-1 text-sm font-medium text-danger">
            Other problems
          </h2>
          <p className="pb-1 text-xs text-muted">These block saving and have no field of their own on this screen.</p>
          <ul role="alert" className="text-sm">
            {form.otherProblems.map((problem) => (
              <li key={`${problem.path}-${problem.message}`}>
                <span className="num">{problem.path === '' ? '(root)' : problem.path}</span>: {problem.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      {form.draft === null ? (
        <SettingsSection id="settings-unusable" title="The stored Config is unusable">
          {configProblems.map((problem) => (
            <p key={problem.key} className="pb-1 text-sm">
              {problem.message}
            </p>
          ))}
          {issues.length === 0 ? null : (
            <Table
              caption="Why the stored Config does not validate"
              columns={[
                { id: 'path', header: 'Path', cell: (row) => <span className="num">{row.issue.path.length === 0 ? '(root)' : row.issue.path.map(String).join('.')}</span> },
                { id: 'message', header: 'Problem', cell: (row) => row.issue.message },
              ]}
              rows={issues}
              rowKey={(row) => String(row.index)}
              empty="No issues"
            />
          )}
          <div className="flex items-center gap-3 pt-2">
            <button type="button" className={BUTTON} onClick={form.startFromDefaults}>
              Start from defaults
            </button>
            <span className="text-xs text-muted">
              Fills this form with the seed defaults. Nothing is written until Save. Importing or restoring a store also brings a Config back.
            </span>
          </div>
        </SettingsSection>
      ) : (
        <ConfigSections form={form} draft={form.draft} />
      )}

      <FolderPanel {...folder} />
      <StorePanel {...store} unsavedSettings={form.changed} />
    </section>
  )
}

export interface SettingsViewProps {
  loaded: LoadedStore
  handle: StoreHandle
  appVersion: string
}

export function SettingsView({ loaded, handle, appVersion }: SettingsViewProps) {
  const form = useConfigForm(loaded.load.store.config)
  const transfer = useTransferFlow(handle)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)

  const save = async () => {
    if (!form.canSave || form.draft === null) return
    setSaving(true)
    setSaveError(null)
    const result = await handle.saveConfig(form.draft)
    setSaving(false)
    if (!result.ok) setSaveError(result.message)
  }

  const exportNow = async () => {
    setExportError(null)
    try {
      const { filename, text } = await handle.exportStore()
      saveJsonFile(filename, text)
    } catch (error) {
      setExportError(describeError(error))
    }
  }

  const folderAction = (action: FolderAction) => {
    const run = { connect: handle.connect, reconnect: handle.reconnect, sync: handle.syncNow, disconnect: handle.disconnect }[action]
    void run()
  }

  return (
    <SettingsScreen
      form={form}
      configProblems={loaded.load.problems.filter((problem) => problem.table === 'config')}
      saving={saving}
      saveError={saveError}
      onSave={() => void save()}
      folder={{ sync: loaded.sync, syncError: loaded.syncError, onAction: folderAction }}
      store={{
        meta: loaded.load.store.meta,
        appVersion,
        canPickFolder: handle.canPickFolder,
        flow: transfer.flow,
        exportError,
        onExport: () => void exportNow(),
        onImportFile: (file) => void transfer.importFile(file),
        onRestore: () => void transfer.restoreFromFolder(),
        onAcknowledge: transfer.acknowledge,
        onConfirm: () => void transfer.confirm(),
        onCancel: transfer.cancel,
      }}
    />
  )
}
