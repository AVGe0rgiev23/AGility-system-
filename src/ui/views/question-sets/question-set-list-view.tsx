import { useId, useState, type ReactNode } from 'react'
import { missingSeedQuestionSets, newQuestionSet, sessionsUsing, withoutQuestionSet, withQuestionSet, withSeedQuestionSets } from '../../../hooks/question-set-library'
import type { ActionResult, BootedStore } from '../../../hooks/use-store'
import { DiscoverySessionSchema, type QuestionSet } from '../../../schema/discovery'
import type { Engagement } from '../../../schema/engagement'
import type { Library } from '../../../schema/library'
import type { StoreProblem } from '../../../storage/repository'
import { Field, fieldDescriptionId } from '../../primitives/field'
import { Table } from '../../primitives/table'
import { hrefFor, navigate } from '../../shell/router'
import { BUTTON, CONTROL, PRIMARY } from '../form-controls'

type LoadedStore = Extract<BootedStore, { phase: 'loaded' }>

const SESSION_KINDS = DiscoverySessionSchema.shape.kind.options

export function appliesToText(set: QuestionSet): string {
  const industries = set.appliesTo.industries ?? []
  const parts = [industries.length === 0 ? 'every industry' : industries.join(', ')]
  if (set.appliesTo.minEmployees !== undefined) parts.push(`${set.appliesTo.minEmployees}+ employees`)
  return parts.join(' · ')
}

export interface NewQuestionSetDraft {
  name: string
  kind: QuestionSet['kind']
}

export function NewQuestionSetForm({ draft, issue, creating, onDraft, onCreate, onCancel }: { draft: NewQuestionSetDraft; issue: string | null; creating: boolean; onDraft: (draft: NewQuestionSetDraft) => void; onCreate: () => void; onCancel: () => void }) {
  const nameId = useId()
  const kindId = useId()
  return (
    <section aria-labelledby="new-question-set-heading" className="border-b px-4 py-3">
      <h2 id="new-question-set-heading" className="pb-1 text-sm font-medium">
        New question set
      </h2>
      <Field label="Name" htmlFor={nameId} issues={issue === null ? [] : [issue]} required>
        <input
          id={nameId}
          type="text"
          autoComplete="off"
          data-config-path="name"
          value={draft.name}
          onChange={(event) => onDraft({ ...draft, name: event.target.value })}
          aria-invalid={issue !== null}
          aria-required="true"
          aria-describedby={fieldDescriptionId(nameId)}
          className={`${CONTROL} w-72 max-w-full ${issue === null ? '' : 'border-danger'}`}
        />
      </Field>
      <Field label="Kind" htmlFor={kindId} required>
        <select
          id={kindId}
          data-config-path="kind"
          value={draft.kind}
          onChange={(event) => onDraft({ ...draft, kind: SESSION_KINDS.find((kind) => kind === event.target.value) ?? draft.kind })}
          aria-describedby={fieldDescriptionId(kindId)}
          className={`${CONTROL} num`}
        >
          {SESSION_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {kind}
            </option>
          ))}
        </select>
      </Field>
      <div className="flex gap-2 pt-2">
        <button type="button" className={PRIMARY} disabled={creating} onClick={onCreate}>
          {creating ? 'Creating…' : 'Create question set'}
        </button>
        <button type="button" className={BUTTON} disabled={creating} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  )
}

export interface Deletion {
  id: string | null
  deleting: boolean
  error: string | null
  onAsk: (id: string) => void
  onConfirm: () => void
  onCancel: () => void
}

export interface QuestionSetListScreenProps {
  library: Library | null
  // Why the stored Library did not load, when it did not.
  libraryProblems: readonly StoreProblem[]
  engagements: readonly Engagement[]
  missingSeeds: number
  addingSeeds: boolean
  actionError: string | null
  onAddSeeds: () => void
  onNew: () => void
  panel: ReactNode
  deletion: Deletion
}

export function QuestionSetListScreen({ library, libraryProblems, engagements, missingSeeds, addingSeeds, actionError, onAddSeeds, onNew, panel, deletion }: QuestionSetListScreenProps) {
  if (library === null) {
    return (
      <section aria-labelledby="page-heading">
        <header className="flex h-10 items-center border-b px-4">
          <h1 id="page-heading" className="text-base font-medium">
            Question sets
          </h1>
        </header>
        {libraryProblems.map((problem) => (
          <p key={problem.key} className="px-4 py-3 text-sm">
            {problem.message}
          </p>
        ))}
        <p className="px-4 pb-3 text-sm text-muted">
          Question sets cannot be edited until a Library is saved, imported or restored. The store notice above lists every issue.
        </p>
      </section>
    )
  }

  const rows = library.questionSets.map((set) => ({ set, sessions: sessionsUsing(engagements, set.id) }))
  const confirming = rows.find((row) => row.set.id === deletion.id)

  return (
    <section aria-labelledby="page-heading">
      <header className="flex h-10 items-center gap-3 border-b px-4">
        <h1 id="page-heading" className="text-base font-medium">
          Question sets
        </h1>
        <span className="text-sm text-muted">
          <span className="num">{rows.length}</span> in the Library
        </span>
        {missingSeeds === 0 ? null : (
          <button type="button" className={`${BUTTON} ml-auto`} disabled={addingSeeds} onClick={onAddSeeds}>
            {addingSeeds ? 'Adding…' : `Add the standard question sets (${missingSeeds})`}
          </button>
        )}
        <button type="button" className={`${PRIMARY} ${missingSeeds === 0 ? 'ml-auto' : ''}`} disabled={panel !== null} onClick={onNew}>
          New question set
        </button>
      </header>

      {panel}

      {actionError === null ? null : (
        <p role="alert" className="border-b px-4 py-2 text-sm text-danger">
          {actionError}
        </p>
      )}

      {confirming === undefined ? null : (
        <div role="group" aria-label="Confirm deletion" className="border-b px-4 py-3">
          <p className="text-sm">
            Delete {confirming.set.name}? It is removed from the Library. No session uses it, so no answers lose their questions.
          </p>
          {deletion.error === null ? null : (
            <p role="alert" className="pt-1 text-sm text-danger">
              The question set was not deleted: {deletion.error}
            </p>
          )}
          <div className="flex gap-2 pt-2">
            <button type="button" className={BUTTON} disabled={deletion.deleting} onClick={deletion.onConfirm}>
              {deletion.deleting ? 'Deleting…' : `Delete ${confirming.set.name}`}
            </button>
            <button type="button" className={BUTTON} disabled={deletion.deleting} onClick={deletion.onCancel}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto px-4">
        <Table
          caption="Question sets"
          columns={[
            {
              id: 'name',
              header: 'Name',
              cell: ({ set }) => (
                <a href={hrefFor({ name: 'question-set', id: set.id })} className="text-fg underline decoration-border underline-offset-2 hover:decoration-fg">
                  {set.name}
                </a>
              ),
            },
            { id: 'kind', header: 'Kind', cell: ({ set }) => <span className="num">{set.kind}</span> },
            { id: 'applies', header: 'Applies to', cell: ({ set }) => <span className="text-muted">{appliesToText(set)}</span> },
            { id: 'questions', header: 'Questions', numeric: true, cell: ({ set }) => set.questions.length },
            { id: 'sessions', header: 'Sessions', numeric: true, cell: ({ sessions }) => sessions },
            {
              id: 'actions',
              header: '',
              cell: ({ set, sessions }) => (
                <button
                  type="button"
                  className={BUTTON}
                  disabled={sessions > 0}
                  title={sessions > 0 ? `${sessions} ${sessions === 1 ? 'session uses' : 'sessions use'} this set, so it cannot be deleted` : undefined}
                  onClick={() => deletion.onAsk(set.id)}
                  aria-label={`Delete ${set.name}`}
                >
                  Delete…
                </button>
              ),
            },
          ]}
          rows={rows}
          rowKey={({ set }) => set.id}
          empty="No question sets. Add the standard ones, or create your own."
        />
      </div>
    </section>
  )
}

export function QuestionSetListView({ loaded, saveLibrary }: { loaded: LoadedStore; saveLibrary: (library: Library) => Promise<ActionResult> }) {
  const { library, engagements } = loaded.load.store
  const [draft, setDraft] = useState<NewQuestionSetDraft | null>(null)
  const [creating, setCreating] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [addingSeeds, setAddingSeeds] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const create = async () => {
    setAttempted(true)
    if (library === null || draft === null || draft.name.trim() === '') return
    setCreating(true)
    setActionError(null)
    const id = `qs-${crypto.randomUUID().slice(0, 8)}`
    const result = await saveLibrary(withQuestionSet(library, newQuestionSet(id, draft.name, draft.kind)))
    setCreating(false)
    if (result.ok) navigate({ name: 'question-set', id })
    else setActionError(`The question set was not created: ${result.message}`)
  }

  const addSeeds = async () => {
    if (library === null) return
    setAddingSeeds(true)
    setActionError(null)
    const result = await saveLibrary(withSeedQuestionSets(library))
    setAddingSeeds(false)
    if (!result.ok) setActionError(`The standard question sets were not added: ${result.message}`)
  }

  const remove = async () => {
    if (library === null || deleteId === null) return
    setDeleting(true)
    setDeleteError(null)
    const result = await saveLibrary(withoutQuestionSet(library, deleteId))
    setDeleting(false)
    if (result.ok) setDeleteId(null)
    else setDeleteError(result.message)
  }

  return (
    <QuestionSetListScreen
      library={library}
      libraryProblems={loaded.load.problems.filter((problem) => problem.table === 'library')}
      engagements={engagements}
      missingSeeds={library === null ? 0 : missingSeedQuestionSets(library).length}
      addingSeeds={addingSeeds}
      actionError={actionError}
      onAddSeeds={() => void addSeeds()}
      onNew={() => {
        setDraft({ name: '', kind: 'discovery' })
        setAttempted(false)
      }}
      panel={
        draft === null ? null : (
          <NewQuestionSetForm
            draft={draft}
            issue={attempted && draft.name.trim() === '' ? 'A question set needs a name' : null}
            creating={creating}
            onDraft={setDraft}
            onCreate={() => void create()}
            onCancel={() => setDraft(null)}
          />
        )
      }
      deletion={{
        id: deleteId,
        deleting,
        error: deleteError,
        onAsk: (id) => {
          setDeleteId(id)
          setDeleteError(null)
        },
        onConfirm: () => void remove(),
        onCancel: () => {
          setDeleteId(null)
          setDeleteError(null)
        },
      }}
    />
  )
}
