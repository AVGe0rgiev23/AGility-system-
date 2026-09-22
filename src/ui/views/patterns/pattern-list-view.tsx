import { useId, useState, type ReactNode } from 'react'
import { missingSeedPatterns, newPattern, patternUsage, withoutPattern, withPattern, withSeedPatterns } from '../../../hooks/pattern-library'
import { numberWarnings } from '../../../hooks/form-paths'
import { VALUE_REQUIRED, parseNumberText } from '../../../hooks/use-traced-draft'
import type { ActionResult, BootedStore } from '../../../hooks/use-store'
import type { Engagement } from '../../../schema/engagement'
import type { Library } from '../../../schema/library'
import type { StoreProblem } from '../../../storage/repository'
import { Field, fieldDescriptionId } from '../../primitives/field'
import { NumberInput } from '../../primitives/number-input'
import { Table } from '../../primitives/table'
import { hrefFor, navigate } from '../../shell/router'
import { BUTTON, CONTROL, PRIMARY } from '../form-controls'

type LoadedStore = Extract<BootedStore, { phase: 'loaded' }>

export interface NewPatternDraft {
  name: string
  baseHoursText: string
}

export function NewPatternForm({
  draft,
  nameIssue,
  creating,
  onDraft,
  onCreate,
  onCancel,
}: {
  draft: NewPatternDraft
  nameIssue: string | null
  creating: boolean
  onDraft: (draft: NewPatternDraft) => void
  onCreate: () => void
  onCancel: () => void
}) {
  const nameId = useId()
  const parsed = parseNumberText(draft.baseHoursText)
  const baseHoursIssue = parsed.kind === 'invalid' ? parsed.message : parsed.kind === 'empty' ? VALUE_REQUIRED : parsed.kind === 'number' && parsed.value <= 0 ? 'Base hours must be greater than 0' : null
  return (
    <section aria-labelledby="new-pattern-heading" className="border-b px-4 py-3">
      <h2 id="new-pattern-heading" className="pb-1 text-sm font-medium">
        New pattern
      </h2>
      <Field label="Name" htmlFor={nameId} issues={nameIssue === null ? [] : [nameIssue]} required>
        <input
          id={nameId}
          type="text"
          autoComplete="off"
          data-config-path="name"
          value={draft.name}
          onChange={(event) => onDraft({ ...draft, name: event.target.value })}
          aria-invalid={nameIssue !== null}
          aria-required="true"
          aria-describedby={fieldDescriptionId(nameId)}
          className={`${CONTROL} w-72 max-w-full ${nameIssue === null ? '' : 'border-danger'}`}
        />
      </Field>
      <NumberInput
        label="Base hours"
        path="baseHours"
        text={draft.baseHoursText}
        unit="hours"
        hint="Uncalibrated. What this pattern typically takes to build, before overheads and contingency."
        warnings={numberWarnings(draft.baseHoursText)}
        issues={draft.baseHoursText === '' ? [] : baseHoursIssue === null ? [] : [baseHoursIssue]}
        required
        onText={(text) => onDraft({ ...draft, baseHoursText: text })}
      />
      <div className="flex gap-2 pt-2">
        <button type="button" className={PRIMARY} disabled={creating} onClick={onCreate}>
          {creating ? 'Creating…' : 'Create pattern'}
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

export interface PatternListScreenProps {
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

export function PatternListScreen({ library, libraryProblems, engagements, missingSeeds, addingSeeds, actionError, onAddSeeds, onNew, panel, deletion }: PatternListScreenProps) {
  if (library === null) {
    return (
      <section aria-labelledby="page-heading">
        <header className="flex h-10 items-center border-b px-4">
          <h1 id="page-heading" className="text-base font-medium">
            Patterns
          </h1>
        </header>
        {libraryProblems.map((problem) => (
          <p key={problem.key} className="px-4 py-3 text-sm">
            {problem.message}
          </p>
        ))}
        <p className="px-4 pb-3 text-sm text-muted">Patterns cannot be edited until a Library is saved, imported or restored. The store notice above lists every issue.</p>
      </section>
    )
  }

  const rows = library.patterns.map((pattern) => ({ pattern, used: patternUsage(engagements, pattern.id) }))
  const confirming = rows.find((row) => row.pattern.id === deletion.id)

  return (
    <section aria-labelledby="page-heading">
      <header className="flex h-10 items-center gap-3 border-b px-4">
        <h1 id="page-heading" className="text-base font-medium">
          Patterns
        </h1>
        <span className="text-sm text-muted">
          <span className="num">{rows.length}</span> in the Library
        </span>
        {missingSeeds === 0 ? null : (
          <button type="button" className={`${BUTTON} ml-auto`} disabled={addingSeeds} onClick={onAddSeeds}>
            {addingSeeds ? 'Adding…' : `Add the standard patterns (${missingSeeds})`}
          </button>
        )}
        <button type="button" className={`${PRIMARY} ${missingSeeds === 0 ? 'ml-auto' : ''}`} disabled={panel !== null} onClick={onNew}>
          New pattern
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
          <p className="text-sm">Delete {confirming.pattern.name}? It is removed from the Library.</p>
          {deletion.error === null ? null : (
            <p role="alert" className="pt-1 text-sm text-danger">
              The pattern was not deleted: {deletion.error}
            </p>
          )}
          <div className="flex gap-2 pt-2">
            <button type="button" className={BUTTON} disabled={deletion.deleting} onClick={deletion.onConfirm}>
              {deletion.deleting ? 'Deleting…' : `Delete ${confirming.pattern.name}`}
            </button>
            <button type="button" className={BUTTON} disabled={deletion.deleting} onClick={deletion.onCancel}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto px-4">
        <Table
          caption="Patterns"
          columns={[
            {
              id: 'name',
              header: 'Name',
              cell: ({ pattern }) => (
                <a href={hrefFor({ name: 'pattern', id: pattern.id })} className="text-fg underline decoration-border underline-offset-2 hover:decoration-fg">
                  {pattern.name}
                </a>
              ),
            },
            { id: 'category', header: 'Category', cell: ({ pattern }) => <span className="text-muted">{pattern.category}</span> },
            { id: 'complexity', header: 'Complexity', cell: ({ pattern }) => <span className="num">{pattern.complexity}</span> },
            { id: 'baseHours', header: 'Base hours', numeric: true, cell: ({ pattern }) => pattern.baseHours },
            { id: 'used', header: 'Used by', numeric: true, cell: ({ used }) => used },
            {
              id: 'actions',
              header: '',
              cell: ({ pattern, used }) => (
                <button
                  type="button"
                  className={BUTTON}
                  disabled={used > 0}
                  title={used > 0 ? `${used} ${used === 1 ? 'opportunity links' : 'opportunities link'} this pattern, so it cannot be deleted` : undefined}
                  onClick={() => deletion.onAsk(pattern.id)}
                  aria-label={`Delete ${pattern.name}`}
                >
                  Delete…
                </button>
              ),
            },
          ]}
          rows={rows}
          rowKey={({ pattern }) => pattern.id}
          empty="No patterns. Add the standard ones, or create your own."
        />
      </div>
    </section>
  )
}

export function PatternListView({ loaded, saveLibrary }: { loaded: LoadedStore; saveLibrary: (library: Library) => Promise<ActionResult> }) {
  const { library, engagements } = loaded.load.store
  const [draft, setDraft] = useState<NewPatternDraft | null>(null)
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
    const parsed = parseNumberText(draft.baseHoursText)
    if (parsed.kind !== 'number' || parsed.value <= 0) return
    setCreating(true)
    setActionError(null)
    const id = `pat-${crypto.randomUUID().slice(0, 8)}`
    const result = await saveLibrary(withPattern(library, newPattern(id, draft.name, parsed.value)))
    setCreating(false)
    if (result.ok) navigate({ name: 'pattern', id })
    else setActionError(`The pattern was not created: ${result.message}`)
  }

  const addSeeds = async () => {
    if (library === null) return
    setAddingSeeds(true)
    setActionError(null)
    const result = await saveLibrary(withSeedPatterns(library))
    setAddingSeeds(false)
    if (!result.ok) setActionError(`The standard patterns were not added: ${result.message}`)
  }

  const remove = async () => {
    if (library === null || deleteId === null) return
    setDeleting(true)
    setDeleteError(null)
    const result = await saveLibrary(withoutPattern(library, deleteId))
    setDeleting(false)
    if (result.ok) setDeleteId(null)
    else setDeleteError(result.message)
  }

  return (
    <PatternListScreen
      library={library}
      libraryProblems={loaded.load.problems.filter((problem) => problem.table === 'library')}
      engagements={engagements}
      missingSeeds={library === null ? 0 : missingSeedPatterns(library).length}
      addingSeeds={addingSeeds}
      actionError={actionError}
      onAddSeeds={() => void addSeeds()}
      onNew={() => {
        setDraft({ name: '', baseHoursText: '' })
        setAttempted(false)
      }}
      panel={
        draft === null ? null : (
          <NewPatternForm
            draft={draft}
            nameIssue={attempted && draft.name.trim() === '' ? 'A pattern needs a name' : null}
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
