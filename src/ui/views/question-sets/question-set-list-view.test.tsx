import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { newQuestionSet } from '../../../hooks/question-set-library'
import { engagement, library, newEngagement } from '../../../schema/__fixtures__/records'
import type { Engagement } from '../../../schema/engagement'
import type { Library } from '../../../schema/library'
import { DISCOVERY_SET_ID, seedQuestionSets, TEARDOWN_SET_ID } from '../../../schema/seed-question-sets'
import type { StoreProblem } from '../../../storage/repository'
import { appliesToText, NewQuestionSetForm, QuestionSetListScreen, type Deletion } from './question-set-list-view'

const ignore = () => undefined
const NO_DELETION: Deletion = { id: null, deleting: false, error: null, onAsk: ignore, onConfirm: ignore, onCancel: ignore }

function render(
  patch: { library?: Library | null; engagements?: Engagement[]; missingSeeds?: number; deletion?: Deletion; actionError?: string | null; libraryProblems?: StoreProblem[]; panel?: React.ReactNode } = {},
): string {
  return renderToStaticMarkup(
    <QuestionSetListScreen
      library={patch.library === undefined ? { ...library(), questionSets: seedQuestionSets() } : patch.library}
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

describe('QuestionSetListScreen', () => {
  it('lists each set with its kind, what it applies to, and how many questions and sessions it has', () => {
    const sessions = [{ ...newEngagement(), discovery: [{ ...engagement().discovery[0], questionSetId: TEARDOWN_SET_ID }] } as Engagement]
    const html = render({ engagements: sessions })
    expect(html).toContain(`href="#/question-sets/${TEARDOWN_SET_ID}"`)
    expect(html).toContain('>Teardown</a>')
    expect(html).toContain('>Full discovery</a>')
    expect(html).toContain('<span class="num">2</span> in the Library')
    expect(html).toContain('>every industry</span>')
    expect(html).toContain('<td class="h-7 border-b px-2 num text-right">13</td>')
  })

  it('writes what a set applies to', () => {
    expect(appliesToText(newQuestionSet('a', 'A', 'teardown'))).toBe('every industry')
    expect(appliesToText({ ...newQuestionSet('a', 'A', 'teardown'), appliesTo: { industries: ['E-commerce', 'Retail'], minEmployees: 5 } })).toBe('E-commerce, Retail · 5+ employees')
  })

  it('refuses to delete a set a session uses, and asks before deleting one nothing uses', () => {
    const used = [{ ...newEngagement(), discovery: [{ ...engagement().discovery[0], questionSetId: TEARDOWN_SET_ID }] } as Engagement]
    const html = render({ engagements: used })
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Delete Teardown"/)
    expect(html).toContain('1 session uses this set, so it cannot be deleted')
    const deletable = /<button[^>]*aria-label="Delete Full discovery"[^>]*>/.exec(html)?.[0] ?? ''
    expect(deletable).not.toContain('disabled=""')

    const confirming = render({ deletion: { ...NO_DELETION, id: DISCOVERY_SET_ID } })
    expect(confirming).toContain('Delete Full discovery? It is removed from the Library.')
    expect(confirming).toContain('>Delete Full discovery</button>')
  })

  it('offers the standard sets only while some are missing, and reports an action that failed', () => {
    expect(render({ missingSeeds: 2 })).toContain('>Add the standard question sets (2)</button>')
    expect(render()).not.toContain('Add the standard question sets')
    expect(render({ actionError: 'The standard question sets were not added: the database is closed' })).toContain('were not added: the database is closed')
  })

  it('says when there are no question sets at all', () => {
    expect(render({ library: { ...library(), questionSets: [] } })).toContain('No question sets. Add the standard ones, or create your own.')
  })

  it('edits nothing while the stored Library is unusable', () => {
    const problem: StoreProblem = { table: 'library', key: 'library', message: 'The stored Library does not validate.', issues: [] }
    const html = render({ library: null, libraryProblems: [problem] })
    expect(html).toContain('The stored Library does not validate.')
    expect(html).toContain('Question sets cannot be edited until a Library is saved, imported or restored.')
    expect(html).not.toContain('<table')
    expect(html).not.toContain('New question set')
  })
})

describe('NewQuestionSetForm', () => {
  it('asks for a name and kind, and refuses a blank name once creating has been tried', () => {
    const html = renderToStaticMarkup(
      <NewQuestionSetForm draft={{ name: '', kind: 'teardown' }} issue="A question set needs a name" creating={false} onDraft={ignore} onCreate={ignore} onCancel={ignore} />,
    )
    expect(html).toContain('<li>A question set needs a name</li>')
    expect(html).toContain('<option value="teardown" selected="">teardown</option>')
    expect(html).toContain('>Create question set</button>')
  })
})
