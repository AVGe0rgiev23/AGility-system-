import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { leafPaths } from '../../../hooks/form-paths'
import {
  engagementFormView,
  initialEngagementForm,
  locatedPaths,
  setChoice,
  setFlag,
  setNumberText,
  setText,
  tabOf,
  type EngagementFormState,
} from '../../../hooks/use-engagement-form'
import { NOT_A_NUMBER } from '../../../hooks/use-traced-draft'
import { engagement, newEngagement } from '../../../schema/__fixtures__/records'
import { describedBy, escapeHtml, renderedPaths, tagFor } from '../../__fixtures__/markup'
import { EngagementScreen } from './engagement-view'

const ignore = () => undefined

function render(state: EngagementFormState, industries: readonly string[] | null = ['Professional Services', 'logistics']): string {
  return renderToStaticMarkup(
    <EngagementScreen
      form={engagementFormView(state, ignore)}
      tab="company"
      saving={false}
      saveError={null}
      onSave={ignore}
      deletion={{ confirming: false, deleting: false, error: null, onAsk: ignore, onConfirm: ignore, onCancel: ignore }}
      item={null}
      questionSets={[]}
      patterns={[]}
      config={null}
      now="2026-09-24T12:00:00.000Z"
      industries={industries}
    />,
  )
}

describe('CompanyTab, every field', () => {
  it('renders exactly the company paths the form model places issues at', () => {
    const state = initialEngagementForm(engagement())
    const company = [...locatedPaths(state.draft)].filter((path) => tabOf(path) === 'company').sort()
    expect([...renderedPaths(render(state))].sort()).toEqual(company)
  })

  it('gives every company leaf a control, except the traced cost inside its one control', () => {
    const state = initialEngagementForm(engagement())
    const html = render(state)
    const located = locatedPaths(state.draft)
    for (const path of leafPaths(state.draft).filter((leaf) => leaf.startsWith('company.'))) {
      if (path.startsWith('company.blendedHourlyCost.')) continue
      expect(located.has(path), path).toBe(true)
      // A detected tool is written by signal extraction: its confirmation is a checkbox, and the rest is
      // shown in outputs that carry their path so a rule about them is written on the row.
      const detected = path.startsWith('company.detectedStack.')
      expect(tagFor(html, path), path).toMatch(detected && !path.endsWith('.confirmed') ? /^<output / : /^<(input|select) /)
    }
    expect(tagFor(html, 'company.blendedHourlyCost')).toMatch(/^<input /)
    expect(describedBy(html, 'company.detectedStack')).toContain('A suggestion counts once it is confirmed, and only a confirmed tool reaches a document.')
  })

  it('offers controls for optional fields the company does not have yet', () => {
    const html = render(initialEngagementForm(newEngagement()))
    for (const path of ['company.website', 'company.employeeCount', 'company.locationCountry', 'company.sourceOfTruth', 'company.constraints.dataResidency', 'company.constraints.securityNotes']) {
      expect(tagFor(html, path), path).toContain('value=""')
    }
    expect(html).toContain('<option value="" selected="">not set</option>')
    expect(html).toContain('No stated tools')
    expect(html).toContain('Nothing detected yet')
  })
})

describe('CompanyTab, detected stack', () => {
  const doubled = () => {
    const record = engagement()
    const [held] = record.company.detectedStack
    if (held === undefined) throw new Error('the fixture has no detected tool')
    return initialEngagementForm({ ...record, company: { ...record.company, detectedStack: [held, { ...held, confirmed: true }] } })
  }

  it('lists each suggestion with its category, confidence and the text that proved it', () => {
    const html = render(initialEngagementForm(engagement()))
    expect(tagFor(html, 'company.detectedStack.0.name')).toMatch(/^<output /)
    expect(html).toContain('>HubSpot</output>')
    expect(html).toContain('>crm</output>')
    expect(html).toContain('>high</output>')
    expect(html).toContain('>js.hs-scripts.com/1234567.js</output>')
  })

  it('shows a suggestion as unconfirmed until it is ticked, and offers to remove it', () => {
    const html = render(initialEngagementForm(engagement()))
    expect(tagFor(html, 'company.detectedStack.0.confirmed')).toContain('type="checkbox"')
    expect(tagFor(html, 'company.detectedStack.0.confirmed')).not.toContain('checked=""')
    expect(html).toContain(`aria-label="${escapeHtml("Remove 'HubSpot'")}"`)
    const confirmed = setFlag(initialEngagementForm(engagement()), 'company.detectedStack.0.confirmed', true)
    expect(tagFor(render(confirmed), 'company.detectedStack.0.confirmed')).toContain('checked=""')
  })

  it('writes a rule about a tool on its own row, where removing it fixes it', () => {
    const html = render(doubled())
    expect(describedBy(html, 'company.detectedStack.1.name')).toContain(escapeHtml("The tool 'HubSpot' is already detected"))
  })

  it('offers the paste box beside it, and says nothing is fetched or sent', () => {
    const html = render(initialEngagementForm(engagement()))
    expect(html).toContain('Find signals')
    expect(html).toContain('Nothing is fetched or sent anywhere')
  })
})

describe('CompanyTab, fields', () => {
  it('shows the stored values, with the traced cost in its own currency and source', () => {
    const html = render(initialEngagementForm(engagement()))
    expect(tagFor(html, 'company.name')).toContain('value="Rila Logistics"')
    expect(tagFor(html, 'company.employeeCount')).toContain('value="40"')
    expect(html).toContain('<option value="logistics" selected="">logistics</option>')
    expect(html).toContain('<option value="hybrid" selected="">hybrid</option>')
    expect(html).toMatch(/aria-label="Blended hourly cost source"/)
    expect(tagFor(html, 'company.statedTools.1')).toContain('value="HubSpot"')
    expect(tagFor(html, 'company.statedTools.0')).toContain('value="Google Sheets"')
  })

  it('keeps an industry that is not in Settings selectable, and takes it as text when the Config is unusable', () => {
    const state = setText(initialEngagementForm(engagement()), 'company.industry', 'Shipping')
    expect(render(state)).toContain('<option value="Shipping" selected="">Shipping</option>')
    expect(tagFor(render(state, null), 'company.industry')).toMatch(/^<input [^>]*value="Shipping"/)
  })
})

describe('CompanyTab, issue placement', () => {
  it('writes each company rule under its own field', () => {
    let state = setText(initialEngagementForm(engagement()), 'company.name', '')
    state = setText(state, 'company.website', 'rila.bg')
    state = setNumberText(state, 'company.employeeCount', '2.5')
    const html = render(state)
    expect(describedBy(html, 'company.name')).toContain('<li>The company needs a name</li>')
    expect(describedBy(html, 'company.website')).toContain(`<li>${escapeHtml("'rila.bg' is not a valid http:// or https:// URL")}</li>`)
    expect(describedBy(html, 'company.employeeCount')).toContain('<li>The employee count must be a whole number, at least 0</li>')
    expect(tagFor(html, 'company.name')).toContain('aria-invalid="true"')
  })

  it('writes typed text that does not parse under the employee count, and an option outside the schema under its choice', () => {
    let state = setNumberText(initialEngagementForm(engagement()), 'company.employeeCount', 'forty')
    state = setChoice(state, 'company.currency', 'JPY')
    const html = render(state)
    expect(describedBy(html, 'company.employeeCount')).toContain(`<li>${escapeHtml(NOT_A_NUMBER)}</li>`)
    expect(tagFor(html, 'company.employeeCount')).toContain('value="forty"')
    expect(describedBy(html, 'company.currency')).toContain('<li>')
  })
})
