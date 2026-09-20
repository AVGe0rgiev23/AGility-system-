import { useId, useState } from 'react'
import { appliesToCompany, newSession } from '../../../hooks/discovery-rules'
import { sessionSetOf, type EngagementFormView } from '../../../hooks/use-engagement-form'
import type { DiscoverySession, QuestionSet } from '../../../schema/discovery'
import { fromLocalDateTime, localDateTime } from '../../format'
import { Field, fieldDescriptionId } from '../../primitives/field'
import { Table } from '../../primitives/table'
import { hrefFor } from '../../shell/router'
import { BUTTON, CONTROL, FormList, FormSection, PRIMARY, RowActions } from '../form-controls'

export interface NewSessionDraft {
  questionSetId: string
  // As a datetime-local box holds it: local wall-clock time, to the minute.
  heldAt: string
  attendees: readonly string[]
}

// Sets meant for this company come first, so the one to run is the one at the top.
export function orderedSets(sets: readonly QuestionSet[], form: EngagementFormView): { set: QuestionSet; suited: boolean }[] {
  const company = form.draft.company
  return sets
    .map((set) => ({ set, suited: appliesToCompany(set, company) }))
    .sort((left, right) => (left.suited === right.suited ? 0 : left.suited ? -1 : 1))
}

export function initialNewSession(sets: readonly QuestionSet[], form: EngagementFormView, now: Date): NewSessionDraft {
  return { questionSetId: orderedSets(sets, form)[0]?.set.id ?? '', heldAt: localDateTime(now), attendees: [] }
}

export interface NewSessionFormProps {
  draft: NewSessionDraft
  sets: readonly { set: QuestionSet; suited: boolean }[]
  // The people already on the engagement, to tick rather than type.
  contacts: readonly string[]
  issue: string | null
  onDraft: (draft: NewSessionDraft) => void
  onStart: () => void
  onCancel: () => void
}

export function NewSessionForm({ draft, sets, contacts, issue, onDraft, onStart, onCancel }: NewSessionFormProps) {
  const setId = useId()
  const heldId = useId()
  const attendeesId = useId()
  const suited = sets.filter((candidate) => candidate.suited)
  const others = sets.filter((candidate) => !candidate.suited)
  const options = (group: readonly { set: QuestionSet }[]) =>
    group.map(({ set }) => (
      <option key={set.id} value={set.id}>
        {set.name}
      </option>
    ))
  const toggle = (name: string, on: boolean) => onDraft({ ...draft, attendees: on ? [...draft.attendees, name] : draft.attendees.filter((candidate) => candidate !== name) })

  return (
    <section aria-labelledby="new-session-heading" className="border-b px-4 py-3">
      <h2 id="new-session-heading" className="pb-1 text-sm font-medium">
        New discovery session
      </h2>
      <Field label="Question set" htmlFor={setId} hint="Sets that apply to this company are listed first." issues={issue === null ? [] : [issue]} required>
        <select
          id={setId}
          data-config-path="questionSetId"
          value={draft.questionSetId}
          onChange={(event) => onDraft({ ...draft, questionSetId: event.target.value })}
          aria-invalid={issue !== null}
          aria-describedby={fieldDescriptionId(setId)}
          className={`${CONTROL} max-w-full ${issue === null ? '' : 'border-danger'}`}
        >
          {suited.length === 0 || others.length === 0 ? (
            options(sets)
          ) : (
            <>
              <optgroup label="Suits this company">{options(suited)}</optgroup>
              <optgroup label="Other sets">{options(others)}</optgroup>
            </>
          )}
        </select>
      </Field>
      <Field label="Held at" htmlFor={heldId} required>
        <input
          id={heldId}
          type="datetime-local"
          data-config-path="heldAt"
          value={draft.heldAt}
          onChange={(event) => onDraft({ ...draft, heldAt: event.target.value })}
          aria-describedby={fieldDescriptionId(heldId)}
          className={`${CONTROL} num`}
        />
      </Field>
      <Field label="Attendees" htmlFor={attendeesId} hint="Who was in the room. Everything said is attributed to the session, not to one person." layout="row">
        <div id={attendeesId} data-config-path="attendees" className="flex flex-wrap gap-x-4 gap-y-0.5 pt-1 text-sm">
          {contacts.length === 0 ? (
            <span className="text-muted">This engagement has no contacts yet.</span>
          ) : (
            contacts.map((name) => (
              <label key={name} className="flex items-center gap-1.5">
                <input type="checkbox" checked={draft.attendees.includes(name)} onChange={(event) => toggle(name, event.target.checked)} />
                {name}
              </label>
            ))
          )}
        </div>
      </Field>
      <div className="flex gap-2 pt-2">
        <button type="button" className={PRIMARY} onClick={onStart}>
          Start session
        </button>
        <button type="button" className={BUTTON} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  )
}

interface SessionRow {
  session: DiscoverySession
  index: number
  set: QuestionSet | undefined
  problems: number
}

export interface DiscoveryTabProps {
  form: EngagementFormView
  // Null when the stored Library is unusable, so no session can be started from it.
  questionSets: readonly QuestionSet[] | null
  panel: React.ReactNode
  onNew: () => void
}

// The sessions held for this engagement. Each opens in the runner; the answers themselves live there.
export function DiscoveryTabScreen({ form, questionSets, panel, onNew }: DiscoveryTabProps) {
  const sessions = form.draft.discovery
  const sets = questionSets ?? []
  const rows: SessionRow[] = sessions.map((session, index) => ({
    session,
    index,
    set: sessionSetOf(sets, session),
    // Everything about a session's answers is fixed in the runner, so the row only counts it.
    problems: form.issues.filter((issue) => issue.path.startsWith(`discovery.${index}.`)).length,
  }))
  const nameOf = (row: SessionRow) => row.set?.name ?? `session ${row.index + 1}`

  return (
    <FormSection id="engagement-discovery" title="Discovery">
      <FormList
        form={form}
        path="discovery"
        title="Sessions"
        hint="A session is held against a question set. Answers land on the engagement as they are given, and are stored on Save."
        addLabel="New session"
        onAdd={onNew}
      >
        {questionSets === null ? (
          <p className="pt-1 text-sm text-muted">The stored Library is unusable, so no question set can be run. The store notice above lists why.</p>
        ) : questionSets.length === 0 ? (
          <p className="pt-1 text-sm text-muted">
            The Library has no question sets yet.{' '}
            <a href={hrefFor({ name: 'question-sets' })} className="text-fg underline">
              Add the standard ones
            </a>
            .
          </p>
        ) : null}
        {panel}
        <div className="overflow-x-auto">
          <Table
            caption="Discovery sessions"
            columns={[
              {
                id: 'set',
                header: 'Question set',
                cell: (row) => (
                  <a
                    href={hrefFor({ name: 'engagement', id: form.saved.id, tab: 'discovery', item: row.session.id })}
                    className="text-fg underline decoration-border underline-offset-2 hover:decoration-fg"
                  >
                    {row.set?.name ?? `Set ${row.session.questionSetId}`}
                  </a>
                ),
              },
              { id: 'kind', header: 'Kind', cell: (row) => <span className="num">{row.session.kind}</span> },
              {
                id: 'held',
                header: 'Held at',
                cell: (row) => (
                  <span className="num text-muted" title={row.session.heldAt}>
                    {localDateTime(new Date(row.session.heldAt)).replace('T', ' ')}
                  </span>
                ),
                sortValue: (row) => row.session.heldAt,
              },
              {
                id: 'completeness',
                header: 'Complete',
                numeric: true,
                cell: (row) => (
                  <span className="num" title={row.set === undefined ? 'The question set is gone, so this is what it was when last answered' : undefined}>
                    {row.session.completeness}%
                  </span>
                ),
                sortValue: (row) => row.session.completeness,
              },
              { id: 'answers', header: 'Answers', numeric: true, cell: (row) => row.session.answers.length },
              {
                id: 'problems',
                header: 'Problems',
                numeric: true,
                cell: (row) =>
                  row.problems === 0 ? <span className="text-muted">—</span> : <span className="num text-danger">{row.problems}</span>,
              },
              {
                id: 'actions',
                header: '',
                cell: (row) => <RowActions name={nameOf(row)} index={row.index} count={rows.length} onRemove={() => form.removeSession(row.index)} />,
              },
            ]}
            rows={rows}
            rowKey={(row) => row.session.id}
            empty="No sessions yet"
          />
        </div>
      </FormList>
    </FormSection>
  )
}

// Holds the new-session panel; every answer lives in the engagement form.
export function DiscoveryTab({ form, questionSets }: { form: EngagementFormView; questionSets: readonly QuestionSet[] | null }) {
  const [draft, setDraft] = useState<NewSessionDraft | null>(null)
  const [issue, setIssue] = useState<string | null>(null)
  const sets = questionSets ?? []

  const start = () => {
    const set = sets.find((candidate) => candidate.id === draft?.questionSetId)
    if (draft === null) return
    if (set === undefined) {
      setIssue('Choose a question set to run')
      return
    }
    const heldAt = fromLocalDateTime(draft.heldAt)
    if (heldAt === null) {
      setIssue('A session is held at a date and time')
      return
    }
    form.addSession(newSession(crypto.randomUUID(), set, heldAt, draft.attendees))
    setDraft(null)
    setIssue(null)
  }

  return (
    <DiscoveryTabScreen
      form={form}
      questionSets={questionSets}
      onNew={() => {
        setIssue(null)
        setDraft(initialNewSession(sets, form, new Date()))
      }}
      panel={
        draft === null ? null : (
          <NewSessionForm
            draft={draft}
            sets={orderedSets(sets, form)}
            contacts={form.draft.contacts.map((contact) => contact.name).filter((name) => name !== '')}
            issue={issue}
            onDraft={setDraft}
            onStart={start}
            onCancel={() => {
              setDraft(null)
              setIssue(null)
            }}
          />
        )
      }
    />
  )
}
