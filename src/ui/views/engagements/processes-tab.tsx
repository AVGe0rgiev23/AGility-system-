import { useId, useState, type ReactNode } from 'react'
import {
  carriesProcessFigures,
  initialProcessDraft,
  processDraftFromSession,
  processDraftIssues,
  processFromDraft,
  processRemovalBlock,
  processUsage,
  type NewProcessDraft,
} from '../../../hooks/process-rules'
import { sessionSetOf, type EngagementFormView } from '../../../hooks/use-engagement-form'
import type { FormIssue } from '../../../hooks/form-paths'
import type { QuestionSet } from '../../../schema/discovery'
import { ProcessSchema, type Process } from '../../../schema/process'
import type { Currency } from '../../../schema/traced'
import { localDateTime } from '../../format'
import { Field, fieldDescriptionId } from '../../primitives/field'
import { InlineStat } from '../../primitives/inline-stat'
import { Table } from '../../primitives/table'
import { hrefFor, navigate } from '../../shell/router'
import { BUTTON, CONTROL, FormList, FormSection, PRIMARY, RowActions } from '../form-controls'
import { FigureInput } from './figure-input'

const REVENUE_IMPACTS = ProcessSchema.shape.revenueImpact.options

export interface SessionChoice {
  id: string
  label: string
}

export interface NewProcessPanelProps {
  draft: NewProcessDraft
  currency: Currency
  // Sessions that carry at least one process answer.
  sessions: readonly SessionChoice[]
  // Shown once creating has been tried, so an empty panel does not open already refused.
  issues: readonly FormIssue[]
  onDraft: (draft: NewProcessDraft) => void
  onSession: (sessionId: string) => void
  onPending: (path: string, pending: boolean) => void
  onCreate: () => void
  onCancel: () => void
}

export function NewProcessPanel({ draft, currency, sessions, issues, onDraft, onSession, onPending, onCreate, onCancel }: NewProcessPanelProps) {
  const sessionId = useId()
  const nameId = useId()
  const ownerId = useId()
  const impactId = useId()
  const at = (path: string) => issues.filter((issue) => issue.path === path).map((issue) => issue.message)
  const edit = (patch: Partial<NewProcessDraft>) => onDraft({ ...draft, ...patch })
  const impactIssues = at('revenueImpact')

  // A required figure is given, or named as missing under its own row: TracedInput shows only what
  // its own text refuses, and an untouched empty field refuses nothing.
  const figure = (field: 'occurrencesPerMonth' | 'minutesPerOccurrence' | 'peopleInvolved', label: string, hint?: string) => (
    <div>
      <FigureInput
        field={field}
        label={label}
        hint={hint}
        path={field}
        value={draft[field]}
        currency={currency}
        required
        onChange={(next) => edit({ [field]: next })}
        onPendingChange={(pending) => onPending(field, pending)}
      />
      {at(field).map((message) => (
        <p key={message} role="alert" className="pl-[11.75rem] text-xs text-danger">
          {message}
        </p>
      ))}
    </div>
  )

  return (
    <section aria-labelledby="new-process-heading" className="border-b px-4 py-3">
      <h2 id="new-process-heading" className="pb-1 text-sm font-medium">
        New process
      </h2>

      <Field
        label="Start from a session"
        htmlFor={sessionId}
        hint={
          sessions.length === 0
            ? 'No discovery session has answered a process question yet, so there is nothing to carry over.'
            : 'Carries each figure the client gave, with where it came from. The name and steps are still yours to write.'
        }
      >
        <select
          id={sessionId}
          data-config-path="fromSessionId"
          value={draft.fromSessionId ?? ''}
          onChange={(event) => onSession(event.target.value)}
          aria-describedby={fieldDescriptionId(sessionId)}
          className={`${CONTROL} max-w-full`}
        >
          <option value="">not from a session</option>
          {sessions.map((session) => (
            <option key={session.id} value={session.id}>
              {session.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Name" htmlFor={nameId} issues={at('name')} required hint="What the client does today, such as 'Quote request to CRM entry'.">
        <input
          id={nameId}
          type="text"
          autoComplete="off"
          spellCheck={false}
          data-config-path="name"
          value={draft.name}
          onChange={(event) => edit({ name: event.target.value })}
          aria-invalid={at('name').length > 0}
          aria-describedby={fieldDescriptionId(nameId)}
          className={`${CONTROL} w-72 max-w-full ${at('name').length > 0 ? 'border-danger' : ''}`}
        />
      </Field>
      <Field label="Owner" htmlFor={ownerId} hint="Optional. A role, not a person.">
        <input
          id={ownerId}
          type="text"
          autoComplete="off"
          spellCheck={false}
          data-config-path="owner"
          value={draft.owner}
          onChange={(event) => edit({ owner: event.target.value })}
          aria-describedby={fieldDescriptionId(ownerId)}
          className={`${CONTROL} w-56 max-w-full`}
        />
      </Field>

      {/* Keyed by the session, so choosing another starts every figure again rather than mixing two. */}
      <div key={draft.fromSessionId ?? 'typed'}>
        {figure('occurrencesPerMonth', 'Runs per month')}
        {figure('minutesPerOccurrence', 'Minutes per run', 'Start to finish, for one run.')}
        {figure('peopleInvolved', 'People per run')}
        <FigureInput
          field="roleHourlyCost"
          label="Role hourly cost"
          path="roleHourlyCost"
          hint="Optional. Overrides the company's blended cost for this process."
          value={draft.roleHourlyCost}
          currency={currency}
          onChange={(next) => edit({ roleHourlyCost: next })}
          onPendingChange={(pending) => onPending('roleHourlyCost', pending)}
        />
        <FigureInput
          field="errorRatePercent"
          label="Error rate"
          path="errorRatePercent"
          hint="Optional. Out of every 100 runs, how many go wrong."
          value={draft.errorRatePercent}
          currency={currency}
          onChange={(next) => edit({ errorRatePercent: next })}
          onPendingChange={(pending) => onPending('errorRatePercent', pending)}
        />
        <FigureInput
          field="costPerError"
          label="Cost per error"
          path="costPerError"
          hint="Optional. What one mistake costs to put right."
          value={draft.costPerError}
          currency={currency}
          onChange={(next) => edit({ costPerError: next })}
          onPendingChange={(pending) => onPending('costPerError', pending)}
        />
      </div>

      <Field
        label="Revenue impact"
        htmlFor={impactId}
        issues={impactIssues}
        required
        hint="Direct: it wins or loses sales. Indirect: it slows the people who do. None: back office only."
      >
        <select
          id={impactId}
          data-config-path="revenueImpact"
          value={draft.revenueImpact}
          onChange={(event) => {
            const chosen = REVENUE_IMPACTS.find((option) => option === event.target.value)
            edit({ revenueImpact: chosen ?? '' })
          }}
          aria-invalid={impactIssues.length > 0}
          aria-describedby={fieldDescriptionId(impactId)}
          className={`${CONTROL} num ${impactIssues.length > 0 ? 'border-danger' : ''}`}
        >
          <option value="" disabled>
            choose
          </option>
          {REVENUE_IMPACTS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </Field>

      <div className="flex gap-2 pt-2">
        <button type="button" className={PRIMARY} onClick={onCreate}>
          Create process
        </button>
        <button type="button" className={BUTTON} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  )
}

interface ProcessRow {
  process: Process
  index: number
  used: number
  block: string | null
  problems: number
}

export interface ProcessesTabProps {
  form: EngagementFormView
  panel: ReactNode
  onNew: () => void
}

// The processes mapped for this engagement. Each opens in its own screen; what is on the row is what
// scoring will read, with where each figure came from.
export function ProcessesTabScreen({ form, panel, onNew }: ProcessesTabProps) {
  const opportunities = form.draft.opportunities
  const rows: ProcessRow[] = form.draft.processes.map((process, index) => ({
    process,
    index,
    used: processUsage(process.id, opportunities).length,
    block: processRemovalBlock(process.id, opportunities),
    // Everything about a process is fixed in its own screen, so the row only counts it.
    problems: form.issues.filter((issue) => issue.path.startsWith(`processes.${index}.`)).length,
  }))
  const nameOf = (row: ProcessRow) => (row.process.name === '' ? `process ${row.index + 1}` : `'${row.process.name}'`)

  return (
    <FormSection id="engagement-processes" title="Processes">
      <FormList
        form={form}
        path="processes"
        title="What the client does today"
        hint="Removing a process takes effect on Save; Discard brings it back. A process an opportunity is about cannot be removed."
        addLabel="New process"
        onAdd={onNew}
      >
        {panel}
        <div className="overflow-x-auto">
          <Table
            caption="Processes"
            columns={[
              {
                id: 'name',
                header: 'Process',
                cell: (row) => (
                  <a
                    href={hrefFor({ name: 'engagement', id: form.saved.id, tab: 'processes', item: row.process.id })}
                    className="text-fg underline decoration-border underline-offset-2 hover:decoration-fg"
                  >
                    {row.process.name === '' ? `Process ${row.index + 1}` : row.process.name}
                  </a>
                ),
              },
              { id: 'owner', header: 'Owner', cell: (row) => row.process.owner ?? <span className="text-muted">—</span> },
              { id: 'runs', header: 'Runs', cell: (row) => <InlineStat traced={row.process.frequency.occurrencesPerMonth} /> },
              { id: 'minutes', header: 'Each', cell: (row) => <InlineStat traced={row.process.frequency.minutesPerOccurrence} /> },
              { id: 'people', header: 'People', cell: (row) => <InlineStat traced={row.process.frequency.peopleInvolved} /> },
              { id: 'steps', header: 'Steps', numeric: true, cell: (row) => row.process.steps.length },
              { id: 'bottlenecks', header: 'Bottlenecks', numeric: true, cell: (row) => row.process.steps.filter((step) => step.isBottleneck).length },
              { id: 'pain', header: 'Pain points', numeric: true, cell: (row) => row.process.painPoints.length },
              {
                id: 'used',
                header: 'Used by',
                numeric: true,
                cell: (row) => (row.used === 0 ? <span className="text-muted">—</span> : <span title={row.block ?? undefined}>{row.used}</span>),
              },
              {
                id: 'problems',
                header: 'Problems',
                numeric: true,
                cell: (row) => (row.problems === 0 ? <span className="text-muted">—</span> : <span className="num text-danger">{row.problems}</span>),
              },
              {
                id: 'actions',
                header: '',
                cell: (row) => <RowActions name={nameOf(row)} index={row.index} count={rows.length} blocked={row.block} onRemove={() => form.removeProcess(row.index)} />,
              },
            ]}
            rows={rows}
            rowKey={(row) => row.process.id}
            empty="No processes yet"
          />
        </div>
      </FormList>
    </FormSection>
  )
}

// Holds the new-process panel; every process itself lives in the engagement form.
export function ProcessesTab({ form, questionSets }: { form: EngagementFormView; questionSets: readonly QuestionSet[] | null }) {
  const [draft, setDraft] = useState<NewProcessDraft | null>(null)
  const [tried, setTried] = useState(false)
  const [pending, setPending] = useState<readonly string[]>([])
  const sets = questionSets ?? []

  // Only sessions with a process answer to carry are offered, each named by the set it ran and when.
  const sessions: SessionChoice[] = form.draft.discovery.flatMap((session) => {
    const set = sessionSetOf(sets, session)
    if (set === undefined || !carriesProcessFigures(processDraftFromSession(session, set))) return []
    return [{ id: session.id, label: `${set.name} · ${localDateTime(new Date(session.heldAt)).replace('T', ' ')}` }]
  })

  const close = () => {
    setDraft(null)
    setTried(false)
    setPending([])
  }

  const chooseSession = (sessionId: string) => {
    if (draft === null) return
    // What was typed by hand stays; the figures are the session's, or none when it is cleared.
    const typed = { name: draft.name, description: draft.description, owner: draft.owner, customerFacing: draft.customerFacing }
    const session = form.draft.discovery.find((candidate) => candidate.id === sessionId)
    const set = session === undefined ? undefined : sessionSetOf(sets, session)
    const fresh = session === undefined || set === undefined ? initialProcessDraft() : processDraftFromSession(session, set)
    setDraft({ ...fresh, ...typed })
    // The figures are remounted, and a box that unmounts takes its half-typed text with it.
    setPending([])
  }

  const create = () => {
    if (draft === null) return
    setTried(true)
    if (pending.length > 0) return
    const process = processFromDraft(crypto.randomUUID(), draft)
    if (process === null) return
    form.addProcess(process)
    close()
    // Straight to the new process, where its steps, systems and pain points are added.
    navigate({ name: 'engagement', id: form.saved.id, tab: 'processes', item: process.id })
  }

  return (
    <ProcessesTabScreen
      form={form}
      onNew={() => {
        setTried(false)
        setPending([])
        setDraft(initialProcessDraft())
      }}
      panel={
        draft === null ? null : (
          <NewProcessPanel
            draft={draft}
            currency={form.draft.company.currency}
            sessions={sessions}
            issues={tried ? [...processDraftIssues(draft), ...pending.map((path) => ({ path, message: 'Finish or correct the figure being typed' }))] : []}
            onDraft={setDraft}
            onSession={chooseSession}
            onPending={(path, isPending) => setPending((current) => (isPending ? [...current.filter((existing) => existing !== path), path] : current.filter((existing) => existing !== path)))}
            onCreate={create}
            onCancel={close}
          />
        )
      }
    />
  )
}
