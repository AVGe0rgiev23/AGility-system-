import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { BootedStore } from '../../hooks/use-store'
import { wholeStore } from '../../schema/__fixtures__/records'
import { warningFor, type SyncStatus } from '../../storage/sync'
import { StoreNotices, StoreRefusal } from './store-status'

type LoadedStore = Extract<BootedStore, { phase: 'loaded' }>

function loadedStore(sync: SyncStatus, patch: Partial<LoadedStore['load']> = {}): LoadedStore {
  return {
    phase: 'loaded',
    load: { status: 'loaded', store: wholeStore(), problems: [], seeded: false, migratedFrom: null, recomputed: [], recomputeSkipped: false, ...patch },
    sync,
    syncError: null,
  }
}

function notices(store: LoadedStore): string {
  return renderToStaticMarkup(<StoreNotices store={store} syncWarning={warningFor(store.sync)} onConnect={() => undefined} onReconnect={() => undefined} />)
}

describe('StoreNotices', () => {
  it('offers to connect a folder when none is connected', () => {
    const html = notices(loadedStore({ kind: 'disconnected' }))
    expect(html).toContain('No folder is connected.')
    expect(html).toContain('>Connect folder</button>')
    expect(html).not.toContain('Reconnect')
  })

  it('offers to reconnect a folder whose permission lapsed', () => {
    const html = notices(loadedStore({ kind: 'needs-permission', folderName: 'agility-os-data' }))
    expect(html).toContain('needs permission again')
    expect(html).toContain('>Reconnect</button>')
    expect(html).not.toContain('Connect folder')
  })

  it('warns without a button where there is nothing the user can do from here', () => {
    const unsupported = notices(loadedStore({ kind: 'unsupported' }))
    expect(unsupported).toContain('This browser cannot mirror to a folder.')
    expect(unsupported).not.toContain('<button')

    const failing = notices(loadedStore({ kind: 'error', folderName: 'agility-os-data', message: 'disk full', staleFolders: [] }))
    expect(failing).toContain('disk full')
    expect(failing).not.toContain('<button')

    const stale = notices(loadedStore({ kind: 'connected', folderName: 'agility-os-data', lastSyncAt: null, staleFolders: ['old-co-eng1'] }))
    expect(stale).toContain('old-co-eng1')
    expect(stale).not.toContain('<button')
  })

  it('shows no sync banner for a healthy connection', () => {
    const html = notices(loadedStore({ kind: 'connected', folderName: 'agility-os-data', lastSyncAt: null, staleFolders: [] }))
    expect(html).not.toContain('SYNC')
  })

  it('reports a folder that could not be restored', () => {
    const store = { ...loadedStore({ kind: 'disconnected' }), syncError: 'the permission query failed' }
    expect(notices(store)).toContain('The folder could not be restored: the permission query failed')
  })

  it('reports a migration and a skipped recompute', () => {
    const html = notices(loadedStore({ kind: 'unsupported' }, { migratedFrom: 2, recomputeSkipped: true }))
    expect(html).toContain('The store was migrated from schema <span class="num">v2</span> to')
    expect(html).toContain(`<span class="num">v${wholeStore().meta.schemaVersion}</span>`)
    expect(html).toContain('Cached engine results were not recomputed')
  })

  it('lists every stored record that does not validate, with its issue paths, in a table', () => {
    const html = notices(
      loadedStore(
        { kind: 'unsupported' },
        {
          problems: [
            {
              table: 'engagements',
              key: 'eng-9',
              message: "Engagement 'eng-9' does not validate, so it was left out. It is still stored, unchanged.",
              issues: [{ code: 'custom', path: ['company', 'currency'], message: 'Invalid option', input: 'BGN' }],
            },
          ],
        },
      ),
    )
    expect(html).toContain('<details')
    expect(html).toContain('<span class="num">1</span> stored record does not validate.')
    expect(html).toContain('<caption class="sr-only">Stored records that do not validate</caption>')
    expect(html).toContain('<span class="num">eng-9</span>')
    expect(html).toContain('<span class="num">company.currency</span>: Invalid option')
  })

  it('shows nothing about problems when every record validates', () => {
    expect(notices(loadedStore({ kind: 'unsupported' }))).not.toContain('<details')
  })
})

describe('StoreRefusal', () => {
  it('shows the reason, the message and every issue path', () => {
    const html = renderToStaticMarkup(
      <StoreRefusal
        refusal={{
          status: 'refused',
          reason: 'corrupt-meta',
          message: 'The meta record does not validate, so the schema version cannot be trusted. Nothing was loaded or changed.',
          issues: [{ code: 'custom', path: ['schemaVersion'], message: 'Expected a whole number', input: 'x' }],
        }}
      />,
    )
    expect(html).toContain('The store was not loaded')
    expect(html).toContain('>corrupt-meta<')
    expect(html).toContain('Nothing was loaded or changed.')
    expect(html).toContain('<span class="num">schemaVersion</span>')
    expect(html).toContain('Expected a whole number')
  })
})
