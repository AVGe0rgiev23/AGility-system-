import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { readSignals, type SignalReading } from '../../../hooks/signal-reading'
import { detectedTool, questionSet } from '../../../schema/__fixtures__/records'
import type { QuestionSet } from '../../../schema/discovery'
import { escapeHtml } from '../../__fixtures__/markup'
import type { PatternChoice } from './opportunity-editor'
import { SignalsPanelScreen } from './signals-panel'

const ignore = () => undefined
const SETS: QuestionSet[] = [
  { ...questionSet(), id: 'qs-teardown', name: 'Teardown' },
  { ...questionSet(), id: 'qs-full-discovery', name: 'Full discovery' },
]
const PATTERNS: PatternChoice[] = [{ id: 'pat-document-extraction', name: 'Document extraction' }]

const PAGE = '<script src="//js.hs-scripts.com/1234567.js"></script> Invoices are raised in Xero. Every order is entered manually and we use a spreadsheet.'

function render(patch: { text?: string; reading?: SignalReading | null; questionSets?: QuestionSet[] | null; patterns?: PatternChoice[] | null } = {}): string {
  return renderToStaticMarkup(
    <SignalsPanelScreen
      engagementId="eng-1"
      text={patch.text ?? ''}
      reading={patch.reading === undefined ? null : patch.reading}
      questionSets={patch.questionSets === undefined ? SETS : patch.questionSets}
      patterns={patch.patterns === undefined ? PATTERNS : patch.patterns}
      onText={ignore}
      onFind={ignore}
      onClear={ignore}
    />,
  )
}

describe('SignalsPanelScreen', () => {
  it('says it is matched on this page, that nothing is fetched or sent, and that a tool counts once confirmed', () => {
    const html = render()
    expect(html).toContain('Nothing is fetched or sent anywhere')
    expect(html).toContain('a tool counts only once you confirm it')
    expect(html).toContain('matched on this page')
  })

  it('will not look for signals in an empty box, and has nothing to clear until something is there', () => {
    const empty = render()
    expect(empty).toMatch(/<button[^>]*disabled=""[^>]*>Find signals<\/button>/)
    expect(empty).toMatch(/<button[^>]*disabled=""[^>]*>Clear<\/button>/)
    const typed = render({ text: 'We use HubSpot.' })
    expect(typed).not.toMatch(/<button[^>]*disabled=""[^>]*>Find signals<\/button>/)
    expect(typed).not.toMatch(/<button[^>]*disabled=""[^>]*>Clear<\/button>/)
    expect(typed).toContain('We use HubSpot.')
  })

  it('shows no result until Find signals has been pressed', () => {
    expect(render({ text: 'We use HubSpot.' })).not.toContain('role="status"')
  })

  it('says what it found, how much was added to the stack unconfirmed, and how much was already there', () => {
    const html = render({ text: PAGE, reading: readSignals(PAGE, []) })
    expect(html).toContain('2 tools recognised, 2 added to the stack below unconfirmed. 2 pain signals.')
    const again = render({ text: PAGE, reading: readSignals(PAGE, [{ ...detectedTool(), name: 'HubSpot' }]) })
    expect(again).toContain('2 tools recognised, 1 added to the stack below unconfirmed and 1 already there.')
    const allKnown = render({ text: PAGE, reading: readSignals(PAGE, [{ ...detectedTool(), name: 'HubSpot' }, { ...detectedTool(), name: 'Xero' }]) })
    expect(allKnown).toContain('2 tools recognised, all of them already in the stack.')
  })

  it('says so plainly when the text names nothing', () => {
    expect(render({ text: 'We deliver pallets.', reading: readSignals('We deliver pallets.', []) })).toContain('Nothing recognised in that text.')
  })

  it('shows each pain signal with the words that matched, the sets worth running by name, and a way to the Discovery tab', () => {
    const html = render({ text: PAGE, reading: readSignals(PAGE, []) })
    expect(html).toContain('Work described as done by hand')
    expect(html).toContain('“manually”')
    expect(html).toContain('Worth running: Full discovery, from the')
    expect(html).toContain('href="#/engagements/eng-1/discovery"')
  })

  it('names a candidate pattern the Library holds, and says so when it does not hold one yet', () => {
    const html = render({ text: PAGE, reading: readSignals(PAGE, []) })
    // The spreadsheet pain suggests document extraction, which this Library has, and reporting automation, which it does not.
    expect(html).toContain('Document extraction')
    expect(html).toContain('<span class="num">pat-reporting-automation</span> (not in the Library yet)')
  })

  it('falls back to the id of a question set or pattern it cannot name, and to no patterns when the Library is unusable', () => {
    const html = render({ text: PAGE, reading: readSignals(PAGE, []), questionSets: null, patterns: null })
    expect(html).toContain('Worth running: qs-full-discovery')
    expect(html).toContain('<span class="num">pat-reporting-automation</span> (not in the Library yet)')
  })

  it('writes the matched text as text, never as markup', () => {
    const hostile = 'It is done manually <img src=x onerror=alert(1)>.'
    const html = render({ text: hostile, reading: readSignals(hostile, []) })
    expect(html).not.toContain('<img')
    expect(html).toContain(escapeHtml('manually'))
  })
})
