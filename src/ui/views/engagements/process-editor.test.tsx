import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { leafPaths } from '../../../hooks/form-paths'
import {
  addStep,
  engagementFormView,
  initialEngagementForm,
  locatedPaths,
  NOT_EDITED,
  setNumberText,
  setText,
  toggleProcessLink,
  type EngagementFormState,
} from '../../../hooks/use-engagement-form'
import { businessProcess, engagement } from '../../../schema/__fixtures__/records'
import { describedBy, escapeHtml, renderedPaths, tagFor } from '../../__fixtures__/markup'
import { ProcessEditor } from './process-editor'

const ignore = () => undefined

function render(state: EngagementFormState, processId = 'proc-1'): string {
  return renderToStaticMarkup(<ProcessEditor form={engagementFormView(state, ignore)} processId={processId} />)
}

// A process with none of its optional fields, so every control the editor offers for an absent value is shown.
function bareState(): EngagementFormState {
  const record = engagement()
  const { owner: _owner, ...rest } = businessProcess()
  const bare = {
    ...rest,
    errorProfile: { errorRatePercent: null, costPerError: null },
    steps: [{ id: 'step-1', action: 'Retype the quote', isManual: true, isBottleneck: false }],
  }
  return initialEngagementForm({ ...record, processes: [bare] })
}

describe('ProcessEditor, every field', () => {
  it('gives every leaf of a full process a control, except the ids and the traced figures held in one control each', () => {
    const state = initialEngagementForm(engagement())
    const html = render(state)
    const located = locatedPaths(state.draft)
    const notEdited = (path: string) =>
      /\.(value|unit|currency|source|note|capturedAt|answerId)$/.test(path) ||
      NOT_EDITED.some(({ prefix }) => new RegExp(`^${prefix.replace(/\./g, '\\.').replaceAll('*', '\\d+')}(\\.|$)`).test(path))
    for (const path of leafPaths(state.draft).filter((leaf) => leaf.startsWith('processes.0.'))) {
      if (notEdited(path)) continue
      expect(located.has(path), path).toBe(true)
      expect(tagFor(html, path), path).toMatch(/^<(input|select|textarea) /)
    }
  })

  it('offers a control for each optional field the process does not have yet', () => {
    const html = render(bareState())
    for (const path of [
      'processes.0.owner',
      'processes.0.errorProfile.errorDescription',
      'processes.0.roleHourlyCost',
      'processes.0.errorProfile.errorRatePercent',
      'processes.0.errorProfile.costPerError',
      'processes.0.steps.0.system',
      'processes.0.steps.0.waitTimeMinutes',
    ]) {
      expect(tagFor(html, path), path).toMatch(/^<(input|select|textarea) /)
    }
  })

  it('shows exactly the paths the form model places issues at for one process, between the editor and its lists', () => {
    const state = initialEngagementForm(engagement())
    const addressed = [...locatedPaths(state.draft)].filter((path) => path.startsWith('processes.') && !path.startsWith('processes.0.id'))
    expect([...renderedPaths(render(state))].sort()).toEqual(addressed.sort())
  })
})

describe('ProcessEditor, what it says', () => {
  it('heads the process with its name and how many opportunities are about it', () => {
    const html = render(initialEngagementForm(engagement()))
    expect(html).toContain('Quote request to CRM entry')
    expect(html).toContain('1 opportunity is about it')
    expect(html).toContain('href="#/engagements/eng-1/processes"')
    const unused = toggleProcessLink(initialEngagementForm(engagement()), 0, 'proc-1', false)
    expect(render(unused)).toContain('No opportunity is about it yet')
  })

  it('records every figure in the unit its field fixes, and marks the three that are required', () => {
    const html = render(initialEngagementForm(engagement()))
    expect(html).toContain('>count/month</span>')
    expect(html).toContain('>minutes</span>')
    expect(html).toContain('>count</span>')
    expect(html).toContain('>percent</span>')
    // Money starts in the company's currency, per hour for a labour cost.
    expect(html).toContain('aria-label="Role hourly cost currency"')
    expect(html).toContain('>/hour</span>')
    for (const path of ['frequency.occurrencesPerMonth', 'frequency.minutesPerOccurrence', 'frequency.peopleInvolved']) {
      expect(tagFor(html, `processes.0.${path}`), path).toContain('aria-required="true"')
    }
    for (const path of ['roleHourlyCost', 'errorProfile.errorRatePercent', 'errorProfile.costPerError']) {
      expect(tagFor(html, `processes.0.${path}`), path).toContain('aria-required="false"')
    }
  })

  it('shows a stored figure as raw editable text with the source it was given, never rounded display', () => {
    const html = render(initialEngagementForm(engagement()))
    expect(tagFor(html, 'processes.0.frequency.occurrencesPerMonth')).toContain('value="120"')
    expect(html).toContain('<option value="client-stated" selected="">client-stated</option>')
  })

  it('lists the steps in order, with a way to move and remove each and to flag it', () => {
    const state = addStep(initialEngagementForm(engagement()), 0, 'step-2')
    const html = render(state)
    expect(html).toContain('aria-label="Move step 2 up"')
    expect(html).toContain('aria-label="Remove step 2"')
    expect(tagFor(html, 'processes.0.steps.0.isBottleneck')).toContain('type="checkbox"')
    expect(tagFor(html, 'processes.0.steps.0.isBottleneck')).toContain('checked=""')
    // The first step cannot move up, and the last cannot move down.
    const label = escapeHtml("Move 'Copy quote request from email into CRM' up")
    expect(html).toContain(`disabled="" aria-label="${label}"`)
  })

  it('says so, with a way back, when the address names a process this engagement does not have', () => {
    const html = render(initialEngagementForm(engagement()), 'proc-gone')
    expect(html).toContain('This engagement has no process <span class="num">proc-gone</span>.')
    expect(html).toContain('href="#/engagements/eng-1/processes"')
  })
})

describe('ProcessEditor, issues', () => {
  it('writes each rule at the control that fixes it', () => {
    let state = setText(initialEngagementForm(engagement()), 'processes.0.name', ' ')
    state = setText(state, 'processes.0.steps.0.action', '')
    state = setText(state, 'processes.0.steps.0.system', ' ')
    state = setNumberText(state, 'processes.0.steps.0.waitTimeMinutes', '-5')
    const html = render(state)
    expect(describedBy(html, 'processes.0.name')).toContain(`<li>${escapeHtml('A process needs a name')}</li>`)
    expect(describedBy(html, 'processes.0.steps.0.action')).toContain(`<li>${escapeHtml('A step needs an action')}</li>`)
    expect(describedBy(html, 'processes.0.steps.0.system')).toContain(`<li>${escapeHtml('A step either names a system or has none')}</li>`)
    expect(describedBy(html, 'processes.0.steps.0.waitTimeMinutes')).toContain(`<li>${escapeHtml('A wait cannot be negative')}</li>`)
  })

  it('writes a repeated system and a blank pain point at the entry', () => {
    const record = engagement()
    const [process] = record.processes
    if (process === undefined) throw new Error('the fixture has no process')
    const state = initialEngagementForm({ ...record, processes: [{ ...process, systemsTouched: ['Gmail', 'Gmail'], painPoints: ['Retyping', ' '] }] })
    const html = render(state)
    expect(describedBy(html, 'processes.0.systemsTouched.1')).toContain(escapeHtml("The system 'Gmail' is already listed"))
    expect(describedBy(html, 'processes.0.painPoints.1')).toContain(escapeHtml('A pain point cannot be blank'))
  })
})
