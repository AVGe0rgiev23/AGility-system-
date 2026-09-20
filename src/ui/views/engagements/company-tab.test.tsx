import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { leafPaths } from '../../../hooks/form-paths'
import {
  engagementFormView,
  initialEngagementForm,
  locatedPaths,
  NOT_EDITED,
  setChoice,
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

  it('gives every company leaf a control, except the traced cost inside its one control and the detected stack it shows', () => {
    const state = initialEngagementForm(engagement())
    const html = render(state)
    const located = locatedPaths(state.draft)
    for (const path of leafPaths(state.draft).filter((leaf) => leaf.startsWith('company.'))) {
      if (path.startsWith('company.blendedHourlyCost.')) continue
      if (path.startsWith('company.detectedStack.')) continue
      expect(located.has(path), path).toBe(true)
      expect(tagFor(html, path), path).toMatch(/^<(input|select) /)
    }
    expect(tagFor(html, 'company.blendedHourlyCost')).toMatch(/^<input /)
    const reason = NOT_EDITED.find((entry) => entry.prefix === 'company.detectedStack')?.reason ?? ''
    expect(describedBy(html, 'company.detectedStack')).toContain(escapeHtml(reason))
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
