import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  addChoice,
  addQuestion,
  defaultLeaf,
  formIssues,
  initialQuestionSetForm,
  questionSetFormView,
  setChoice,
  setConditionAt,
  setText,
  type ConditionTest,
  type QuestionSetFormState,
} from '../../../hooks/use-question-set-form'
import {
  ANSWER_KINDS,
  ConditionSchema,
  MAPPABLE_PATHS,
  MAPPING_TARGETS,
  QuestionSetSchema,
  type AnswerKind,
  type Condition,
  type MappablePath,
  type Question,
  type QuestionSet,
} from '../../../schema/discovery'
import { tagFor } from '../../__fixtures__/markup'
import { ConditionEditor } from './condition-editor'
import { QuestionSetEditorScreen } from './question-set-editor-view'

// The editor offers mappings and condition tests from tables of its own, and the schema decides what is
// valid. Both are read as they are used, the offers from the rendered markup and the verdicts from
// QuestionSetSchema, so a change to either side that leaves a valid set the editor cannot build, or offers
// a choice the schema would refuse, fails here and not later in front of whoever is writing a question set.

const ignore = () => undefined

function q(id: string, extra: Partial<Question> = {}): Question {
  return { id, text: `Question ${id}`, kind: 'text', required: false, ...extra }
}

function set(...questions: Question[]): QuestionSet {
  return { id: 'qs', name: 'Set', kind: 'discovery', appliesTo: {}, questions }
}

// A question of this kind that is valid in every respect but the one under test.
function plain(id: string, kind: AnswerKind): Question {
  return q(id, {
    kind,
    ...(kind === 'choice' || kind === 'multi' ? { choices: ['alpha', 'beta'] } : {}),
    ...(kind === 'number' ? { unit: 'orders/day' } : {}),
  })
}

function optionValues(select: string): string[] {
  return [...select.matchAll(/<option value="([^"]*)"/g)].map((match) => match[1] ?? '')
}

// The whole select that carries a path, from its opening tag to its closing one.
function selectAt(html: string, path: string): string {
  const opening = tagFor(html, path)
  if (!opening.startsWith('<select')) throw new Error(`'${path}' is not a select`)
  const start = html.indexOf(opening)
  return html.slice(start, html.indexOf('</select>', start))
}

// The condition builder's selects carry no path, only a label.
function selectsLabelled(html: string, label: string): string[] {
  const ids = [...html.matchAll(new RegExp(`<label for="([^"]+)" class="sr-only">${label}</label>`, 'g'))].map((match) => match[1] ?? '')
  return ids.map((id) => {
    const start = html.indexOf(`<select id="${id}"`)
    return html.slice(start, html.indexOf('</select>', start))
  })
}

function renderEditor(state: QuestionSetFormState): string {
  return renderToStaticMarkup(
    <QuestionSetEditorScreen form={questionSetFormView(state, ignore)} industries={[]} patterns={[]} saving={false} saveError={null} onSave={ignore} />,
  )
}

function renderConditions(state: QuestionSetFormState, index: number): string {
  return renderToStaticMarkup(<ConditionEditor form={questionSetFormView(state, ignore)} index={index} questions={state.draft.questions} />)
}

describe('mapsTo', () => {
  // What a person does first: add a question and pick its kind.
  function questionOfKind(kind: AnswerKind): QuestionSetFormState {
    return setChoice(addQuestion(initialQuestionSetForm(set()), 'q-new'), 'questions.0.kind', kind)
  }

  // Anything the editor offers that is not a path would be a choice the schema refuses.
  function asPath(value: string): MappablePath {
    const path = MAPPABLE_PATHS.find((candidate) => candidate === value)
    if (path === undefined) throw new Error(`the editor offers '${value}', which is not a mappable path`)
    return path
  }

  function offeredPaths(kind: AnswerKind): MappablePath[] {
    return optionValues(selectAt(renderEditor(questionOfKind(kind)), 'questions.0.mapsTo'))
      .filter((value) => value !== '')
      .map(asPath)
  }

  // Valid in every respect but the mapping, so the schema's verdict on the set is its verdict on the pairing.
  function schemaAccepts(kind: AnswerKind, path: MappablePath): boolean {
    const choices = kind === 'choice' || kind === 'multi' ? { choices: [...(MAPPING_TARGETS[path].choices ?? ['alpha', 'beta'])] } : {}
    return QuestionSetSchema.safeParse(set(q('subject', { kind, mapsTo: path, ...choices }))).success
  }

  // The steps a person takes to map a question: text, the choices its kind needs, then the path.
  function pick(kind: AnswerKind, path: MappablePath): QuestionSetFormState {
    let state = setText(questionOfKind(kind), 'questions.0.text', 'A question')
    if (kind === 'choice' || kind === 'multi') {
      // A path holding an enum takes only its own values, so those are the choices to type.
      for (const [at, choice] of (MAPPING_TARGETS[path].choices ?? ['alpha']).entries()) {
        state = setText(addChoice(state, 0), `questions.0.choices.${at}`, choice)
      }
    }
    return setChoice(state, 'questions.0.mapsTo', path)
  }

  it('can be given any kind the schema has, since a path is only reachable through a kind', () => {
    const kinds = optionValues(selectAt(renderEditor(questionOfKind('text')), 'questions.0.kind'))
    expect(kinds.sort()).toEqual([...ANSWER_KINDS].sort())
  })

  it('is offered, for each kind, exactly the paths the schema accepts for that kind', () => {
    for (const kind of ANSWER_KINDS) {
      const accepted = MAPPABLE_PATHS.filter((path) => schemaAccepts(kind, path))
      expect({ kind, offered: offeredPaths(kind).sort() }).toEqual({ kind, offered: [...accepted].sort() })
    }
  })

  it('reaches every path in MAPPING_TARGETS through some kind', () => {
    const reachable = new Set(ANSWER_KINDS.flatMap(offeredPaths))
    expect(MAPPABLE_PATHS.filter((path) => !reachable.has(path))).toEqual([])
  })

  it('gives a set with no issues for every path the editor offers, once picked', () => {
    for (const kind of ANSWER_KINDS) {
      for (const path of offeredPaths(kind)) {
        const picked = pick(kind, path)
        expect({ kind, path, mapsTo: picked.draft.questions[0]?.mapsTo, issues: formIssues(picked) }).toEqual({ kind, path, mapsTo: path, issues: [] })
      }
    }
  })
})

describe('conditions', () => {
  // The three leaf shapes of ConditionSchema; the last test below fails if the schema gains another.
  const TESTS: readonly ConditionTest[] = ['equals', 'gt', 'includes']

  function asTest(value: string): ConditionTest {
    const test = TESTS.find((candidate) => candidate === value)
    if (test === undefined) throw new Error(`the condition builder offers '${value}', which is not a test`)
    return test
  }

  // A leaf of the shape the test asks for, with a value of the type the schema expects of it, so a
  // refusal is about the pairing of test and kind and not about the value.
  function leafFor(kind: AnswerKind, test: ConditionTest): Condition {
    if (test === 'gt') return { answerId: 'first', gt: 1 }
    if (test === 'includes') return { answerId: 'first', includes: kind === 'multi' ? 'alpha' : 'x' }
    if (kind === 'boolean') return { answerId: 'first', equals: true }
    if (kind === 'number' || kind === 'duration') return { answerId: 'first', equals: 1 }
    return { answerId: 'first', equals: kind === 'choice' ? 'alpha' : 'x' }
  }

  // A second question that depends on a first of the kind under test.
  function dependent(kind: AnswerKind, showIf?: Condition): QuestionSetFormState {
    return initialQuestionSetForm(set(plain('first', kind), q('second', showIf === undefined ? {} : { showIf })))
  }

  // What the 'Add condition' button writes, and so what the Test select then offers for that kind.
  function offeredTests(kind: AnswerKind): ConditionTest[] {
    const added = setConditionAt(dependent(kind), 'questions.1.showIf', defaultLeaf(plain('first', kind)))
    return optionValues(selectsLabelled(renderConditions(added, 1), 'Test')[0] ?? '').map(asTest)
  }

  function schemaAccepts(kind: AnswerKind, test: ConditionTest): boolean {
    return QuestionSetSchema.safeParse(dependent(kind, leafFor(kind, test)).draft).success
  }

  it('offers, for each kind tested, exactly the tests the schema accepts on it', () => {
    for (const kind of ANSWER_KINDS) {
      const accepted = TESTS.filter((test) => schemaAccepts(kind, test))
      expect({ kind, offered: offeredTests(kind).sort() }).toEqual({ kind, offered: [...accepted].sort() })
    }
  })

  it('writes a valid leaf whichever offered test is chosen', () => {
    for (const kind of ANSWER_KINDS) {
      for (const test of offeredTests(kind)) {
        const chosen = setConditionAt(dependent(kind), 'questions.1.showIf', defaultLeaf(plain('first', kind), test))
        expect({ kind, test, issues: formIssues(chosen) }).toEqual({ kind, test, issues: [] })
      }
    }
  })

  it('renders and accepts a group of groups, and a group with nothing in it', () => {
    const leaf = defaultLeaf(plain('first', 'boolean'))
    const state = dependent('boolean', { all: [leaf, { any: [leaf, { all: [] }] }] })
    expect(formIssues(state)).toEqual([])

    const html = renderConditions(state, 1)
    // Five nodes over three depths, and each can be a single test, an all-of or an any-of.
    const nodes = selectsLabelled(html, 'Condition')
    expect(nodes).toHaveLength(5)
    for (const select of nodes) expect(optionValues(select)).toEqual(['answer', 'all', 'any'])
    // Each of the three groups takes another condition, and each of the four nodes inside one can be
    // removed, which is how a group is emptied.
    expect(html.match(/>Add condition<\/button>/g)).toHaveLength(3)
    expect(html.match(/aria-label="Remove this condition"/g)).toHaveLength(4)
  })

  it('offers no condition on the first question, and the schema refuses one naming it or a later question', () => {
    const html = renderConditions(initialQuestionSetForm(set(q('only'), q('second'))), 0)
    expect(html).toContain('no earlier question to depend on')
    expect(html).not.toContain('<button')

    const shapes: [string, Condition][] = [
      ['itself', { answerId: 'only', equals: 'x' }],
      ['a later question', { answerId: 'second', equals: 'x' }],
      ['a question outside the set', { answerId: 'gone', equals: 'x' }],
      ['an empty all', { all: [] }],
      ['an empty any', { any: [] }],
    ]
    const accepted = shapes.filter(([, showIf]) => QuestionSetSchema.safeParse(set(q('only', { showIf }), q('second'))).success).map(([label]) => label)
    expect(accepted).toEqual(['a question outside the set', 'an empty all', 'an empty any'])
  })

  it('has a row here for every leaf shape the schema defines', () => {
    const shapes = ConditionSchema.options.flatMap((option) => Object.keys(option.shape)).filter((key) => key !== 'answerId' && key !== 'all' && key !== 'any')
    expect(shapes.sort()).toEqual([...TESTS].sort())
  })
})
