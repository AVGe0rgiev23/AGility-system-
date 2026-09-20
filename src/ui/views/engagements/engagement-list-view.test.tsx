import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { initialNewEngagement, NO_FILTER, SOURCE_REQUIRED } from '../../../hooks/use-engagement-list'
import { newEngagement } from '../../../schema/__fixtures__/records'
import type { Engagement } from '../../../schema/engagement'
import { DEFAULT_LIST_PREFS, EngagementListScreen, type EngagementListPrefs } from './engagement-list-view'
import { NewEngagementForm } from './new-engagement-panel'

const TODAY = '2026-09-17'
const ignore = () => undefined

function record(id: string, name: string, patch: Partial<Engagement> = {}): Engagement {
  return { ...newEngagement(), id, company: { ...newEngagement().company, name }, ...patch }
}

const engagements: Engagement[] = [
  record('e-acme', 'Acme', { stage: 'PROPOSAL', updatedAt: '2026-09-10T09:00:00.000Z', tags: ['bg'], nextAction: { text: 'Chase', due: '2026-09-15' } }),
  record('e-rila', 'Rila Logistics', { stage: 'LEAD', updatedAt: '2026-09-16T09:00:00.000Z', tags: ['logistics'], nextAction: { text: 'Call', due: '2026-10-01' } }),
  record('e-solo', 'Solo Bakery', { stage: 'DISCOVERY', updatedAt: '2026-09-12T09:00:00.000Z', nextAction: null }),
]

function render(prefs: EngagementListPrefs = DEFAULT_LIST_PREFS, list: readonly Engagement[] = engagements, panel: ReactNode = null): string {
  return renderToStaticMarkup(<EngagementListScreen engagements={list} prefs={prefs} today={TODAY} onPrefs={ignore} onNew={ignore} panel={panel} />)
}

function order(html: string, names: readonly string[]): number[] {
  return names.map((name) => html.indexOf(`>${name}</a>`))
}

function ascending(positions: readonly number[]): boolean {
  return positions.every((position, index) => position >= 0 && (index === 0 || position > (positions[index - 1] ?? -1)))
}

describe('EngagementListScreen', () => {
  it('lists every engagement, newest update first, each company linking to its detail', () => {
    const html = render()
    expect(ascending(order(html, ['Rila Logistics', 'Solo Bakery', 'Acme']))).toBe(true)
    expect(html).toContain('<a href="#/engagements/e-rila"')
    expect(html).toContain('<th scope="col" aria-sort="descending"')
    expect(html).toContain('<span class="num">3</span> in total')
  })

  it('sorts stages in pipeline order, not alphabetically', () => {
    const html = render({ ...DEFAULT_LIST_PREFS, sort: { columnId: 'stage', direction: 'ascending' } })
    expect(ascending(order(html, ['Rila Logistics', 'Solo Bakery', 'Acme']))).toBe(true)
  })

  it('puts engagements with no due date last', () => {
    const html = render({ ...DEFAULT_LIST_PREFS, sort: { columnId: 'due', direction: 'descending' } })
    expect(ascending(order(html, ['Rila Logistics', 'Acme', 'Solo Bakery']))).toBe(true)
  })

  it('applies the filters and says how many of the total are shown', () => {
    const html = render({ ...DEFAULT_LIST_PREFS, filter: { ...NO_FILTER, nextAction: 'due' } })
    expect(html).toContain('>Acme</a>')
    expect(html).not.toContain('>Rila Logistics</a>')
    expect(html).toContain('showing <span class="num">1</span> of <span class="num">3</span>')
    expect(html).toContain('>Clear filters</button>')
    expect(render()).not.toContain('Clear filters')
  })

  it('offers each stage and each tag in use as a filter', () => {
    const html = render()
    expect(html).toContain('<option value="DECLINED">DECLINED</option>')
    expect(html).toContain('<option value="bg">bg</option>')
    expect(html).toContain('<option value="logistics">logistics</option>')
    expect(html).toContain('<option value="due">due today or earlier</option>')
  })

  it('names each filter by its label alone', () => {
    const html = render()
    for (const label of ['Stage', 'Tag', 'Next action']) {
      const id = new RegExp(`<label for="([^"]+)">${label}</label>`).exec(html)?.[1]
      expect(id, label).toBeDefined()
      expect(html, label).toContain(`<select id="${id ?? ''}"`)
    }
  })

  it('marks a due date of today or earlier in the warn colour', () => {
    const html = render()
    expect(html).toContain('<span class="num text-warn" title="Due today or earlier">2026-09-15</span>')
    expect(html).toContain('<span class="num ">2026-10-01</span>')
  })

  it('says why the table is empty', () => {
    expect(render(DEFAULT_LIST_PREFS, [])).toContain('No engagements yet. Create one with New engagement.')
    expect(render({ ...DEFAULT_LIST_PREFS, filter: { ...NO_FILTER, stage: 'WON' } })).toContain('No engagements match these filters.')
  })

  it('disables New engagement while the panel is open', () => {
    expect(render()).toMatch(/<button type="button" class="[^"]*">New engagement<\/button>/)
    expect(render(DEFAULT_LIST_PREFS, engagements, <p>panel</p>)).toMatch(/<button type="button" class="[^"]*" disabled="">New engagement<\/button>/)
  })
})

describe('NewEngagementForm', () => {
  function form(patch: Partial<Parameters<typeof NewEngagementForm>[0]> = {}): string {
    return renderToStaticMarkup(
      <NewEngagementForm
        draft={initialNewEngagement()}
        industries={['Professional Services', 'E-commerce']}
        issues={[]}
        message={null}
        creating={false}
        onDraft={ignore}
        onCreate={ignore}
        onCancel={ignore}
        {...patch}
      />,
    )
  }

  it('asks for the company, industry, currency, source and stage, with EUR and LEAD chosen and no source', () => {
    const html = form()
    for (const path of ['company.name', 'company.industry', 'company.currency', 'source', 'stage']) {
      expect(html, path).toContain(`data-config-path="${path}"`)
    }
    expect(html).toContain('<option value="EUR" selected="">EUR</option>')
    expect(html).toContain('<option value="LEAD" selected="">LEAD</option>')
    expect(html).toContain('<option value="" disabled="" selected="">where it came from</option>')
    expect(html).toContain('<option value="E-commerce">E-commerce</option>')
    expect(html).not.toContain('role="alert"')
  })

  it('does not mark the industry required, since the schema accepts none', () => {
    const html = form()
    const industry = /<select[^>]*data-config-path="company.industry"[^>]*>/.exec(html)?.[0] ?? ''
    expect(industry).toContain('aria-required="false"')
    expect(html).toContain('>Industry</label>')
    expect(html).toContain('<option value="" selected="">choose an industry</option>')
  })

  it('takes the industry as text when the stored Config is unusable', () => {
    expect(form({ industries: null })).toMatch(/<input[^>]*data-config-path="company.industry"/)
  })

  it('shows each issue under its field, and a failed save above the buttons', () => {
    const html = form({
      issues: [
        { path: 'source', message: SOURCE_REQUIRED },
        { path: 'company.name', message: 'The company needs a name' },
      ],
      message: 'The engagement was not created: fix the fields marked below.',
    })
    expect(html).toContain(`<li>${SOURCE_REQUIRED}</li>`)
    expect(html).toContain('<li>The company needs a name</li>')
    expect(html).toContain('The engagement was not created')
    expect(html).toMatch(/<input[^>]*data-config-path="company.name"[^>]*aria-invalid="true"/)
  })

  it('disables its buttons while creating', () => {
    const html = form({ creating: true })
    expect(html).toContain('disabled="">Creating…</button>')
    expect(html).toContain('disabled="">Cancel</button>')
  })
})
