import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { TransferFlow } from '../../../hooks/use-transfer-flow'
import { meta } from '../../../schema/__fixtures__/records'
import { CURRENT_SCHEMA_VERSION } from '../../../schema/version'
import { StorePanel } from './store-panel'

const ignore = () => undefined

function render(flow: TransferFlow = { step: 'idle' }, patch: { canPickFolder?: boolean; exportError?: string | null } = {}): string {
  return renderToStaticMarkup(
    <StorePanel
      meta={{ ...meta(), lastMigratedAt: null }}
      appVersion="0.2.0"
      canPickFolder={patch.canPickFolder ?? true}
      flow={flow}
      unsavedSettings={false}
      exportError={patch.exportError ?? null}
      onExport={ignore}
      onImportFile={ignore}
      onRestore={ignore}
      onAcknowledge={ignore}
      onConfirm={ignore}
      onCancel={ignore}
    />,
  )
}

describe('StorePanel', () => {
  it('shows the stored and supported schema versions, both app versions and the store times', () => {
    const stored = meta()
    const html = render()
    expect(html).toContain(`v${stored.schemaVersion}<span class="text-muted"> stored, v${CURRENT_SCHEMA_VERSION} supported by this app</span>`)
    expect(html).toContain(`0.2.0<span class="text-muted"> running, ${stored.appVersion} created or last migrated the store</span>`)
    expect(html).toContain(`<dd class="num min-w-0">${stored.createdAt}</dd>`)
    expect(html).toContain('<span class="text-muted">never</span>')
  })

  it('offers export, import from a file and restore from a folder', () => {
    const html = render()
    expect(html).toContain('>Export</button>')
    expect(html).toContain('Import from file<input type="file" accept=".json,application/json"')
    expect(html).toContain('>Restore from folder</button>')
  })

  it('offers no restore where the browser cannot pick a folder', () => {
    const html = render({ step: 'idle' }, { canPickFolder: false })
    expect(html).not.toContain('Restore from folder')
    expect(html).toContain('Import from file')
  })

  it('blocks starting another import while one is being read or applied', () => {
    const preparing = render({ step: 'preparing', source: { kind: 'folder' }, attempt: 1 })
    expect(preparing).toMatch(/<input type="file"[^>]*disabled=""/)
    expect(preparing).toMatch(/<button[^>]*disabled=""[^>]*>Restore from folder<\/button>/)
    expect(preparing).toMatch(/<button[^>]*>Export<\/button>/)
    expect(preparing).not.toMatch(/<button[^>]*disabled=""[^>]*>Export<\/button>/)
  })

  it('reports an export that failed', () => {
    expect(render({ step: 'idle' }, { exportError: 'the database is closed' })).toContain('The store could not be exported: the database is closed')
  })

  it('shows the import flow under the buttons', () => {
    expect(render({ step: 'loaded', source: { kind: 'file', name: 'x.json' }, counts: { added: 1, removed: 0, changed: 0 } })).toContain('Import: done')
  })
})
