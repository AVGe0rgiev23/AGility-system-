import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { initialQuestionSetForm, questionSetFormView, setConditionAt, type QuestionSetFormState } from '../../../hooks/use-question-set-form'
import type { Condition, Question, QuestionSet } from '../../../schema/discovery'
import { describedBy, escapeHtml, renderedPaths, tagFor } from '../../__fixtures__/markup'
import { ConditionEditor } from './condition-editor'

const QUESTIONS: Question[] = [
  { id: 'yn', text: 'Has staff?', kind: 'boolean', required: true },
  { id: 'n', text: 'How many?', kind: 'number', unit: 'people', required: false },
  { id: 'c', text: 'How often?', kind: 'choice', choices: ['weekly', 'daily'], required: false },
  { id: 'm', text: 'Which tools?', kind: 'multi', choices: ['HubSpot', 'Xero'], required: false },
  { id: 't', text: 'Describe it', kind: 'text', required: false },
  { id: 'z', text: 'Last', kind: 'text', required: false },
]

function state(showIf?: Condition): QuestionSetFormState {
  const questions = QUESTIONS.map((question) => (question.id === 'z' && showIf !== undefined ? { ...question, showIf } : question))
  const set: QuestionSet = { id: 'qs', name: 'Set', kind: 'discovery', appliesTo: {}, questions }
  return initialQuestionSetForm(set)
}

function render(current: QuestionSetFormState, index = 5): string {
  const form = questionSetFormView(current, () => undefined)
  return renderToStaticMarkup(<ConditionEditor form={form} index={index} questions={current.draft.questions} />)
}

function options(select: string): string[] {
  return [...select.matchAll(/<option value="([^"]*)"/g)].map((match) => match[1] ?? '')
}

function selectAfterLabel(html: string, label: string, occurrence = 0): string {
  const labels = [...html.matchAll(new RegExp(`<label for="([^"]+)" class="sr-only">${label}</label>`, 'g'))]
  const id = labels[occurrence]?.[1]
  if (id === undefined) throw new Error(`no ${label} label`)
  const start = html.indexOf(`<select id="${id}"`)
  return html.slice(start, html.indexOf('</select>', start))
}

describe('ConditionEditor', () => {
  it('offers to add a condition to an always-shown question, and says when there is nothing earlier to depend on', () => {
    expect(render(state())).toContain('>Add condition</button>')
    expect(render(state(), 0)).toContain('always shown; no earlier question to depend on')
    expect(render(state(), 0)).not.toContain('<button')
  })

  it('lists only earlier questions to test, and only the tests a question’s kind allows', () => {
    const html = render(state({ answerId: 'n', gt: 3 }))
    expect(options(selectAfterLabel(html, 'Question tested'))).toEqual(['yn', 'n', 'c', 'm', 't'])
    expect(options(selectAfterLabel(html, 'Test'))).toEqual(['gt', 'equals'])
    expect(tagFor(html, 'questions.5.showIf.gt')).toContain('value="3"')
    expect(html).toContain('>people</span>')
  })

  it('follows the tested question’s kind for the value control', () => {
    const boolean = render(state({ answerId: 'yn', equals: false }))
    expect(options(selectAfterLabel(boolean, 'Test'))).toEqual(['equals'])
    expect(tagFor(boolean, 'questions.5.showIf.equals')).toMatch(/^<select/)
    expect(boolean).toContain('<option value="no" selected="">no</option>')

    const choice = render(state({ answerId: 'c', equals: 'daily' }))
    expect(choice).toContain('<option value="daily" selected="">daily</option>')

    const multi = render(state({ answerId: 'm', includes: 'Xero' }))
    expect(options(selectAfterLabel(multi, 'Test'))).toEqual(['includes'])
    expect(multi).toContain('<option value="Xero" selected="">Xero</option>')

    const text = render(state({ answerId: 't', includes: 'invoice' }))
    expect(tagFor(text, 'questions.5.showIf.includes')).toMatch(/^<input[^>]*value="invoice"/)
  })

  it('renders groups at any depth, each leaf at its own path', () => {
    const nested: Condition = { all: [{ answerId: 'yn', equals: true }, { any: [{ answerId: 'n', gt: 10 }, { answerId: 'c', equals: 'weekly' }] }] }
    const html = render(state(nested))
    expect([...renderedPaths(html)].sort()).toEqual(
      [
        'questions.5.showIf',
        'questions.5.showIf.all.0.answerId',
        'questions.5.showIf.all.0.equals',
        'questions.5.showIf.all.1.any.0.answerId',
        'questions.5.showIf.all.1.any.0.gt',
        'questions.5.showIf.all.1.any.1.answerId',
        'questions.5.showIf.all.1.any.1.equals',
      ].sort(),
    )
    expect(html.match(/>Add condition<\/button>/g)).toHaveLength(2)
    // Every node inside a group can be removed: two in the outer group and two in the inner one.
    expect(html.match(/aria-label="Remove this condition"/g)).toHaveLength(4)
    expect(html).toContain('>Always show</button>')
    expect(selectAfterLabel(html, 'Condition')).toContain('<option value="all" selected="">when all of</option>')
  })

  it('writes an issue under the leaf value it concerns', () => {
    const html = render(setConditionAt(state(), 'questions.5.showIf', { answerId: 'yn', gt: 1 }))
    expect(describedBy(html, 'questions.5.showIf.answerId')).not.toContain('<li>')
    expect(describedBy(html, 'questions.5.showIf.gt')).toContain(`<li>${escapeHtml("'Greater than' tests a number or duration, and 'yn' is a boolean question")}</li>`)
  })

  it('shows a condition naming a question the set does not have, with the editor’s refusal under it', () => {
    const html = render(state({ answerId: 'gone', equals: true }))
    expect(selectAfterLabel(html, 'Question tested')).toContain('<option value="gone" selected="">missing: gone</option>')
    expect(describedBy(html, 'questions.5.showIf.answerId')).toContain(`<li>${escapeHtml("No question in this set has the id 'gone'")}</li>`)
  })
})
