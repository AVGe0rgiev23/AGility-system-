import { useId, useState } from 'react'
import { completeness, measureOf, questionStates, type QuestionState } from '../../../hooks/discovery-rules'
import { sessionSetOf, type EngagementFormView } from '../../../hooks/use-engagement-form'
import { AnswerSchema, MAPPING_TARGETS, type Answer, type DiscoverySession, type Question, type QuestionSet } from '../../../schema/discovery'
import type { Currency, TracedValue } from '../../../schema/traced'
import { formatNumber, formatTraced, fromLocalDateTime, localDateTime } from '../../format'
import { Field, fieldDescriptionId } from '../../primitives/field'
import { TracedInput } from '../../primitives/traced-input'
import { hrefFor } from '../../shell/router'
import { BUTTON, CONTROL } from '../form-controls'

const FLAGS = AnswerSchema.shape.flags.element.options

// What is already stored at a mapped path, so the room can see what an answer will replace.
function savedAt(form: EngagementFormView, path: string): string {
  const value = form.valueAt(path)
  if (value === undefined || value === null || value === '') return 'nothing yet'
  if (Array.isArray(value)) return value.length === 0 ? 'nothing yet' : value.join(', ')
  if (typeof value === 'number') return formatNumber(value)
  if (typeof value === 'string') return value
  return formatTraced(value as TracedValue)
}

function MappingNote({ form, question }: { form: EngagementFormView; question: Question }) {
  if (question.mapsTo === undefined) return null
  const target = MAPPING_TARGETS[question.mapsTo]
  if (!question.mapsTo.startsWith('company.')) {
    return (
      <p className="pt-0.5 text-xs text-muted">
        Recorded for <span className="num">{question.mapsTo}</span>. It is carried over when a process is started from this session, on the{' '}
        <a href={hrefFor({ name: 'engagement', id: form.saved.id, tab: 'processes' })} className="text-fg underline">
          Processes tab
        </a>
        .
      </p>
    )
  }
  return (
    <p className="pt-0.5 text-xs text-muted">
      {target.lands === 'list' ? 'Adds to' : 'Replaces'} <span className="num">{question.mapsTo}</span>, now <span className="num">{savedAt(form, question.mapsTo)}</span>.
    </p>
  )
}

function FlagToggles({ answer, name, onToggle }: { answer: Answer | undefined; name: string; onToggle: (flag: Answer['flags'][number], on: boolean) => void }) {
  return (
    <fieldset className="flex flex-wrap items-center gap-x-3 gap-y-0.5 pt-1">
      <legend className="sr-only">Flags on {name}</legend>
      {FLAGS.map((flag) => (
        <label key={flag} className="flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={answer?.flags.includes(flag) === true} onChange={(event) => onToggle(flag, event.target.checked)} />
          {flag}
        </label>
      ))}
    </fieldset>
  )
}

interface RowProps {
  form: EngagementFormView
  sets: readonly QuestionSet[]
  sessionIndex: number
  state: QuestionState
  // The answer's own path, once there is an answer to address.
  path: string | null
  issues: readonly string[]
  currency: Currency
}

// One question: what was asked, what was said, what it is flagged as, and where it lands.
function QuestionRow({ form, sets, sessionIndex, state, path, issues, currency }: RowProps) {
  const id = useId()
  const { question, answer } = state
  const measure = measureOf(question)
  const value = answer?.value
  const label = question.text
  const describedBy = fieldDescriptionId(id)

  const control = () => {
    switch (question.kind) {
      case 'text':
        return (
          <input
            id={id}
            type="text"
            autoComplete="off"
            data-config-path={path ?? undefined}
            value={typeof value === 'string' ? value : ''}
            onChange={(event) => form.setAnswerValue(sets, sessionIndex, question, event.target.value)}
            aria-invalid={issues.length > 0}
            aria-describedby={describedBy}
            className={`${CONTROL} w-full max-w-xl ${issues.length > 0 ? 'border-danger' : ''}`}
          />
        )
      case 'choice':
        return (
          <select
            id={id}
            data-config-path={path ?? undefined}
            value={typeof value === 'string' ? value : ''}
            onChange={(event) => (event.target.value === '' ? form.clearAnswer(sets, sessionIndex, question) : form.setAnswerValue(sets, sessionIndex, question, event.target.value))}
            aria-invalid={issues.length > 0}
            aria-describedby={describedBy}
            className={`${CONTROL} max-w-full ${value === undefined ? 'text-muted' : ''} ${issues.length > 0 ? 'border-danger' : ''}`}
          >
            <option value="">not answered</option>
            {(question.choices ?? []).map((choice) => (
              <option key={choice} value={choice}>
                {choice}
              </option>
            ))}
          </select>
        )
      case 'boolean':
        return (
          <span id={id} data-config-path={path ?? undefined} aria-describedby={describedBy} className="flex items-center gap-3 text-sm">
            {[true, false].map((option) => (
              <label key={String(option)} className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name={`${id}-answer`}
                  checked={value === option}
                  onChange={() => form.setAnswerValue(sets, sessionIndex, question, option)}
                />
                {option ? 'Yes' : 'No'}
              </label>
            ))}
          </span>
        )
      case 'multi': {
        const chosen = Array.isArray(value) ? value : []
        return (
          <span id={id} data-config-path={path ?? undefined} aria-describedby={describedBy} className="flex flex-wrap gap-x-4 gap-y-0.5 text-sm">
            {(question.choices ?? []).map((choice) => (
              <label key={choice} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={chosen.includes(choice)}
                  onChange={(event) => form.setAnswerValue(sets, sessionIndex, question, event.target.checked ? [...chosen, choice] : chosen.filter((item) => item !== choice))}
                />
                {choice}
              </label>
            ))}
          </span>
        )
      }
      case 'number':
      case 'duration':
        if (measure === null) {
          return <p className="text-sm text-danger">This question records no unit, so no figure can be given for it. Give it a unit or a mapping in the question set.</p>
        }
        return (
          <TracedInput
            label={label}
            path={path ?? undefined}
            value={answer?.traced ?? null}
            {...(measure.money === true ? { currency, per: measure.per } : { unit: measure.unit })}
            onChange={(next) => form.setAnswerTraced(sets, sessionIndex, question, next)}
            onPendingChange={(pending) => form.setPending(`discovery.${sessionIndex}.answers.${question.id}`, pending)}
          />
        )
    }
  }

  const traced = question.kind === 'number' || question.kind === 'duration'

  return (
    <li className="border-b py-2 last:border-b-0">
      <div className="flex flex-wrap items-baseline gap-x-2">
        {/* A traced row carries its own label, so this one is for the eye only. */}
        <label htmlFor={traced ? undefined : id} className="text-sm">
          {label}
          {question.required ? <span aria-hidden="true"> *</span> : null}
        </label>
        <span className="num text-xs text-muted">{question.kind}</span>
        {question.required ? <span className="sr-only">required</span> : null}
      </div>
      {question.helpText === undefined ? null : <p className="pb-0.5 text-xs text-muted">{question.helpText}</p>}
      <div className="pt-0.5">{control()}</div>
      {traced ? null : (
        <div id={describedBy} className="text-xs">
          {issues.length === 0 ? null : (
            <ul role="alert" className="pt-0.5 text-danger">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {/* A traced control writes its own issues under itself, but the answer's other rules land here. */}
      {traced && issues.length > 0 ? (
        <ul role="alert" className="pt-0.5 text-xs text-danger">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}
      <MappingNote form={form} question={question} />
      <div className="flex flex-wrap items-center gap-x-4">
        <FlagToggles answer={answer} name={label} onToggle={(flag, on) => form.toggleAnswerFlag(sets, sessionIndex, question, flag, on)} />
        {answer === undefined ? null : (
          <button type="button" className={`${BUTTON} mt-1`} onClick={() => form.clearAnswer(sets, sessionIndex, question)}>
            Clear answer
          </button>
        )}
      </div>
    </li>
  )
}

function HiddenQuestions({ states }: { states: readonly QuestionState[] }) {
  if (states.length === 0) return null
  const kept = states.filter((state) => state.answer !== undefined)
  return (
    <div className="border-t px-4 py-2 text-xs text-muted">
      <p>
        <span className="num">{states.length}</span> {states.length === 1 ? 'question is' : 'questions are'} hidden by the answers so far. A hidden question
        counts towards nothing.
      </p>
      {kept.length === 0 ? null : (
        <ul className="pt-1">
          {kept.map((state) => (
            <li key={state.question.id}>
              {state.question.text} — <span className="num">{describeValue(state.answer)}</span>, kept
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function describeValue(answer: Answer | undefined): string {
  if (answer === undefined) return 'no answer'
  const { value } = answer
  if (answer.traced !== undefined) return formatTraced(answer.traced)
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

function SessionHeader({ form, index, session, set }: { form: EngagementFormView; index: number; session: DiscoverySession; set: QuestionSet | undefined }) {
  const heldId = useId()
  const attendeesId = useId()
  const [other, setOther] = useState('')
  const contacts = form.draft.contacts.map((contact) => contact.name).filter((name) => name !== '')
  // Anyone recorded who is not a contact still shows, so they can be unticked.
  const names = [...contacts, ...session.attendees.filter((name) => !contacts.includes(name))]
  const toggle = (name: string, on: boolean) =>
    form.setAttendees(index, on ? [...session.attendees, name] : session.attendees.filter((candidate) => candidate !== name))

  return (
    <div className="border-b px-4 py-2">
      <Field label="Held at" htmlFor={heldId} issues={form.issuesAt(`discovery.${index}.heldAt`)} required>
        <input
          id={heldId}
          type="datetime-local"
          data-config-path={`discovery.${index}.heldAt`}
          value={localDateTime(new Date(session.heldAt))}
          onChange={(event) => {
            const held = fromLocalDateTime(event.target.value)
            if (held !== null) form.setText(`discovery.${index}.heldAt`, held)
          }}
          aria-describedby={fieldDescriptionId(heldId)}
          className={`${CONTROL} num`}
        />
      </Field>
      <Field label="Attendees" htmlFor={attendeesId} issues={form.issuesAt(`discovery.${index}.attendees`)}>
        <div id={attendeesId} data-config-path={`discovery.${index}.attendees`} className="flex flex-wrap items-center gap-x-4 gap-y-0.5 pt-1 text-sm">
          {names.length === 0 ? <span className="text-muted">Nobody recorded yet.</span> : null}
          {names.map((name) => (
            <label key={name} className="flex items-center gap-1.5">
              <input type="checkbox" checked={session.attendees.includes(name)} onChange={(event) => toggle(name, event.target.checked)} />
              {name}
            </label>
          ))}
          <span className="flex items-center gap-1.5">
            <input
              type="text"
              autoComplete="off"
              aria-label="Someone else who was there"
              placeholder="Someone else"
              value={other}
              onChange={(event) => setOther(event.target.value)}
              className={`${CONTROL} w-40`}
            />
            <button
              type="button"
              className={BUTTON}
              disabled={other.trim() === '' || session.attendees.includes(other.trim())}
              onClick={() => {
                form.setAttendees(index, [...session.attendees, other.trim()])
                setOther('')
              }}
            >
              Add
            </button>
          </span>
        </div>
      </Field>
      {set === undefined ? null : (
        <p className="pt-1 text-xs text-muted">
          Running <span className="num">{set.name}</span>, a <span className="num">{session.kind}</span> set of <span className="num">{set.questions.length}</span>{' '}
          questions.
        </p>
      )}
    </div>
  )
}

function RawNotes({ form, index, session }: { form: EngagementFormView; index: number; session: DiscoverySession }) {
  const id = useId()
  const path = `discovery.${index}.rawNotes`
  return (
    <div className="border-t px-4 py-2">
      <Field label="Raw notes" htmlFor={id} hint="Anything said that no question asks for. Kept as typed, alongside the answers." issues={form.issuesAt(path)}>
        <textarea
          id={id}
          rows={4}
          data-config-path={path}
          value={session.rawNotes}
          onChange={(event) => form.setText(path, event.target.value)}
          aria-describedby={fieldDescriptionId(id)}
          className={`${CONTROL} h-auto w-full max-w-2xl py-1`}
        />
      </Field>
    </div>
  )
}

export interface SessionRunnerProps {
  form: EngagementFormView
  // The session as addressed.
  sessionId: string
  // Null when the stored Library is unusable.
  questionSets: readonly QuestionSet[] | null
}

// One discovery session, run question by question. Answers land on the engagement as they are given;
// the save bar above stores them.
export function SessionRunner({ form, sessionId, questionSets }: SessionRunnerProps) {
  const index = form.draft.discovery.findIndex((session) => session.id === sessionId)
  const session = form.draft.discovery[index]
  const back = hrefFor({ name: 'engagement', id: form.saved.id, tab: 'discovery' })

  if (session === undefined) {
    return (
      <p className="px-4 py-3 text-sm">
        This engagement has no session <span className="num">{sessionId}</span>.{' '}
        <a href={back} className="text-fg underline">
          Back to its sessions
        </a>
        .
      </p>
    )
  }

  const sets = questionSets ?? []
  const set = sessionSetOf(sets, session)
  const states = set === undefined ? [] : questionStates(set, session.answers)
  const shown = states.filter((state) => state.visible)
  const complete = completeness(states)
  const answerIndex = (questionId: string) => session.answers.findIndex((answer) => answer.questionId === questionId)
  const issuesUnder = (prefix: string) => form.issues.filter((issue) => issue.path === prefix || issue.path.startsWith(`${prefix}.`)).map((issue) => issue.message)

  return (
    <section aria-label={`Discovery session ${set?.name ?? session.questionSetId}`}>
      <header className="flex h-8 flex-wrap items-center gap-3 border-b px-4">
        <a href={back} className="text-sm text-muted underline hover:text-fg">
          ← Sessions
        </a>
        <h2 className="text-sm font-medium">{set?.name ?? `Set ${session.questionSetId}`}</h2>
        <span className="text-sm text-muted">
          <span className="num">{session.completeness}%</span> complete
          <span className="text-xs">
            {' · '}
            <span className="num">{complete.answered}</span> of <span className="num">{complete.required}</span> required answered
          </span>
        </span>
      </header>

      {set === undefined ? (
        <p className="border-b px-4 py-2 text-sm">
          The question set <span className="num">{session.questionSetId}</span> is no longer in the Library, so this session cannot be answered further. What
          was said is kept, listed by question id.
        </p>
      ) : null}

      <SessionHeader form={form} index={index} session={session} set={set} />

      {set === undefined ? (
        <ul className="px-4 py-2 text-sm">
          {session.answers.length === 0 ? <li className="text-muted">Nothing was answered.</li> : null}
          {session.answers.map((answer, at) => (
            <li key={answer.id} className="border-b py-1 last:border-b-0" data-config-path={`discovery.${index}.answers.${at}`}>
              <span className="num text-xs text-muted">{answer.questionId}</span> — <span className="num">{describeValue(answer)}</span>
              {answer.flags.length === 0 ? null : <span className="num text-xs text-muted"> · {answer.flags.join(', ')}</span>}
              {issuesUnder(`discovery.${index}.answers.${at}`).map((issue) => (
                <span key={issue} role="alert" className="pl-2 text-xs text-danger">
                  {issue}
                </span>
              ))}
            </li>
          ))}
        </ul>
      ) : (
        <ol className="px-4">
          {shown.map((state) => {
            const at = answerIndex(state.question.id)
            const path = at < 0 ? null : `discovery.${index}.answers.${at}`
            return (
              <QuestionRow
                key={state.question.id}
                form={form}
                sets={sets}
                sessionIndex={index}
                state={state}
                path={path}
                issues={path === null ? [] : issuesUnder(path)}
                currency={form.draft.company.currency}
              />
            )
          })}
        </ol>
      )}

      <HiddenQuestions states={states.filter((state) => !state.visible)} />
      <RawNotes form={form} index={index} session={session} />
    </section>
  )
}
