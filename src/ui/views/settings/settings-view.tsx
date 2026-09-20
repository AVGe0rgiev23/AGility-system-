import { useState } from 'react'
import { useConfigForm, type ConfigFormView } from '../../../hooks/use-config-form'
import type { BootedStore, StoreHandle } from '../../../hooks/use-store'
import { useTransferFlow } from '../../../hooks/use-transfer-flow'
import type { StoreProblem } from '../../../storage/repository'
import { saveJsonFile } from '../../save-file'
import { Table } from '../../primitives/table'
import { BUTTON, FormSection, OtherProblems, SaveBar } from '../form-controls'
import { ConfigSections } from './config-sections'
import { FolderPanel, type FolderAction, type FolderPanelProps } from './folder-panel'
import { StorePanel, type StorePanelProps } from './store-panel'

type LoadedStore = Extract<BootedStore, { phase: 'loaded' }>

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

// The screen, given everything it shows. SettingsView holds the state; this only renders it.
export function SettingsScreen({ form, configProblems, saving, saveError, onSave, folder, store }: SettingsScreenProps) {
  const issues = configProblems.flatMap((problem) => problem.issues).map((issue, index) => ({ issue, index }))

  return (
    <section aria-labelledby="page-heading">
      <SaveBar title="Settings" changed={form.changed} problems={form.issues.length} canSave={form.canSave} saving={saving} onSave={onSave} onDiscard={form.discard} />

      {saveError === null ? null : (
        <p role="alert" className="border-b px-4 py-2 text-sm text-danger">
          The Config was not saved: {saveError}
        </p>
      )}

      <OtherProblems problems={form.otherProblems} />

      {form.draft === null ? (
        <FormSection id="settings-unusable" title="The stored Config is unusable">
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
        </FormSection>
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
