import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { TransferFlow } from '../../../hooks/use-transfer-flow'
import { engagement, newEngagement, wholeStore } from '../../../schema/__fixtures__/records'
import type { RawStore } from '../../../storage/repository'
import { CURRENT_SCHEMA_VERSION } from '../../../schema/version'
import { prepareImportText, type ImportRefusal, type PreparedImport } from '../../../storage/transfer'
import { ImportDiff } from './import-diff'

const T1 = '2026-09-16T09:00:00.000Z'
const FILE = { kind: 'file', name: 'agility-os-export-2026-09-16.json' } as const
const ignore = () => undefined

function render(flow: TransferFlow, unsavedSettings = false): string {
  return renderToStaticMarkup(
    <ImportDiff flow={flow} unsavedSettings={unsavedSettings} onAcknowledge={ignore} onConfirm={ignore} onCancel={ignore} onExportFirst={ignore} />,
  )
}

async function prepare(current: RawStore, incoming: unknown): Promise<PreparedImport> {
  const preparation = await prepareImportText(JSON.stringify(incoming), { readRawStore: () => Promise.resolve(current) }, T1)
  if (!preparation.ok) throw new Error(`expected an importable file: ${preparation.message}`)
  return preparation
}

// Stored: one engagement. Incoming: a different engagement and a higher hourly rate.
async function replacing(): Promise<PreparedImport> {
  const stored = wholeStore()
  const incoming = { ...stored, engagements: [newEngagement()], config: { ...stored.config, pricing: { ...stored.config.pricing, targetHourlyRate: 80 } } }
  return prepare({ ...stored, engagements: [engagement()] }, incoming)
}

// Stored: nothing but the seed. Incoming: the same plus an engagement.
async function adding(): Promise<PreparedImport> {
  const stored = wholeStore()
  return prepare({ ...stored, engagements: [] }, { ...stored, engagements: [newEngagement()] })
}

function confirmButton(html: string): string {
  const button = /<button[^>]*>Replace the whole store:[^<]*<\/button>/.exec(html)?.[0]
  if (button === undefined) throw new Error('no confirm button')
  return button
}

describe('ImportDiff', () => {
  it('renders nothing when idle', () => {
    expect(render({ step: 'idle' })).toBe('')
  })

  it('says what is being read, with nothing written', () => {
    const html = render({ step: 'preparing', source: FILE, attempt: 1 })
    expect(html).toContain("Reading and checking the file &#x27;agility-os-export-2026-09-16.json&#x27;. Nothing is written.")
    expect(html).toContain('>Cancel</button>')
    expect(render({ step: 'preparing', source: { kind: 'folder' }, attempt: 1 })).toContain('Restore from folder: reading')
  })

  it('shows the versions, the Config keys that change, the kept storage block and every record replaced', async () => {
    const html = render({ step: 'prepared', source: FILE, prepared: await replacing(), acknowledged: false })
    expect(html).toContain('Import: review before replacing')
    expect(html).toContain(`stored <span class="num">v${CURRENT_SCHEMA_VERSION}</span>, replaced with <span class="num">v${CURRENT_SCHEMA_VERSION}</span>`)
    expect(html).toContain('changes <span class="num">pricing</span>')
    expect(html).toContain('storage settings are kept')
    expect(html).toContain(`<span class="num">${newEngagement().id}</span>`)
    expect(html).toContain(`<span class="num">${engagement().id}</span>`)
    expect(html).toContain('<span class="num ">added</span>')
    expect(html).toContain('<span class="num text-warn">removed</span>')
    expect(html).toContain('>Export the current store first</button>')
  })

  it('names a migration in the versions', async () => {
    const prepared = await replacing()
    const migrated: PreparedImport = { ...prepared, diff: { ...prepared.diff, schemaVersion: { current: 4, incoming: 4, migratedFrom: 2 } } }
    expect(render({ step: 'prepared', source: FILE, prepared: migrated, acknowledged: false })).toContain('after migrating from <span class="num">v2</span>')
  })

  it('needs the acknowledgement ticked before replacing anything stored, with the counts on the button', async () => {
    const prepared = await replacing()
    const unticked = render({ step: 'prepared', source: FILE, prepared, acknowledged: false })
    expect(unticked).toContain('type="checkbox"')
    expect(confirmButton(unticked)).toContain('disabled=""')
    expect(confirmButton(unticked)).toContain('>Replace the whole store: 1 added, 1 removed, 1 changed</button>')

    const ticked = render({ step: 'prepared', source: FILE, prepared, acknowledged: true })
    expect(ticked).toContain('checked=""')
    expect(confirmButton(ticked)).not.toContain('disabled=""')
  })

  it('confirms a purely additive import without an acknowledgement', async () => {
    const html = render({ step: 'prepared', source: FILE, prepared: await adding(), acknowledged: false })
    expect(html).not.toContain('type="checkbox"')
    expect(confirmButton(html)).not.toContain('disabled=""')
    expect(confirmButton(html)).toContain('>Replace the whole store: 1 added, 0 removed, 0 changed</button>')
  })

  it('names unsaved Settings changes as discarded', async () => {
    const prepared = await adding()
    expect(render({ step: 'prepared', source: FILE, prepared, acknowledged: false }, true)).toContain('Your unsaved Settings changes will be discarded.')
    expect(render({ step: 'prepared', source: FILE, prepared, acknowledged: false }, false)).not.toContain('unsaved')
  })

  it('shows a refusal with its reason, message and details', () => {
    const cases: { refusal: ImportRefusal; details: string[] }[] = [
      { refusal: { ok: false, reason: 'forbidden-keys', message: 'The import contains keys that are never allowed.', paths: ['engagements.0.__proto__'] }, details: ['engagements.0.__proto__'] },
      { refusal: { ok: false, reason: 'duplicate-ids', message: 'More than one engagement has the id eng-1.', ids: ['eng-1'] }, details: ['eng-1'] },
      {
        refusal: { ok: false, reason: 'unreadable-folder', message: 'The folder could not be read cleanly.', errors: [{ path: 'meta.json', message: 'not valid JSON' }] },
        details: ['meta.json', 'not valid JSON'],
      },
      {
        refusal: { ok: false, reason: 'invalid', message: 'The store does not validate.', issues: [{ code: 'custom', path: ['config', 'roi', 'horizonYears'], message: 'The horizon must be a whole number', input: 2.5 }] },
        details: ['config.roi.horizonYears', 'The horizon must be a whole number'],
      },
      { refusal: { ok: false, reason: 'newer-version', message: 'The import is at schema version 9.' }, details: [] },
      { refusal: { ok: false, reason: 'invalid-json', message: 'The file is not valid JSON.' }, details: [] },
    ]
    for (const { refusal, details } of cases) {
      const html = render({ step: 'refused', source: { kind: 'folder' }, refusal })
      expect(html, refusal.reason).toContain('Restore from folder: refused')
      expect(html, refusal.reason).toContain(`<span class="num text-xs text-danger">${refusal.reason}</span> ${refusal.message}`)
      for (const detail of details) expect(html, refusal.reason).toContain(detail)
      expect(html, refusal.reason).toContain('>Dismiss</button>')
      expect(html, refusal.reason).not.toContain('Replace the whole store')
    }
  })

  it('shows the store being replaced with no way to cancel it', async () => {
    const html = render({ step: 'applying', source: FILE, prepared: await adding() })
    expect(html).toContain('Replacing the whole store and recomputing its caches.')
    expect(html).not.toContain('<button')
  })

  it('reports what was replaced, and a failure at either stage', () => {
    const loaded = render({ step: 'loaded', source: FILE, counts: { added: 2, removed: 1, changed: 1 } })
    expect(loaded).toContain('<span class="num">2</span> added, <span class="num">1</span> removed, <span class="num">1</span> changed')

    const read = render({ step: 'failed', source: { kind: 'folder' }, stage: 'prepare', message: 'NotAllowedError' })
    expect(read).toContain('Restore from folder: could not be read')
    expect(read).toContain('NotAllowedError Nothing was changed.')

    const applied = render({ step: 'failed', source: FILE, stage: 'apply', message: 'QuotaExceededError' })
    expect(applied).toContain('Import: the store was not replaced')
    expect(applied).toContain('QuotaExceededError The store was left as it was.')
  })
})
