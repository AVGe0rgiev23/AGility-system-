import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { SyncStatus } from '../../../storage/sync'
import { folderActions, FolderPanel } from './folder-panel'

function render(sync: SyncStatus, syncError: string | null = null): string {
  return renderToStaticMarkup(<FolderPanel sync={sync} syncError={syncError} onAction={() => undefined} />)
}

function buttons(html: string): string[] {
  return [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((match) => match[1] ?? '')
}

describe('folderActions', () => {
  it('offers what each state can use', () => {
    expect(folderActions({ kind: 'unsupported' })).toEqual([])
    expect(folderActions({ kind: 'disconnected' })).toEqual(['connect'])
    expect(folderActions({ kind: 'needs-permission', folderName: 'data' })).toEqual(['reconnect', 'connect', 'disconnect'])
    expect(folderActions({ kind: 'connected', folderName: 'data', lastSyncAt: null, staleFolders: [] })).toEqual(['sync', 'connect', 'disconnect'])
    expect(folderActions({ kind: 'error', folderName: 'data', message: 'disk full', staleFolders: [] })).toEqual(['sync', 'connect', 'disconnect'])
  })
})

describe('FolderPanel', () => {
  it('points to export and import where the browser cannot connect a folder', () => {
    const html = render({ kind: 'unsupported' })
    expect(html).toContain('>unsupported</span>')
    expect(html).toContain('Use Export below to keep a copy of the store, and Import to bring one back.')
    expect(buttons(html)).toEqual([])
  })

  it('offers to connect when no folder is connected', () => {
    const html = render({ kind: 'disconnected' })
    expect(html).toContain('<span class="num text-muted">none</span>')
    expect(buttons(html)).toEqual(['Connect folder'])
  })

  it('shows the folder, its last sync and sync now when connected', () => {
    const html = render({ kind: 'connected', folderName: 'agility-os-data', lastSyncAt: '2026-09-16T09:00:00.000Z', staleFolders: [] })
    expect(html).toContain('<span class="num">agility-os-data</span>')
    expect(html).toContain('<span class="num">2026-09-16T09:00:00.000Z</span>')
    expect(buttons(html)).toEqual(['Sync now', 'Connect a different folder', 'Disconnect'])
    expect(html).not.toContain('Stale folders')
  })

  it('offers to reconnect a folder whose permission lapsed', () => {
    const html = render({ kind: 'needs-permission', folderName: 'agility-os-data' })
    expect(html).toContain('needs permission again')
    expect(buttons(html)).toEqual(['Reconnect', 'Connect a different folder', 'Disconnect'])
  })

  it('reports a failing folder and a folder that could not be restored at startup', () => {
    const html = render({ kind: 'error', folderName: 'agility-os-data', message: 'disk full', staleFolders: [] }, 'the permission query failed')
    expect(html).toContain('The last write to the folder failed: disk full.')
    expect(html).toContain('The folder could not be restored at startup: the permission query failed')
    expect(buttons(html)).toContain('Sync now')
  })

  it('lists stale folders to delete by hand', () => {
    const html = render({ kind: 'connected', folderName: 'agility-os-data', lastSyncAt: null, staleFolders: ['acme-eng12345', 'old-co-eng67890'] })
    expect(html).toContain('Stale folders')
    expect(html).toContain('<span class="num">engagements/acme-eng12345</span>')
    expect(html).toContain('<span class="num">engagements/old-co-eng67890</span>')
    expect(html.match(/delete by hand<\/span>/g)).toHaveLength(2)
    expect(html).toContain('<span class="num text-muted">not yet</span>')
  })
})
