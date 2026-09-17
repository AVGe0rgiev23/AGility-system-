import { useId } from 'react'
import { defaultLeaf, type ConditionTest, type QuestionSetFormView } from '../../../hooks/use-question-set-form'
import type { AnswerKind, Condition, Question } from '../../../schema/discovery'
import { Field, fieldDescriptionId } from '../../primitives/field'
import { BUTTON, CONTROL, ChoiceField, NumberField, TextField } from '../form-controls'

// Builds a question's showIf: always shown, or shown when an answer test, all of several, or any of
// several reads true. Every leaf tests an earlier question, with only the tests its kind allows, and its
// value control follows that question's kind.

const TESTS_BY_KIND: Record<AnswerKind, readonly ConditionTest[]> = {
  boolean: ['equals'],
  choice: ['equals'],
  text: ['includes', 'equals'],
  multi: ['includes'],
  number: ['gt', 'equals'],
  duration: ['gt', 'equals'],
}

const TEST_LABELS: Record<ConditionTest, string> = { equals: 'equals', gt: 'is more than', includes: 'includes' }

type NodeKind = 'answer' | 'all' | 'any'

function nodeKind(condition: Condition): NodeKind {
  return 'all' in condition ? 'all' : 'any' in condition ? 'any' : 'answer'
}

function testOf(condition: Condition): ConditionTest | null {
  if ('equals' in condition) return 'equals'
  if ('gt' in condition) return 'gt'
  if ('includes' in condition) return 'includes'
  return null
}

function PlainSelect({ label, value, options, path, issues, onChange }: { label: string; value: string; options: readonly { value: string; label: string }[]; path?: string; issues?: readonly string[]; onChange: (value: string) => void }) {
  const id = useId()
  const problems = issues ?? []
  return (
    <Field label={label} htmlFor={id} issues={problems} layout="cell">
      <select
        id={id}
        data-config-path={path}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={problems.length > 0}
        aria-describedby={fieldDescriptionId(id)}
        className={`${CONTROL} num ${problems.length > 0 ? 'border-danger' : ''}`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  )
}

interface NodeProps {
  form: QuestionSetFormView
  path: string
  condition: Condition
  earlier: readonly Question[]
  // Only a node inside a group can be removed on its own; the root is cleared by choosing 'always'.
  removable: boolean
}

function Leaf({ form, path, condition, earlier }: { form: QuestionSetFormView; path: string; condition: Condition; earlier: readonly Question[] }) {
  if ('all' in condition || 'any' in condition) return null
  const tested = earlier.find((question) => question.id === condition.answerId)
  const questionOptions = [
    ...(tested === undefined ? [{ value: condition.answerId, label: `missing: ${condition.answerId}` }] : []),
    ...earlier.map((question) => ({ value: question.id, label: question.text === '' ? question.id : question.text })),
  ]
  const tests = tested === undefined ? [testOf(condition) ?? 'equals'] : TESTS_BY_KIND[tested.kind]
  const test = testOf(condition) ?? 'equals'
  const valuePath = `${path}.${test}`

  let value = null
  if (tested !== undefined) {
    if (tested.kind === 'boolean') {
      value = (
        <PlainSelect
          label="Answer"
          path={valuePath}
          issues={form.issuesAt(valuePath)}
          value={'equals' in condition && condition.equals === false ? 'no' : 'yes'}
          options={[
            { value: 'yes', label: 'yes' },
            { value: 'no', label: 'no' },
          ]}
          onChange={(choice) => form.setConditionAt(path, { answerId: tested.id, equals: choice === 'yes' })}
        />
      )
    } else if (tested.kind === 'number' || tested.kind === 'duration') {
      value = <NumberField form={form} path={valuePath} label="Number" unit={tested.kind === 'duration' ? 'minutes' : tested.unit} layout="cell" />
    } else if (tested.kind === 'choice' || (tested.kind === 'multi' && test === 'includes')) {
      value = <ChoiceField form={form} path={valuePath} label="Choice" options={tested.choices ?? []} layout="cell" />
    } else {
      value = <TextField form={form} path={valuePath} label="Text" layout="cell" width="w-40" />
    }
  } else {
    value = <span className="num text-sm text-muted">{String('equals' in condition ? condition.equals : 'gt' in condition ? condition.gt : condition.includes)}</span>
  }

  return (
    <>
      <PlainSelect
        label="Question tested"
        path={`${path}.answerId`}
        issues={form.issuesAt(`${path}.answerId`)}
        value={condition.answerId}
        options={questionOptions}
        onChange={(id) => {
          const next = earlier.find((question) => question.id === id)
          if (next !== undefined) form.setConditionAt(path, defaultLeaf(next))
        }}
      />
      <PlainSelect
        label="Test"
        value={test}
        options={tests.map((candidate) => ({ value: candidate, label: TEST_LABELS[candidate] }))}
        onChange={(chosen) => {
          const next = tests.find((candidate) => candidate === chosen)
          if (tested !== undefined && next !== undefined) form.setConditionAt(path, defaultLeaf(tested, next))
        }}
      />
      {value}
    </>
  )
}

function Node({ form, path, condition, earlier, removable }: NodeProps) {
  const kind = nodeKind(condition)
  const first = earlier[0]
  const children = 'all' in condition ? condition.all : 'any' in condition ? condition.any : []
  const childPath = `${path}.${kind}`

  const changeKind = (next: string) => {
    if (next === kind || first === undefined) return
    // A leaf wrapped in a group becomes its first test; a group turned into a leaf keeps its first leaf.
    if (next === 'all' || next === 'any') {
      const inner = kind === 'answer' ? [condition] : children
      form.setConditionAt(path, next === 'all' ? { all: inner } : { any: inner })
    } else {
      const leaf = children.find((child) => nodeKind(child) === 'answer') ?? defaultLeaf(first)
      form.setConditionAt(path, leaf)
    }
  }

  return (
    <div className="flex flex-col gap-1 border-l pl-2">
      <div className="flex flex-wrap items-start gap-2">
        <PlainSelect
          label="Condition"
          value={kind}
          options={[
            { value: 'answer', label: 'when' },
            { value: 'all', label: 'when all of' },
            { value: 'any', label: 'when any of' },
          ]}
          onChange={changeKind}
        />
        {kind === 'answer' ? <Leaf form={form} path={path} condition={condition} earlier={earlier} /> : null}
        {removable ? (
          <button type="button" className={BUTTON} onClick={() => form.setConditionAt(path, undefined)} aria-label="Remove this condition">
            Remove
          </button>
        ) : null}
      </div>
      {kind === 'answer' ? null : (
        <div className="flex flex-col gap-1 pl-2">
          {children.map((child, childIndex) => (
            <Node key={childIndex} form={form} path={`${childPath}.${childIndex}`} condition={child} earlier={earlier} removable />
          ))}
          {first === undefined ? null : (
            <div>
              <button type="button" className={BUTTON} onClick={() => form.setConditionAt(`${childPath}.${children.length}`, defaultLeaf(first))}>
                Add condition
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function ConditionEditor({ form, index, questions }: { form: QuestionSetFormView; index: number; questions: readonly Question[] }) {
  const id = useId()
  const path = `questions.${index}.showIf`
  const question = questions[index]
  const earlier = questions.slice(0, index)
  const first = earlier[0]
  const condition = question?.showIf
  const issues = form.issuesAt(path)

  return (
    <div role="group" aria-label="Show this question" data-config-path={path} aria-describedby={fieldDescriptionId(id)} className="flex flex-col gap-1">
      {condition === undefined ? (
        first === undefined ? (
          <span className="text-sm text-muted">always shown; no earlier question to depend on</span>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted">always shown</span>
            <button type="button" className={BUTTON} onClick={() => form.setConditionAt(path, defaultLeaf(first))}>
              Add condition
            </button>
          </div>
        )
      ) : (
        <div className="flex flex-col gap-1">
          <Node form={form} path={path} condition={condition} earlier={earlier} removable={false} />
          <div>
            <button type="button" className={BUTTON} onClick={() => form.setConditionAt(path, undefined)}>
              Always show
            </button>
          </div>
        </div>
      )}
      <div id={fieldDescriptionId(id)} className="text-xs">
        {issues.length === 0 ? null : (
          <ul role="alert" className="pt-0.5 text-danger">
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
