import { useId, useState, type ReactNode } from 'react'
import { filterEngagements, NO_FILTER, stageOrder, tagOptions, type EngagementFilter, type NextActionFilter, type NewEngagementDraft } from '../../../hooks/use-engagement-list'
import type { CreateResult } from '../../../hooks/use-store'
import { StageSchema, type Engagement } from '../../../schema/engagement'
import { localDate } from '../../format'
import { Table, type Column } from '../../primitives/table'
import { hrefFor, navigate } from '../../shell/router'
import type { SortState } from '../../table-sort'
import { BUTTON, CONTROL, PRIMARY } from '../form-controls'
import { NewEngagementPanel } from './new-engagement-panel'

// Held by App, so the filters and sort survive opening an engagement and coming back.
export interface EngagementListPrefs {
  filter: EngagementFilter
  sort: SortState
}

export const DEFAULT_LIST_PREFS: EngagementListPrefs = { filter: NO_FILTER, sort: { columnId: 'updated', direction: 'descending' } }

const NEXT_ACTION_FILTERS: readonly { value: NextActionFilter; label: string }[] = [
  { value: 'any', label: 'any' },
  { value: 'with', label: 'has one' },
  { value: 'without', label: 'has none' },
  { value: 'due', label: 'due today or earlier' },
]

function columns(today: string): Column<Engagement>[] {
  return [
    {
      id: 'company',
      header: 'Company',
      cell: (engagement) => (
        <a href={hrefFor({ name: 'engagement', id: engagement.id, tab: null })} className="text-fg underline decoration-border underline-offset-2 hover:decoration-fg">
          {engagement.company.name}
        </a>
      ),
      sortValue: (engagement) => engagement.company.name,
    },
    { id: 'stage', header: 'Stage', cell: (engagement) => <span className="num">{engagement.stage}</span>, sortValue: (engagement) => stageOrder(engagement.stage) },
    { id: 'source', header: 'Source', cell: (engagement) => <span className="num">{engagement.source}</span>, sortValue: (engagement) => engagement.source },
    { id: 'industry', header: 'Industry', cell: (engagement) => engagement.company.industry, sortValue: (engagement) => engagement.company.industry || null },
    {
      id: 'tags',
      header: 'Tags',
      cell: (engagement) => <span className="num text-muted">{engagement.tags.join(', ')}</span>,
      sortValue: (engagement) => (engagement.tags.length === 0 ? null : engagement.tags.join(', ')),
    },
    { id: 'next', header: 'Next action', cell: (engagement) => engagement.nextAction?.text ?? '', sortValue: (engagement) => engagement.nextAction?.text ?? null },
    {
      id: 'due',
      header: 'Due',
      cell: (engagement) => {
        const due = engagement.nextAction?.due
        if (due === undefined) return null
        const overdue = due <= today
        return (
          <span className={`num ${overdue ? 'text-warn' : ''}`} title={overdue ? 'Due today or earlier' : undefined}>
            {due}
          </span>
        )
      },
      sortValue: (engagement) => engagement.nextAction?.due ?? null,
    },
    {
      id: 'updated',
      header: 'Updated',
      cell: (engagement) => (
        <span className="num text-muted" title={engagement.updatedAt}>
          {localDate(new Date(engagement.updatedAt))}
        </span>
      ),
      sortValue: (engagement) => engagement.updatedAt,
      firstSortDirection: 'descending',
    },
  ]
}

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: readonly { value: string; label: string }[]; onChange: (value: string) => void }) {
  const id = useId()
  return (
    <span className="flex items-center gap-1.5 text-sm text-muted">
      {/* Tied by id rather than wrapped, so the select's name is the label alone, not the label plus its options. */}
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)} className={`${CONTROL} num`}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </span>
  )
}

export interface EngagementListScreenProps {
  engagements: readonly Engagement[]
  prefs: EngagementListPrefs
  today: string
  onPrefs: (prefs: EngagementListPrefs) => void
  onNew: () => void
  // The new-engagement panel, when open.
  panel: ReactNode
}

export function EngagementListScreen({ engagements, prefs, today, onPrefs, onNew, panel }: EngagementListScreenProps) {
  const { filter } = prefs
  const shown = filterEngagements(engagements, filter, today)
  const tags = tagOptions(engagements)
  const setFilter = (patch: Partial<EngagementFilter>) => onPrefs({ ...prefs, filter: { ...filter, ...patch } })
  const filtered = filter.stage !== null || filter.tag !== null || filter.nextAction !== 'any'

  return (
    <section aria-labelledby="page-heading">
      <header className="flex h-10 items-center gap-3 border-b px-4">
        <h1 id="page-heading" className="text-base font-medium">
          Engagements
        </h1>
        <span className="text-sm text-muted">
          {filtered ? (
            <>
              showing <span className="num">{shown.length}</span> of <span className="num">{engagements.length}</span>
            </>
          ) : (
            <>
              <span className="num">{engagements.length}</span> in total
            </>
          )}
        </span>
        <button type="button" className={`${PRIMARY} ml-auto`} disabled={panel !== null} onClick={onNew}>
          New engagement
        </button>
      </header>

      {panel}

      <div role="group" aria-label="Filters" className="flex flex-wrap items-center gap-4 border-b px-4 py-2">
        <FilterSelect
          label="Stage"
          value={filter.stage ?? ''}
          options={[{ value: '', label: 'all' }, ...StageSchema.options.map((stage) => ({ value: stage, label: stage }))]}
          onChange={(value) => setFilter({ stage: StageSchema.options.find((stage) => stage === value) ?? null })}
        />
        <FilterSelect
          label="Tag"
          value={filter.tag ?? ''}
          options={[{ value: '', label: 'all' }, ...tags.map((tag) => ({ value: tag, label: tag }))]}
          onChange={(value) => setFilter({ tag: value === '' ? null : value })}
        />
        <FilterSelect
          label="Next action"
          value={filter.nextAction}
          options={NEXT_ACTION_FILTERS}
          onChange={(value) => setFilter({ nextAction: NEXT_ACTION_FILTERS.find((option) => option.value === value)?.value ?? 'any' })}
        />
        {filtered ? (
          <button type="button" className={BUTTON} onClick={() => setFilter(NO_FILTER)}>
            Clear filters
          </button>
        ) : null}
      </div>

      <div className="overflow-x-auto px-4">
        <Table
          caption="Engagements"
          columns={columns(today)}
          rows={shown}
          rowKey={(engagement) => engagement.id}
          empty={engagements.length === 0 ? 'No engagements yet. Create one with New engagement.' : 'No engagements match these filters.'}
          sort={prefs.sort}
          onSort={(sort) => onPrefs({ ...prefs, sort })}
        />
      </div>
    </section>
  )
}

export interface EngagementListViewProps {
  engagements: readonly Engagement[]
  industries: readonly string[] | null
  prefs: EngagementListPrefs
  onPrefs: (prefs: EngagementListPrefs) => void
  createEngagement: (draft: NewEngagementDraft) => Promise<CreateResult>
}

export function EngagementListView({ engagements, industries, prefs, onPrefs, createEngagement }: EngagementListViewProps) {
  const [creating, setCreating] = useState(false)
  return (
    <EngagementListScreen
      engagements={engagements}
      prefs={prefs}
      today={localDate()}
      onPrefs={onPrefs}
      onNew={() => setCreating(true)}
      panel={
        creating ? (
          <NewEngagementPanel
            industries={industries}
            createEngagement={createEngagement}
            onCreated={(id) => navigate({ name: 'engagement', id, tab: null })}
            onCancel={() => setCreating(false)}
          />
        ) : null
      }
    />
  )
}
