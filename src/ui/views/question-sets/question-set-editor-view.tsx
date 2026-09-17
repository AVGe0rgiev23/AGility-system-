import { useId, useState } from 'react'
import { withQuestionSet } from '../../../hooks/question-set-library'
import { showsChoices, showsUnit, useQuestionSetForm, type QuestionSetFormView } from '../../../hooks/use-question-set-form'
import type { ActionResult, BootedStore } from '../../../hooks/use-store'
import { DiscoverySessionSchema, MAPPABLE_PATHS, MAPPING_TARGETS, type Question, type QuestionSet } from '../../../schema/discovery'
import type { Library, Pattern } from '../../../schema/library'
import { fieldDescriptionId } from '../../primitives/field'
import { hrefFor } from '../../shell/router'
import { ChoiceField, FlagField, FormList, FormSection, NumberField, OtherProblems, RowActions, SaveBar, TextField } from '../form-controls'
import { ConditionEditor } from './condition-editor'

type LoadedStore = Extract<BootedStore, { phase: 'loaded' }>

const SESSION_KINDS = DiscoverySessionSchema.shape.kind.options
const QUESTION_KINDS = ['text', 'number', 'duration', 'choice', 'multi', 'boolean'] as const

// A group of checkboxes picked from a list, carrying the list's path so its issues show under it.
function CheckboxGroup({
  form,
  path,
  label,
  hint,
  options,
  onToggle,
}: {
  form: QuestionSetFormView
  path: string
  label: string
  hint: string
  options: readonly { value: string; label: string; checked: boolean }[]
  onToggle: (value: string, on: boolean) => void
}) {
  const id = useId()
  const issues = form.issuesAt(path)
  return (
    <div className="grid grid-cols-[11rem_minmax(0,1fr)] items-start gap-x-3 py-1">
      <span id={`${id}-label`} className="pt-1 text-sm text-muted">
        {label}
      </span>
      <div role="group" aria-labelledby={`${id}-label`} aria-describedby={fieldDescriptionId(id)} data-config-path={path} className="min-w-0">
        <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
          {options.map((option) => (
            <label key={option.value} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={option.checked} onChange={(event) => onToggle(option.value, event.target.checked)} />
              {option.label}
            </label>
          ))}
        </div>
        <div id={fieldDescriptionId(id)} className="text-xs">
          <p className="pt-0.5 text-muted">{hint}</p>
          {issues.length === 0 ? null : (
            <ul role="alert" className="pt-0.5 text-danger">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

function mappableFor(question: Question): string[] {
  return MAPPABLE_PATHS.filter((path) => MAPPING_TARGETS[path].kinds.includes(question.kind))
}

function QuestionDetails({ form, question, index, questions, patterns }: { form: QuestionSetFormView; question: Question; index: number; questions: readonly Question[]; patterns: readonly Pattern[] }) {
  const at = (field: string) => `questions.${index}.${field}`
  const choices = (question.choices ?? []).map((choice, choiceIndex) => ({ choice, choiceIndex }))
  const suggested = question.suggestsPatterns ?? []
  const patternOptions = [
    ...patterns.map((pattern) => ({ value: pattern.id, label: pattern.name, checked: suggested.includes(pattern.id) })),
    ...suggested.filter((id) => !patterns.some((pattern) => pattern.id === id)).map((id) => ({ value: id, label: `missing: ${id}`, checked: true })),
  ]

  return (
    <div className="flex flex-col pb-2 pl-8">
      <TextField form={form} path={at('helpText')} label="Help text" hint="Optional. Shown under the question in the runner." width="w-[32rem]" />
      {showsUnit(question) ? <TextField form={form} path={at('unit')} label="Unit" hint="What an unmapped number is recorded in, such as orders/day." width="w-40" /> : null}
      {showsChoices(question) ? (
        <FormList form={form} path={at('choices')} title="Choices" addLabel="Add choice" onAdd={() => form.addChoice(index)}>
          <table className="border-collapse text-sm">
            <caption className="sr-only">Choices</caption>
            <tbody>
              {choices.length === 0 ? (
                <tr>
                  <td className="h-7 px-2 text-muted">No choices yet</td>
                </tr>
              ) : (
                choices.map(({ choice, choiceIndex }) => (
                  <tr key={choiceIndex}>
                    <td className="px-2 py-0.5">
                      <TextField form={form} path={at(`choices.${choiceIndex}`)} label={`Choice ${choiceIndex + 1}`} layout="cell" width="w-56" />
                    </td>
                    <td className="px-2 py-0.5">
                      <RowActions name={choice === '' ? `choice ${choiceIndex + 1}` : `choice '${choice}'`} index={choiceIndex} count={choices.length} onRemove={() => form.removeChoice(index, choiceIndex)} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </FormList>
      ) : null}
      <CheckboxGroup
        form={form}
        path={at('suggestsPatterns')}
        label="Suggests patterns"
        hint={patterns.length === 0 ? 'The Library has no patterns yet; they arrive with the pattern library (Stage 2, task 9).' : 'Candidate patterns this question points towards.'}
        options={patternOptions}
        onToggle={(id, on) => form.togglePattern(index, id, on)}
      />
      <div className="grid grid-cols-[11rem_minmax(0,1fr)] items-start gap-x-3 py-1">
        <span className="pt-1 text-sm text-muted">Shown</span>
        <ConditionEditor form={form} index={index} questions={questions} />
      </div>
    </div>
  )
}

export interface QuestionSetEditorScreenProps {
  form: QuestionSetFormView
  // From Config, or empty when it is unusable.
  industries: readonly string[]
  patterns: readonly Pattern[]
  saving: boolean
  saveError: string | null
  onSave: () => void
}

export function QuestionSetEditorScreen({ form, industries, patterns, saving, saveError, onSave }: QuestionSetEditorScreenProps) {
  const { draft } = form
  const saved = form.state.saved
  const picked = draft.appliesTo.industries ?? []
  const industryOptions = [...industries, ...picked.filter((industry) => !industries.includes(industry))].map((industry) => ({
    value: industry,
    label: industry,
    checked: picked.includes(industry),
  }))

  return (
    <section aria-labelledby="page-heading">
      <SaveBar
        title={
          <>
            {saved.name} <span className="num text-xs text-muted">{saved.kind}</span>
          </>
        }
        changed={form.changed}
        problems={form.issues.length}
        canSave={form.canSave}
        saving={saving}
        onSave={onSave}
        onDiscard={form.discard}
      />
      {saveError === null ? null : (
        <p role="alert" className="border-b px-4 py-2 text-sm text-danger">
          The question set was not saved: {saveError}
        </p>
      )}
      <OtherProblems problems={form.otherProblems} />

      <div key={form.state.generation}>
        <FormSection id="question-set-details" title="Question set">
          <TextField form={form} path="name" label="Name" />
          <ChoiceField form={form} path="kind" label="Kind" options={SESSION_KINDS} hint="Sessions started from this set take its kind." />
          <CheckboxGroup
            form={form}
            path="appliesTo.industries"
            label="Industries"
            hint="Sets that apply to a company are listed first when a session starts. None ticked: every industry."
            options={industryOptions}
            onToggle={form.toggleIndustry}
          />
          <NumberField form={form} path="appliesTo.minEmployees" label="Minimum employees" unit="people" nullable hint="Optional. A whole number." />
        </FormSection>

        <FormSection id="question-set-questions" title="Questions">
          <FormList form={form} path="questions" title="In order" hint="A question can only depend on the questions above it." addLabel="Add question" onAdd={form.addQuestion}>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">Questions</caption>
                <thead>
                  <tr>
                    {['#', 'Question', 'Kind', 'Required', 'Maps to', ''].map((header) => (
                      <th key={header} scope="col" className="h-7 border-b px-2 text-left text-xs font-normal whitespace-nowrap text-muted">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                {draft.questions.length === 0 ? (
                  <tbody>
                    <tr>
                      <td colSpan={6} className="h-7 border-b px-2 text-muted">
                        No questions yet
                      </td>
                    </tr>
                  </tbody>
                ) : (
                  draft.questions.map((question, index) => {
                    const name = question.text === '' ? `question ${index + 1}` : `'${question.text}'`
                    return (
                      <tbody key={index} className="border-b">
                        <tr className="align-top">
                          <td className="px-2 pt-1.5">
                            <span className="num text-sm">{index + 1}</span>
                            <output data-config-path={`questions.${index}.id`} aria-describedby={fieldDescriptionId(`question-id-${index}`)} className="num block text-xs text-muted">
                              {question.id}
                            </output>
                            <div id={fieldDescriptionId(`question-id-${index}`)} className="text-xs text-danger">
                              {form.issuesAt(`questions.${index}.id`).map((issue) => (
                                <p key={issue}>{issue}</p>
                              ))}
                            </div>
                          </td>
                          <td className="w-full px-2 py-1">
                            <TextField form={form} path={`questions.${index}.text`} label={`Text of ${name}`} layout="cell" width="w-full" />
                          </td>
                          <td className="px-2 py-1">
                            <ChoiceField form={form} path={`questions.${index}.kind`} label={`Kind of ${name}`} options={QUESTION_KINDS} layout="cell" />
                          </td>
                          <td className="px-2 py-1">
                            <FlagField form={form} path={`questions.${index}.required`} label={`${name} is required`} layout="cell" />
                          </td>
                          <td className="px-2 py-1">
                            <ChoiceField form={form} path={`questions.${index}.mapsTo`} label={`Where ${name} lands`} options={mappableFor(question)} emptyLabel="not mapped" layout="cell" />
                          </td>
                          <td className="px-2 py-1">
                            <RowActions name={name} index={index} count={draft.questions.length} onMove={(offset) => form.moveQuestion(index, offset)} onRemove={() => form.removeQuestion(index)} />
                          </td>
                        </tr>
                        <tr>
                          <td colSpan={6}>
                            <QuestionDetails form={form} question={question} index={index} questions={draft.questions} patterns={patterns} />
                          </td>
                        </tr>
                      </tbody>
                    )
                  })
                )}
              </table>
            </div>
          </FormList>
        </FormSection>
      </div>
    </section>
  )
}

function QuestionSetEditor({ library, set, industries, saveLibrary }: { library: Library; set: QuestionSet; industries: readonly string[]; saveLibrary: (library: Library) => Promise<ActionResult> }) {
  const form = useQuestionSetForm(set)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const save = async () => {
    if (!form.canSave) return
    setSaving(true)
    setSaveError(null)
    const result = await saveLibrary(withQuestionSet(library, form.draft))
    setSaving(false)
    if (!result.ok) setSaveError(result.message)
  }

  return <QuestionSetEditorScreen form={form} industries={industries} patterns={library.patterns} saving={saving} saveError={saveError} onSave={() => void save()} />
}

export function QuestionSetMissing({ title, detail }: { title: string; detail: string }) {
  return (
    <section aria-labelledby="page-heading">
      <header className="flex h-10 items-center border-b px-4">
        <h1 id="page-heading" className="text-base font-medium">
          {title}
        </h1>
      </header>
      <p className="px-4 py-3 text-sm">
        {detail}{' '}
        <a href={hrefFor({ name: 'question-sets' })} className="text-fg underline">
          Back to the question sets
        </a>
        .
      </p>
    </section>
  )
}

export function QuestionSetEditorView({ loaded, id, saveLibrary }: { loaded: LoadedStore; id: string; saveLibrary: (library: Library) => Promise<ActionResult> }) {
  const { library, config } = loaded.load.store
  if (library === null) {
    return <QuestionSetMissing title="The Library is unusable" detail="The stored Library does not validate, so no question set can be edited. The store notice above lists why." />
  }
  const set = library.questionSets.find((candidate) => candidate.id === id)
  if (set === undefined) return <QuestionSetMissing title="Question set not found" detail={`There is no question set '${id}'.`} />
  // Keyed by id, so opening another set starts its own form.
  return <QuestionSetEditor key={id} library={library} set={set} industries={config?.industries ?? []} saveLibrary={saveLibrary} />
}
