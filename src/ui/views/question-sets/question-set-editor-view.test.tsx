import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  addQuestion,
  initialQuestionSetForm,
  locatedPaths,
  questionSetFormView,
  setChoice,
  setConditionAt,
  setNumberText,
  setText,
  type QuestionSetFormState,
} from '../../../hooks/use-question-set-form'
import { pattern } from '../../../schema/__fixtures__/records'
import type { Question, QuestionSet } from '../../../schema/discovery'
import { DISCOVERY_SET_ID, seedQuestionSets } from '../../../schema/seed-question-sets'
import { describedBy, escapeHtml, renderedPaths, tagFor } from '../../__fixtures__/markup'
import { QuestionSetEditorScreen } from './question-set-editor-view'

const ignore = () => undefined
const INDUSTRIES = ['Professional Services', 'E-commerce']

function render(state: QuestionSetFormState, patch: { patterns?: ReturnType<typeof pattern>[]; saving?: boolean; saveError?: string | null } = {}): string {
  return renderToStaticMarkup(
    <QuestionSetEditorScreen
      form={questionSetFormView(state, ignore)}
      industries={INDUSTRIES}
      patterns={patch.patterns ?? []}
      saving={patch.saving ?? false}
      saveError={patch.saveError ?? null}
      onSave={ignore}
    />,
  )
}

function q(id: string, extra: Partial<Question> = {}): Question {
  return { id, text: `Question ${id}`, kind: 'text', required: false, ...extra }
}

function set(...questions: Question[]): QuestionSet {
  return { id: 'qs', name: 'Set', kind: 'discovery', appliesTo: { industries: ['E-commerce'], minEmployees: 5 }, questions }
}

function discovery(): QuestionSetFormState {
  const found = seedQuestionSets().find((candidate) => candidate.id === DISCOVERY_SET_ID)
  if (found === undefined) throw new Error('no seed')
  return initialQuestionSetForm(found)
}

const everyKind = () =>
  initialQuestionSetForm(
    set(
      q('yn', { kind: 'boolean', required: true }),
      q('n', { kind: 'number', unit: 'orders/day' }),
      q('c', { kind: 'choice', choices: ['weekly', 'daily'], mapsTo: 'company.industry' }),
      q('m', { kind: 'multi', choices: ['HubSpot'], mapsTo: 'company.statedTools', suggestsPatterns: ['pat-email-triage'] }),
      q('d', { kind: 'duration', mapsTo: 'process.frequency.minutesPerOccurrence' }),
      q('t', { helpText: 'Ask gently', showIf: { answerId: 'yn', equals: true } }),
    ),
  )

describe('QuestionSetEditorScreen, every field', () => {
  it('renders exactly the paths the form model places issues at, for a set using every kind', () => {
    const state = everyKind()
    expect([...renderedPaths(render(state))].sort()).toEqual([...locatedPaths(state.draft)].sort())
  })

  it('renders exactly those paths for the seeded full discovery set', () => {
    const state = discovery()
    expect([...renderedPaths(render(state))].sort()).toEqual([...locatedPaths(state.draft)].sort())
  })

  it('shows a unit only on a number question, and choices only where they belong', () => {
    const html = render(everyKind())
    expect(tagFor(html, 'questions.1.unit')).toContain('value="orders/day"')
    expect(html).not.toContain('data-config-path="questions.0.unit"')
    expect(tagFor(html, 'questions.2.choices.0')).toContain('value="weekly"')
    expect(html).not.toContain('data-config-path="questions.5.choices"')
  })
})

describe('QuestionSetEditorScreen, fields', () => {
  it('shows the set name, kind, industries ticked and the minimum employees', () => {
    const html = render(everyKind())
    expect(tagFor(html, 'name')).toContain('value="Set"')
    expect(html).toContain('<option value="discovery" selected="">discovery</option>')
    expect(tagFor(html, 'appliesTo.minEmployees')).toContain('value="5"')
    const industries = html.slice(html.indexOf('data-config-path="appliesTo.industries"'))
    expect(industries).toContain('<input type="checkbox" checked=""/>E-commerce')
    expect(industries).toContain('Sets that apply to a company are listed first')
  })

  it('offers only the mappable paths a question’s kind can fill, and keeps an id visible but uneditable', () => {
    const html = render(everyKind())
    const picker = (index: number) => {
      const start = html.indexOf(`data-config-path="questions.${index}.mapsTo"`)
      return html.slice(start, html.indexOf('</select>', start))
    }
    expect(picker(1)).toContain('<option value="company.employeeCount">')
    expect(picker(1)).not.toContain('company.statedTools')
    expect(picker(3)).toContain('<option value="company.statedTools" selected="">')
    expect(picker(3)).not.toContain('company.blendedHourlyCost')
    expect(picker(0)).toContain('<option value="" selected="">not mapped</option>')
    expect(tagFor(html, 'questions.0.id')).toMatch(/^<output /)
  })

  it('lists patterns to suggest, and says when the Library has none yet', () => {
    expect(render(everyKind())).toContain('The Library has no patterns yet; they arrive with the pattern library (Stage 2, task 9).')
    const withPatterns = render(everyKind(), { patterns: [pattern()] })
    expect(withPatterns).toContain('<input type="checkbox" checked=""/>Email triage')
  })

  it('offers to add a question, and says when a set has none', () => {
    const empty = render(initialQuestionSetForm(set()))
    expect(empty).toContain('No questions yet')
    expect(empty).toContain('>Add question</button>')
    const added = render(addQuestion(initialQuestionSetForm(set()), 'q-new'))
    expect(tagFor(added, 'questions.0.text')).toContain('value=""')
  })
})

describe('QuestionSetEditorScreen, issue placement', () => {
  it('writes each question-set rule under its own control', () => {
    let state = setText(everyKind(), 'name', ' ')
    state = setText(state, 'questions.1.unit', 'EUR/hour')
    state = setText(state, 'questions.2.choices.0', '')
    state = setChoice(state, 'questions.5.mapsTo', 'company.employeeCount')
    state = setNumberText(state, 'appliesTo.minEmployees', '2,5')
    const html = render(state)
    expect(describedBy(html, 'name')).toContain('<li>A question set needs a name</li>')
    expect(describedBy(html, 'questions.1.unit')).toContain(escapeHtml("A money figure must map to a money path, not carry the unit 'EUR/hour'"))
    expect(describedBy(html, 'questions.2.choices.0')).toContain('<li>A choice cannot be blank</li>')
    expect(describedBy(html, 'questions.5.mapsTo')).toContain(escapeHtml('A text question cannot map to company.employeeCount, which takes a number answer'))
    expect(describedBy(html, 'appliesTo.minEmployees')).toContain('<li>')
  })

  it('writes a condition’s refusal under the condition, and counts the problems in the save bar', () => {
    const state = setConditionAt(everyKind(), 'questions.5.showIf', { answerId: 'n', includes: 'x' })
    const html = render(state)
    expect(describedBy(html, 'questions.5.showIf.includes')).toContain(escapeHtml("'Includes' tests a multi or text question, and 'n' is a number question"))
    expect(html).toContain('Unsaved changes: 1 problem to fix before saving')
  })

  it('reports a save that failed', () => {
    expect(render(setText(everyKind(), 'name', 'Renamed'), { saveError: 'the database is closed' })).toContain('The question set was not saved: the database is closed')
  })
})
