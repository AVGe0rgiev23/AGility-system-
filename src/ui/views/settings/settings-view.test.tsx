import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { configFormView, initialConfigForm, setNumberText, setText, type ConfigFormState } from '../../../hooks/use-config-form'
import { meta } from '../../../schema/__fixtures__/records'
import { defaultConfig, type Config } from '../../../schema/config'
import type { StoreProblem } from '../../../storage/repository'
import { SettingsScreen } from './settings-view'

const ignore = () => undefined

function render(state: ConfigFormState, patch: { configProblems?: StoreProblem[]; saving?: boolean; saveError?: string | null } = {}): string {
  return renderToStaticMarkup(
    <SettingsScreen
      form={configFormView(state, ignore)}
      configProblems={patch.configProblems ?? []}
      saving={patch.saving ?? false}
      saveError={patch.saveError ?? null}
      onSave={ignore}
      folder={{ sync: { kind: 'disconnected' }, syncError: null, onAction: ignore }}
      store={{
        meta: meta(),
        appVersion: '0.2.0',
        canPickFolder: true,
        flow: { step: 'idle' },
        exportError: null,
        onExport: ignore,
        onImportFile: ignore,
        onRestore: ignore,
        onAcknowledge: ignore,
        onConfirm: ignore,
        onCancel: ignore,
      }}
    />,
  )
}

function button(html: string, label: string): string {
  const found = new RegExp(`<button[^>]*>${label}</button>`).exec(html)?.[0]
  if (found === undefined) throw new Error(`no '${label}' button`)
  return found
}

describe('SettingsScreen, save bar', () => {
  it('has nothing to save or discard until something changes', () => {
    const html = render(initialConfigForm(defaultConfig()))
    expect(html).toContain('>No unsaved changes</span>')
    expect(button(html, 'Save')).toContain('disabled=""')
    expect(button(html, 'Discard changes')).toContain('disabled=""')
  })

  it('offers to save a valid change', () => {
    const html = render(setNumberText(initialConfigForm(defaultConfig()), 'pricing.targetHourlyRate', '70'))
    expect(html).toContain('text-warn">Unsaved changes</span>')
    expect(button(html, 'Save')).not.toContain('disabled=""')
    expect(button(html, 'Discard changes')).not.toContain('disabled=""')
  })

  it('counts the problems that block saving', () => {
    const one = render(setNumberText(initialConfigForm(defaultConfig()), 'pricing.targetHourlyRate', 'abc'))
    expect(one).toContain('text-danger">Unsaved changes: 1 problem to fix before saving</span>')
    expect(button(one, 'Save')).toContain('disabled=""')

    const two = render(setText(setNumberText(initialConfigForm(defaultConfig()), 'roi.horizonYears', '0'), 'agency.email', 'alex@'))
    expect(two).toContain('Unsaved changes: 2 problems to fix before saving')
  })

  it('blocks saving twice and reports a save that failed', () => {
    const state = setNumberText(initialConfigForm(defaultConfig()), 'pricing.targetHourlyRate', '70')
    const saving = render(state, { saving: true })
    expect(saving).toContain('>Saving…</span>')
    expect(button(saving, 'Save')).toContain('disabled=""')
    expect(render(state, { saveError: 'the database is closed' })).toContain('The Config was not saved: the database is closed')
  })
})

describe('SettingsScreen', () => {
  it('shows every section, the folder panel and the store panel', () => {
    const html = render(initialConfigForm(defaultConfig()))
    for (const heading of ['Agency', 'Currency', 'Pricing', 'Estimation', 'Scoring', 'ROI', 'Run costs', 'Storage', 'AI', 'Folder', 'Store']) {
      expect(html, heading).toContain(`>${heading}</h2>`)
    }
    expect(html).not.toContain('Other problems')
  })

  it('lists an issue with no field of its own at the top', () => {
    const draft = defaultConfig()
    // A rate missing altogether has no field to show its issue at; only import could bring this in.
    const { GBP: _missing, ...rates } = draft.fxRates.rates
    const broken = { ...draft, fxRates: { ...draft.fxRates, rates: rates as Config['fxRates']['rates'] } }
    const html = render({ saved: defaultConfig(), draft: broken, texts: {} })
    expect(html).toContain('>Other problems</h2>')
    expect(html).toContain('<span class="num">fxRates.rates.GBP</span>: ')
    expect(button(html, 'Save')).toContain('disabled=""')
  })

  it('shows why an unusable stored Config did not load, and offers to start from defaults without writing', () => {
    const problem: StoreProblem = {
      table: 'config',
      key: 'config',
      message: 'The stored Config does not validate. It is unavailable until a Config is saved, imported or restored; the stored record is unchanged.',
      issues: [{ code: 'invalid_type', expected: 'number', path: ['pricing', 'targetHourlyRate'], message: 'Invalid input: expected number, received string', input: 'x' }],
    }
    const html = render(initialConfigForm(null), { configProblems: [problem] })
    expect(html).toContain('The stored Config is unusable')
    expect(html).toContain('The stored Config does not validate.')
    expect(html).toContain('<span class="num">pricing.targetHourlyRate</span>')
    expect(html).toContain('>Start from defaults</button>')
    expect(html).toContain('Nothing is written until Save.')
    expect(html).not.toContain('data-config-path')
    expect(button(html, 'Save')).toContain('disabled=""')

    const seeded = render({ saved: null, draft: defaultConfig(), texts: {} }, { configProblems: [problem] })
    expect(seeded).not.toContain('Start from defaults')
    expect(seeded).toContain('data-config-path="pricing.targetHourlyRate"')
    expect(button(seeded, 'Save')).not.toContain('disabled=""')
  })
})
