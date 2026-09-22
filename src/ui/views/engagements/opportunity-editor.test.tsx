import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { leafPaths } from '../../../hooks/form-paths'
import {
  addIntegration,
  addProcess,
  engagementFormView,
  initialEngagementForm,
  locatedPaths,
  NOT_EDITED,
  setChoice,
  setNumberText,
  setText,
  toggleProcessLink,
  type EngagementFormState,
} from '../../../hooks/use-engagement-form'
import { businessProcess, engagement } from '../../../schema/__fixtures__/records'
import { describedBy, escapeHtml, renderedPaths, tagFor } from '../../__fixtures__/markup'
import { OpportunityEditor, type PatternChoice } from './opportunity-editor'

const ignore = () => undefined
const PATTERNS: PatternChoice[] = [
  { id: 'pat-email-triage', name: 'Email triage' },
  { id: 'pat-crm-sync', name: 'CRM sync' },
  { id: 'pat-invoices', name: 'Invoice processing' },
]

function render(state: EngagementFormState, patch: { id?: string; patterns?: PatternChoice[] | null } = {}): string {
  return renderToStaticMarkup(
    <OpportunityEditor form={engagementFormView(state, ignore)} opportunityId={patch.id ?? 'opp-1'} patterns={patch.patterns === undefined ? PATTERNS : patch.patterns} />,
  )
}

// An opportunity with none of its optional fields, so every control offered for an absent value is shown.
function bareState(): EngagementFormState {
  const record = engagement()
  const [held] = record.opportunities
  if (held === undefined) throw new Error('the fixture has no opportunity')
  const bare = {
    ...held,
    patternIds: [],
    primaryPatternId: null,
    effortInputs: { ...held.effortInputs, integrations: [{ name: 'HubSpot', hasPublicApi: true, authAvailable: true }] },
  }
  return initialEngagementForm({ ...record, opportunities: [bare] })
}

describe('OpportunityEditor, every field', () => {
  it('gives every leaf of a full opportunity a control, except the id and what one control holds', () => {
    const state = initialEngagementForm(engagement())
    const html = render(state)
    const located = locatedPaths(state.draft)
    const oneControl = (path: string) =>
      /\.(value|unit|currency|source|note|capturedAt|answerId)$/.test(path) || /\.(processIds|patternIds)\.\d+$/.test(path)
    const notEdited = (path: string) => oneControl(path) || NOT_EDITED.some(({ prefix }) => new RegExp(`^${prefix.replace(/\./g, '\\.').replaceAll('*', '\\d+')}(\\.|$)`).test(path))
    for (const path of leafPaths(state.draft).filter((leaf) => leaf.startsWith('opportunities.0.'))) {
      if (notEdited(path)) continue
      expect(located.has(path), path).toBe(true)
      // The linked processes and patterns are ticked in groups that carry their list's path.
      expect(tagFor(html, path), path).toMatch(/^<(input|select|textarea|div) /)
    }
  })

  it('offers a control for each optional field the opportunity does not have yet', () => {
    const html = render(bareState())
    expect(tagFor(html, 'opportunities.0.primaryPatternId')).toMatch(/^<select /)
    expect(tagFor(html, 'opportunities.0.effortInputs.integrations.0.notes')).toMatch(/^<input /)
    expect(tagFor(html, 'opportunities.0.patternIds')).toMatch(/^<div /)
  })

  it('shows exactly the paths the form model places issues at for one opportunity', () => {
    const state = initialEngagementForm(engagement())
    const addressed = [...locatedPaths(state.draft)].filter((path) => path.startsWith('opportunities.') && !path.startsWith('opportunities.0.id'))
    expect([...renderedPaths(render(state))].sort()).toEqual(addressed.sort())
  })
})

describe('OpportunityEditor, what it says', () => {
  it('heads the opportunity with its title and links back to the list', () => {
    const html = render(initialEngagementForm(engagement()))
    expect(html).toContain('Automatic quote intake')
    expect(html).toContain('href="#/engagements/eng-1/opportunities"')
  })

  it('lists the engagement processes with the linked ones ticked, and shows a process it no longer has', () => {
    const state = addProcess(initialEngagementForm(engagement()), { ...businessProcess(), id: 'proc-2', name: 'Invoice chasing' })
    const html = render(state)
    expect(html).toMatch(/<input type="checkbox" checked=""\/>Quote request to CRM entry/)
    expect(html).toMatch(/<input type="checkbox"\/>Invoice chasing/)

    const record = engagement()
    const [held] = record.opportunities
    if (held === undefined) throw new Error('the fixture has no opportunity')
    const stale = initialEngagementForm({ ...record, opportunities: [{ ...held, processIds: ['proc-1', 'proc-gone'] }] })
    expect(render(stale)).toContain('missing: proc-gone')
    expect(describedBy(render(stale), 'opportunities.0.processIds')).toContain(escapeHtml("No process in this engagement has the id 'proc-gone'"))
  })

  it('says why the pattern list is empty, and names a stored pattern the Library does not hold', () => {
    expect(render(initialEngagementForm(engagement()), { patterns: [] })).toContain('The Library has no patterns yet; they arrive with the pattern library (Stage 2, task 9).')
    expect(render(initialEngagementForm(engagement()), { patterns: null })).toContain('The stored Library is unusable, so patterns cannot be listed.')
    const html = render(initialEngagementForm(engagement()), { patterns: [{ id: 'pat-crm-sync', name: 'CRM sync' }] })
    expect(html).toContain('missing: pat-email-triage')
    expect(html).toMatch(/<input type="checkbox" checked=""\/>CRM sync/)
  })

  it('offers only the linked patterns as the primary one, by name, and shows a stored primary that is not linked', () => {
    const html = render(initialEngagementForm(engagement()))
    const select = html.slice(html.indexOf(tagFor(html, 'opportunities.0.primaryPatternId')), html.indexOf('</select>', html.indexOf(tagFor(html, 'opportunities.0.primaryPatternId'))))
    expect([...select.matchAll(/<option value="([^"]*)"/g)].map((match) => match[1])).toEqual(['', 'pat-email-triage', 'pat-crm-sync'])
    expect(select).toContain('<option value="pat-email-triage" selected="">Email triage</option>')
    expect(select).not.toContain('pat-invoices')
  })

  it('records both shares in percent, marked required, with the values as raw editable text', () => {
    const html = render(initialEngagementForm(engagement()))
    expect(html).toContain('>percent</span>')
    for (const path of ['automatablePercent', 'errorReductionPercent']) {
      expect(tagFor(html, `opportunities.0.${path}`), path).toContain('aria-required="true"')
    }
    expect(tagFor(html, 'opportunities.0.automatablePercent')).toContain('value="70"')
    expect(tagFor(html, 'opportunities.0.errorReductionPercent')).toContain('value="80"')
    // A default-sourced figure is shown as one, never hidden.
    expect(html).toContain('<option value="default" selected="">default</option>')
  })

  it('offers each effort factor with its stored choice selected, and the human-in-the-loop flag', () => {
    const html = render(initialEngagementForm(engagement()))
    expect(html).toContain('<option value="semi-structured" selected="">semi-structured</option>')
    expect(html).toContain('<option value="medium" selected="">medium</option>')
    expect(html).toContain('<option value="known-pattern" selected="">known-pattern</option>')
    expect(tagFor(html, 'opportunities.0.effortInputs.requiresHumanInLoop')).toContain('type="checkbox"')
    expect(tagFor(html, 'opportunities.0.effortInputs.approvalSteps')).toContain('value="1"')
  })

  it('says so, with a way back, when the address names an opportunity this engagement does not have', () => {
    const html = render(initialEngagementForm(engagement()), { id: 'opp-gone' })
    expect(html).toContain('This engagement has no opportunity <span class="num">opp-gone</span>.')
    expect(html).toContain('href="#/engagements/eng-1/opportunities"')
  })
})

describe('OpportunityEditor, issues', () => {
  it('writes each rule at the control that fixes it', () => {
    const titled = render(setText(initialEngagementForm(engagement()), 'opportunities.0.title', ' '))
    expect(describedBy(titled, 'opportunities.0.title')).toContain(`<li>${escapeHtml('An opportunity needs a title')}</li>`)

    const unnamed = render(addIntegration(initialEngagementForm(engagement()), 0))
    expect(describedBy(unnamed, 'opportunities.0.effortInputs.integrations.1.name')).toContain(`<li>${escapeHtml('An integration needs a name')}</li>`)
  })

  it('writes a fractional approval count at its field, where it is fixed', () => {
    // A field that fails its own type check stops the rules that read the whole opportunity from running,
    // so this is checked alone: the schema reports one problem at a time here, and it is this one.
    const html = render(setNumberText(initialEngagementForm(engagement()), 'opportunities.0.effortInputs.approvalSteps', '1.5'))
    expect(describedBy(html, 'opportunities.0.effortInputs.approvalSteps')).toContain('<li>')
  })

  it('writes the primary-pattern rule at the primary select, and an unlinked process at the processes', () => {
    let state = setChoice(initialEngagementForm(engagement()), 'opportunities.0.primaryPatternId', 'pat-invoices')
    let html = render(state)
    expect(describedBy(html, 'opportunities.0.primaryPatternId')).toContain(escapeHtml("The primary pattern 'pat-invoices' is not one of the linked patterns"))
    expect(html).toContain('<option value="pat-invoices" selected="">Invoice processing</option>')

    state = toggleProcessLink(initialEngagementForm(engagement()), 0, 'proc-1', false)
    html = render(state)
    expect(describedBy(html, 'opportunities.0.processIds')).toContain(escapeHtml('An opportunity is about at least one process'))
  })

  it('writes a repeated compliance flag at the entry', () => {
    const record = engagement()
    const [held] = record.opportunities
    if (held === undefined) throw new Error('the fixture has no opportunity')
    const state = initialEngagementForm({ ...record, opportunities: [{ ...held, effortInputs: { ...held.effortInputs, complianceFlags: ['GDPR', 'GDPR'] } }] })
    expect(describedBy(render(state), 'opportunities.0.effortInputs.complianceFlags.1')).toContain(escapeHtml("The compliance flag 'GDPR' is already listed"))
  })
})
