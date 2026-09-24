import { useId, useState, type ReactNode } from 'react'
import type { FormIssue } from '../../../hooks/form-paths'
import { rankingFor } from '../../../hooks/opportunity-ranking'
import {
  initialOpportunityDraft,
  opportunityDraftIssues,
  opportunityFromDraft,
  opportunityRemovalBlock,
  type NewOpportunityDraft,
} from '../../../hooks/process-rules'
import type { EngagementFormView } from '../../../hooks/use-engagement-form'
import type { Config } from '../../../schema/config'
import type { Pattern } from '../../../schema/library'
import { EffortInputsSchema } from '../../../schema/opportunity'
import type { Currency } from '../../../schema/traced'
import { Field, fieldDescriptionId } from '../../primitives/field'
import { InlineStat } from '../../primitives/inline-stat'
import { Table } from '../../primitives/table'
import { hrefFor, navigate } from '../../shell/router'
import { BUTTON, CONTROL, FormList, FormSection, PRIMARY, RowActions } from '../form-controls'
import { FigureInput } from './figure-input'
import type { PatternChoice } from './opportunity-editor'
import { DEFAULT_RANKING_SORT, ScoringSection } from './scoring-section'

const DATA_READINESS = EffortInputsSchema.shape.dataReadiness.options
const VOLUME_TIERS = EffortInputsSchema.shape.volumeTier.options
const NOVELTIES = EffortInputsSchema.shape.novelty.options

export interface ProcessChoice {
  id: string
  name: string
}

export interface NewOpportunityPanelProps {
  draft: NewOpportunityDraft
  currency: Currency
  // The engagement's processes, to tick rather than type.
  processes: readonly ProcessChoice[]
  // Shown once creating has been tried, so an empty panel does not open already refused.
  issues: readonly FormIssue[]
  onDraft: (draft: NewOpportunityDraft) => void
  onPending: (path: string, pending: boolean) => void
  onCreate: () => void
  onCancel: () => void
}

// One of the three effort factors. None has a neutral value to start on, so each waits to be chosen.
function FactorSelect<T extends string>({
  label,
  path,
  value,
  options,
  issues,
  hint,
  onChange,
}: {
  label: string
  path: string
  value: T | ''
  options: readonly T[]
  issues: readonly string[]
  hint: string
  onChange: (next: T | '') => void
}) {
  const id = useId()
  return (
    <Field label={label} htmlFor={id} issues={issues} required hint={hint}>
      <select
        id={id}
        data-config-path={path}
        value={value}
        onChange={(event) => onChange(options.find((option) => option === event.target.value) ?? '')}
        aria-invalid={issues.length > 0}
        aria-describedby={fieldDescriptionId(id)}
        className={`${CONTROL} num ${issues.length > 0 ? 'border-danger' : ''}`}
      >
        <option value="" disabled>
          choose
        </option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </Field>
  )
}

export function NewOpportunityPanel({ draft, currency, processes, issues, onDraft, onPending, onCreate, onCancel }: NewOpportunityPanelProps) {
  const titleId = useId()
  const summaryId = useId()
  const processesId = useId()
  const humanId = useId()
  const at = (path: string) => issues.filter((issue) => issue.path === path).map((issue) => issue.message)
  const edit = (patch: Partial<NewOpportunityDraft>) => onDraft({ ...draft, ...patch })
  const toggle = (id: string, on: boolean) => edit({ processIds: on ? (draft.processIds.includes(id) ? draft.processIds : [...draft.processIds, id]) : draft.processIds.filter((existing) => existing !== id) })

  // A required figure is given, or named as missing under its own row: TracedInput shows only what its
  // own text refuses, and an untouched empty field refuses nothing.
  const share = (field: 'automatablePercent' | 'errorReductionPercent', label: string, hint: string) => (
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
    <section aria-labelledby="new-opportunity-heading" className="border-b px-4 py-3">
      <h2 id="new-opportunity-heading" className="pb-1 text-sm font-medium">
        New opportunity
      </h2>

      <Field label="Title" htmlFor={titleId} issues={at('title')} required hint="What it would be called on a proposal.">
        <input
          id={titleId}
          type="text"
          autoComplete="off"
          spellCheck={false}
          data-config-path="title"
          value={draft.title}
          onChange={(event) => edit({ title: event.target.value })}
          aria-invalid={at('title').length > 0}
          aria-describedby={fieldDescriptionId(titleId)}
          className={`${CONTROL} w-72 max-w-full ${at('title').length > 0 ? 'border-danger' : ''}`}
        />
      </Field>
      <Field label="Summary" htmlFor={summaryId} hint="Optional here. Client-facing, one paragraph.">
        <textarea
          id={summaryId}
          rows={3}
          data-config-path="summary"
          value={draft.summary}
          onChange={(event) => edit({ summary: event.target.value })}
          aria-describedby={fieldDescriptionId(summaryId)}
          className="w-[32rem] max-w-full rounded-sm border bg-bg px-1.5 py-1 text-sm text-fg"
        />
      </Field>

      <Field
        label="Processes"
        htmlFor={processesId}
        issues={at('processIds')}
        required
        hint={processes.length === 0 ? 'This engagement has no processes yet. Map one on the Processes tab first.' : 'The processes this automates. Its value is the sum of theirs.'}
      >
        <div id={processesId} data-config-path="processIds" className="flex flex-wrap gap-x-4 gap-y-0.5 pt-1 text-sm">
          {processes.map((process) => (
            <label key={process.id} className="flex items-center gap-1.5">
              <input type="checkbox" checked={draft.processIds.includes(process.id)} onChange={(event) => toggle(process.id, event.target.checked)} />
              {process.name === '' ? process.id : process.name}
            </label>
          ))}
        </div>
      </Field>

      {share('automatablePercent', 'Automatable share', 'How much of the work in those processes can be automated.')}
      {share('errorReductionPercent', 'Error reduction', 'How much of the error rate it removes.')}

      <FactorSelect label="Data readiness" path="dataReadiness" value={draft.dataReadiness} options={DATA_READINESS} issues={at('dataReadiness')} hint="How ready the data the build reads is." onChange={(next) => edit({ dataReadiness: next })} />
      <FactorSelect label="Volume tier" path="volumeTier" value={draft.volumeTier} options={VOLUME_TIERS} issues={at('volumeTier')} hint="How much passes through it." onChange={(next) => edit({ volumeTier: next })} />
      <FactorSelect label="Novelty" path="novelty" value={draft.novelty} options={NOVELTIES} issues={at('novelty')} hint="How new this build is to us." onChange={(next) => edit({ novelty: next })} />

      <Field label="Human in the loop" htmlFor={humanId} hint="A person must check the result before it acts. Approval steps, integrations and compliance flags are set in the editor once it exists.">
        <input id={humanId} type="checkbox" data-config-path="requiresHumanInLoop" checked={draft.requiresHumanInLoop} onChange={(event) => edit({ requiresHumanInLoop: event.target.checked })} aria-describedby={fieldDescriptionId(humanId)} className="mt-1.5" />
      </Field>

      <div className="flex gap-2 pt-2">
        <button type="button" className={PRIMARY} onClick={onCreate}>
          Create opportunity
        </button>
        <button type="button" className={BUTTON} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  )
}

interface OpportunityRow {
  opportunity: EngagementFormView['draft']['opportunities'][number]
  index: number
  block: string | null
  problems: number
}

export interface OpportunitiesTabProps {
  form: EngagementFormView
  // Null when the stored Library is unusable, so no pattern can be named.
  patterns: readonly PatternChoice[] | null
  // The ranking above the capture table.
  scoring: ReactNode
  panel: ReactNode
  onNew: () => void
}

// The opportunities captured for this engagement, ranked first and then listed for editing. Each opens
// in its own screen.
export function OpportunitiesTabScreen({ form, patterns, scoring, panel, onNew }: OpportunitiesTabProps) {
  const processes = form.draft.processes
  const known = patterns ?? []
  const rows: OpportunityRow[] = form.draft.opportunities.map((opportunity, index) => ({
    opportunity,
    index,
    // The scope is not part of the draft, so its selection is read from the engagement as loaded.
    block: opportunityRemovalBlock(opportunity.id, form.saved.scope),
    problems: form.issues.filter((issue) => issue.path.startsWith(`opportunities.${index}.`)).length,
  }))
  const nameOf = (row: OpportunityRow) => (row.opportunity.title === '' ? `opportunity ${row.index + 1}` : `'${row.opportunity.title}'`)
  const processName = (id: string) => processes.find((process) => process.id === id)?.name || `missing: ${id}`

  return (
    <>
      {scoring}
      <FormSection id="engagement-opportunities" title="Opportunities">
        <FormList
          form={form}
          path="opportunities"
          title="What could be automated"
          hint="Removing an opportunity takes effect on Save; Discard brings it back. One in the scope being priced cannot be removed."
          addLabel="New opportunity"
          onAdd={onNew}
        >
          {panel}
          <div className="overflow-x-auto">
            <Table
              caption="Opportunities"
              columns={[
                {
                  id: 'title',
                  header: 'Opportunity',
                  cell: (row) => (
                    <a
                      href={hrefFor({ name: 'engagement', id: form.saved.id, tab: 'opportunities', item: row.opportunity.id })}
                      className="text-fg underline decoration-border underline-offset-2 hover:decoration-fg"
                    >
                      {row.opportunity.title === '' ? `Opportunity ${row.index + 1}` : row.opportunity.title}
                    </a>
                  ),
                },
                { id: 'processes', header: 'About', cell: (row) => row.opportunity.processIds.map(processName).join(', ') || <span className="text-muted">—</span> },
                {
                  id: 'patterns',
                  header: 'Patterns',
                  cell: (row) =>
                    row.opportunity.patternIds.length === 0 ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <span className="num">
                        {row.opportunity.patternIds.length}
                        {row.opportunity.primaryPatternId === null ? '' : `, primary ${known.find((pattern) => pattern.id === row.opportunity.primaryPatternId)?.name ?? row.opportunity.primaryPatternId}`}
                      </span>
                    ),
                },
                { id: 'automatable', header: 'Automatable', cell: (row) => <InlineStat traced={row.opportunity.automatablePercent} /> },
                { id: 'reduction', header: 'Error reduction', cell: (row) => <InlineStat traced={row.opportunity.errorReductionPercent} /> },
                { id: 'integrations', header: 'Integrations', numeric: true, cell: (row) => row.opportunity.effortInputs.integrations.length },
                {
                  id: 'problems',
                  header: 'Problems',
                  numeric: true,
                  cell: (row) => (row.problems === 0 ? <span className="text-muted">—</span> : <span className="num text-danger">{row.problems}</span>),
                },
                {
                  id: 'actions',
                  header: '',
                  cell: (row) => <RowActions name={nameOf(row)} index={row.index} count={rows.length} blocked={row.block} onRemove={() => form.removeOpportunity(row.index)} />,
                },
              ]}
              rows={rows}
              rowKey={(row) => row.opportunity.id}
              empty="No opportunities yet"
            />
          </div>
        </FormList>
      </FormSection>
    </>
  )
}

export interface OpportunitiesTabContainerProps {
  form: EngagementFormView
  // Each null when its stored record does not validate.
  patterns: readonly Pick<Pattern, 'id' | 'name' | 'baseHours'>[] | null
  config: Config | null
  // Fills computedAt on the live scores, which nothing shows.
  now: string
  // From the address: the opportunity whose working is open.
  expandedId: string | null
}

// Holds the new-opportunity panel and the ranking's sort; every opportunity itself lives in the
// engagement form, and the ranking is worked out from it on every edit.
export function OpportunitiesTab({ form, patterns, config, now, expandedId }: OpportunitiesTabContainerProps) {
  const [sort, setSort] = useState(DEFAULT_RANKING_SORT)
  // Worked out on every render: a few opportunities score in well under a millisecond.
  const ranking = rankingFor({ engagement: form.merged(), issues: form.issues, pending: form.state.pending, patterns, config, now })
  const [draft, setDraft] = useState<NewOpportunityDraft | null>(null)
  const [tried, setTried] = useState(false)
  const [pending, setPending] = useState<readonly string[]>([])

  const close = () => {
    setDraft(null)
    setTried(false)
    setPending([])
  }

  const create = () => {
    if (draft === null) return
    setTried(true)
    if (pending.length > 0) return
    const opportunity = opportunityFromDraft(crypto.randomUUID(), draft)
    if (opportunity === null) return
    // Written unscored: the recompute on the next load fills the cache in.
    const { scoring: _unscored, ...held } = opportunity
    form.addOpportunity(held)
    close()
    navigate({ name: 'engagement', id: form.saved.id, tab: 'opportunities', item: opportunity.id })
  }

  return (
    <OpportunitiesTabScreen
      form={form}
      patterns={patterns}
      scoring={<ScoringSection engagementId={form.saved.id} ranking={ranking} expandedId={expandedId} changed={form.changed} sort={sort} onSort={setSort} />}
      onNew={() => {
        setTried(false)
        setPending([])
        setDraft(initialOpportunityDraft())
      }}
      panel={
        draft === null ? null : (
          <NewOpportunityPanel
            draft={draft}
            currency={form.draft.company.currency}
            processes={form.draft.processes.map((process) => ({ id: process.id, name: process.name }))}
            issues={tried ? [...opportunityDraftIssues(draft), ...pending.map((path) => ({ path, message: 'Finish or correct the figure being typed' }))] : []}
            onDraft={setDraft}
            onPending={(path, isPending) => setPending((current) => (isPending ? [...current.filter((existing) => existing !== path), path] : current.filter((existing) => existing !== path)))}
            onCreate={create}
            onCancel={close}
          />
        )
      }
    />
  )
}
