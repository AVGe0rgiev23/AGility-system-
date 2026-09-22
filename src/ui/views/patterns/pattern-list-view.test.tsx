import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { engagement, library, newEngagement, opportunity } from '../../../schema/__fixtures__/records'
import type { Engagement } from '../../../schema/engagement'
import type { Library } from '../../../schema/library'
import { seedPatterns } from '../../../schema/seed-patterns'
import type { StoreProblem } from '../../../storage/repository'
import { NewPatternForm, PatternListScreen, type Deletion, type NewPatternDraft } from './pattern-list-view'

const ignore = () => undefined
const NO_DELETION: Deletion = { id: null, deleting: false, error: null, onAsk: ignore, onConfirm: ignore, onCancel: ignore }

function render(
  patch: { library?: Library | null; engagements?: Engagement[]; missingSeeds?: number; deletion?: Deletion; actionError?: string | null; libraryProblems?: StoreProblem[]; panel?: React.ReactNode } = {},
): string {
  return renderToStaticMarkup(
    <PatternListScreen
      library={patch.library === undefined ? { ...library(), patterns: seedPatterns() } : patch.library}
      libraryProblems={patch.libraryProblems ?? []}
      engagements={patch.engagements ?? []}
      missingSeeds={patch.missingSeeds ?? 0}
      addingSeeds={false}
      actionError={patch.actionError ?? null}
      onAddSeeds={ignore}
      onNew={ignore}
      panel={patch.panel ?? null}
      deletion={patch.deletion ?? NO_DELETION}
    />,
  )
}

describe('PatternListScreen', () => {
  it('lists each pattern with its category, complexity, base hours and how many opportunities use it', () => {
    const linked = [{ ...engagement(), opportunities: [{ ...opportunity(), patternIds: ['pat-email-triage'] }] }]
    const html = render({ engagements: linked })
    expect(html).toContain(`href="#/patterns/pat-email-triage"`)
    expect(html).toContain('>Lead enrichment</a>')
    expect(html).toContain('>Email triage</a>')
    expect(html).toContain('<span class="num">8</span> in the Library')
    expect(html).toContain('>sales</span>')
    expect(html).toContain('>low</span>')
    expect(html).toMatch(/<td class="h-7 border-b px-2 num text-right">8<\/td>/)
    expect(html).toMatch(/<td class="h-7 border-b px-2 num text-right">0<\/td>/)
  })

  it('counts opportunities across every engagement, not just the first', () => {
    const linkedTwice = [
      { ...engagement(), opportunities: [{ ...opportunity(), id: 'opp-a', patternIds: ['pat-email-triage'] }] },
      { ...newEngagement(), id: 'eng-2', opportunities: [{ ...opportunity(), id: 'opp-b', patternIds: ['pat-email-triage'] }] },
    ]
    const html = render({ engagements: linkedTwice })
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Delete Email triage"/)
    expect(html).toContain('2 opportunities link this pattern')
  })

  it('refuses to delete a pattern an opportunity links, and asks before deleting one nothing links', () => {
    const linked = [{ ...engagement(), opportunities: [{ ...opportunity(), patternIds: ['pat-email-triage'] }] }]
    const html = render({ engagements: linked })
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Delete Email triage"/)
    expect(html).toContain('1 opportunity links this pattern, so it cannot be deleted')
    const deletable = /<button[^>]*aria-label="Delete Lead enrichment"[^>]*>/.exec(html)?.[0] ?? ''
    expect(deletable).not.toContain('disabled=""')

    const confirming = render({ deletion: { ...NO_DELETION, id: 'pat-lead-enrichment' } })
    expect(confirming).toContain('Delete Lead enrichment? It is removed from the Library.')
    expect(confirming).toContain('>Delete Lead enrichment</button>')
  })

  it('offers the standard patterns only while some are missing, and reports an action that failed', () => {
    expect(render({ missingSeeds: 3 })).toContain('>Add the standard patterns (3)</button>')
    expect(render()).not.toContain('Add the standard patterns')
    expect(render({ actionError: 'The standard patterns were not added: the database is closed' })).toContain('were not added: the database is closed')
  })

  it('says when there are no patterns at all', () => {
    expect(render({ library: { ...library(), patterns: [] } })).toContain('No patterns. Add the standard ones, or create your own.')
  })

  it('edits nothing while the stored Library is unusable', () => {
    const problem: StoreProblem = { table: 'library', key: 'library', message: 'The stored Library does not validate.', issues: [] }
    const html = render({ library: null, libraryProblems: [problem] })
    expect(html).toContain('The stored Library does not validate.')
    expect(html).toContain('Patterns cannot be edited until a Library is saved, imported or restored.')
    expect(html).not.toContain('<table')
    expect(html).not.toContain('New pattern')
  })
})

describe('NewPatternForm', () => {
  const draft: NewPatternDraft = { name: '', baseHoursText: '' }

  it('asks for a name and base hours, and refuses a blank name once creating has been tried', () => {
    const html = renderToStaticMarkup(<NewPatternForm draft={draft} nameIssue="A pattern needs a name" creating={false} onDraft={ignore} onCreate={ignore} onCancel={ignore} />)
    expect(html).toContain('<li>A pattern needs a name</li>')
    expect(html).toContain('>hours</span>')
    expect(html).toContain('>Create pattern</button>')
  })

  it('names base hours as required, with no issue shown until something is typed', () => {
    const html = renderToStaticMarkup(<NewPatternForm draft={draft} nameIssue={null} creating={false} onDraft={ignore} onCreate={ignore} onCancel={ignore} />)
    expect(html).not.toContain('role="alert"')
    expect(html).toMatch(/aria-required="true"/)
  })

  it('shows the not-a-number and non-positive messages once text is typed', () => {
    const invalid = renderToStaticMarkup(<NewPatternForm draft={{ ...draft, baseHoursText: 'twelve' }} nameIssue={null} creating={false} onDraft={ignore} onCreate={ignore} onCancel={ignore} />)
    expect(invalid).toContain('role="alert"')
    const zero = renderToStaticMarkup(<NewPatternForm draft={{ ...draft, baseHoursText: '0' }} nameIssue={null} creating={false} onDraft={ignore} onCreate={ignore} onCancel={ignore} />)
    expect(zero).toContain('Base hours must be greater than 0')
  })
})

