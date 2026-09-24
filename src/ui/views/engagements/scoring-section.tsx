import { useEffect, type ReactNode } from 'react'
import { QUADRANT_THRESHOLD } from '../../../engines/scoring'
import {
  QUADRANT_NAMES,
  QUADRANT_PLOT,
  plotX,
  plotY,
  quadrantPoints,
  quadrantSummary,
  type RankedOpportunity,
  type Ranking,
} from '../../../hooks/opportunity-ranking'
import type { ScoringResult } from '../../../schema/results'
import { ConfidenceBadge } from '../../primitives/confidence-badge'
import { InlineStat } from '../../primitives/inline-stat'
import { Table, type Column } from '../../primitives/table'
import { hrefFor } from '../../shell/router'
import type { SortState } from '../../table-sort'

export const DEFAULT_RANKING_SORT: SortState = { columnId: 'priority', direction: 'descending' }

export interface ScoringSectionProps {
  engagementId: string
  ranking: Ranking
  // From the address: the opportunity whose working is open. Null when none is.
  expandedId: string | null
  // The draft differs from what is stored, so these scores are not stored yet.
  changed: boolean
  sort: SortState
  onSort: (next: SortState) => void
}

function workingId(opportunityId: string): string {
  return `working-${opportunityId}`
}

function toggleId(opportunityId: string): string {
  return `scoring-toggle-${opportunityId}`
}

function WorkingPanel({ row }: { row: RankedOpportunity }) {
  if (row.kind === 'blocked') {
    return (
      <p id={workingId(row.opportunityId)} className="text-sm text-danger">
        Not scored until the {row.problems === 1 ? 'problem' : `${row.problems} problems`} in what it reads {row.problems === 1 ? 'is' : 'are'} fixed.
      </p>
    )
  }
  const { breakdown, warnings } = row.result
  const rows = breakdown.map((term, index) => ({ term, key: String(index) }))
  const columns: Column<(typeof rows)[number]>[] = [
    {
      id: 'term',
      header: 'Term',
      cell: ({ term }) => (
        <span className="inline-flex items-center gap-1.5">
          {term.label}
          {term.audience === 'internal' ? (
            <span className="rounded-sm border px-1 text-xs text-muted" title="A ranking figure. Documents leave it out; it never reaches a client.">
              internal
            </span>
          ) : null}
        </span>
      ),
    },
    // A breakdown row carries its source, not a confidence: a term is one input or rests on its weakest.
    { id: 'figure', header: 'Figure', cell: ({ term }) => <InlineStat traced={{ value: term.value, unit: term.unit, source: term.source }} /> },
    { id: 'formula', header: 'Working', cell: ({ term }) => <span className="num text-muted">{term.formula}</span> },
  ]
  return (
    <div id={workingId(row.opportunityId)} role="group" aria-label={`Working for ${row.title}`} className="flex flex-col gap-2">
      <Table caption={`Working for ${row.title}`} columns={columns} rows={rows} rowKey={(entry) => entry.key} empty="No terms" />
      {warnings.length === 0 ? (
        <p className="text-xs text-muted">No warnings.</p>
      ) : (
        <ul aria-label="Warnings" className="flex flex-col gap-0.5 text-sm">
          {warnings.map((warning, index) => (
            <li key={index} className="flex gap-2">
              <span className="num text-warn">{warning.code}</span>
              <span>{warning.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Scored({ row, figure }: { row: RankedOpportunity; figure: (result: ScoringResult) => ReactNode }) {
  if (row.kind === 'scored') return figure(row.result)
  return (
    <span className="text-muted" title="Not scored">
      <span aria-hidden="true">—</span>
      <span className="sr-only">Not scored</span>
    </span>
  )
}

function sortBy(pick: (result: ScoringResult) => number) {
  return (row: RankedOpportunity) => (row.kind === 'scored' ? pick(row.result) : null)
}

// Beside the title rather than in a last column, so the wide table never scrolls it out of reach. It is a
// link: the open row lives in the address, and closing it is going back to the tab.
function WorkingToggle({ row, open, engagementId }: { row: RankedOpportunity; open: boolean; engagementId: string }) {
  return (
    <a
      id={toggleId(row.opportunityId)}
      href={hrefFor({ name: 'engagement', id: engagementId, tab: open ? 'opportunities' : 'scoring', item: open ? undefined : row.opportunityId })}
      aria-expanded={open}
      aria-controls={open ? workingId(row.opportunityId) : undefined}
      aria-label={`${open ? 'Hide' : 'Show'} the working for ${row.title}`}
      className="scroll-mt-12 text-xs text-muted underline decoration-border underline-offset-2 hover:text-fg"
    >
      {open ? 'Hide working' : 'Working'}
    </a>
  )
}

// Value score against effort score, as generated geometry. The table is the fuller equivalent; the
// label names every opportunity by quadrant, so the picture hides nothing from a screen reader.
export function QuadrantPlot({ rows, expandedId }: { rows: readonly RankedOpportunity[]; expandedId: string | null }) {
  const { size, margin } = QUADRANT_PLOT
  const low = margin
  const high = size - margin
  const midX = plotX(QUADRANT_THRESHOLD)
  const midY = plotY(QUADRANT_THRESHOLD)
  return (
    <svg role="img" aria-label={quadrantSummary(rows)} viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="shrink-0 text-xs">
      <rect x={low} y={low} width={high - low} height={high - low} className="fill-none stroke-border" />
      <line x1={midX} y1={low} x2={midX} y2={high} strokeDasharray="3 3" className="stroke-border" />
      <line x1={low} y1={midY} x2={high} y2={midY} strokeDasharray="3 3" className="stroke-border" />
      <text x={low + 4} y={low + 12} className="fill-muted">
        {QUADRANT_NAMES['quick-win']}
      </text>
      <text x={high - 4} y={low + 12} textAnchor="end" className="fill-muted">
        {QUADRANT_NAMES.strategic}
      </text>
      <text x={low + 4} y={high - 4} className="fill-muted">
        {QUADRANT_NAMES['fill-in']}
      </text>
      <text x={high - 4} y={high - 4} textAnchor="end" className="fill-muted">
        {QUADRANT_NAMES.avoid}
      </text>
      {[0, QUADRANT_THRESHOLD, 100].map((tick) => (
        <g key={tick} className="num fill-muted">
          <text x={plotX(tick)} y={high + 12} textAnchor="middle">
            {tick}
          </text>
          <text x={low - 4} y={plotY(tick) + 4} textAnchor="end">
            {tick}
          </text>
        </g>
      ))}
      <text x={size / 2} y={size - 4} textAnchor="middle" className="fill-muted">
        Effort score
      </text>
      <text x={10} y={size / 2} textAnchor="middle" transform={`rotate(-90 10 ${size / 2})`} className="fill-muted">
        Value score
      </text>
      {quadrantPoints(rows).map((point) => {
        const active = point.members.some((member) => member.opportunityId === expandedId)
        return (
          <g key={`${point.valueScore}-${point.effortScore}`}>
            <title>
              {point.members
                .map((member) => `${member.rank} ${member.title}: value ${member.result.valueScore}, effort ${member.result.effortScore}, confidence ${member.result.confidence} of 100`)
                .join('\n')}
            </title>
            <circle cx={point.x} cy={point.y} r={4} className={active ? 'fill-accent stroke-accent' : 'fill-surface stroke-fg'} />
            <text x={point.x + 7} y={point.y - 5} className="num fill-fg">
              {point.members.map((member) => member.rank).join(', ')}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

export function ScoringSection({ engagementId, ranking, expandedId, changed, sort, onSort }: ScoringSectionProps) {
  // An address naming one opportunity's working brings its row to the top, below the sticky save bar
  // (the toggle's scroll-mt), so the row, its focused toggle and the start of the working are all in
  // view. The window scrolls only vertically: scrollIntoView would also slide the wide table sideways
  // to reach the toggle in its last column, hiding the rank and the term labels.
  useEffect(() => {
    const toggle = expandedId === null ? null : document.getElementById(toggleId(expandedId))
    if (toggle === null) return
    const clearance = parseFloat(getComputedStyle(toggle).scrollMarginTop) || 0
    window.scrollTo({ top: window.scrollY + toggle.getBoundingClientRect().top - clearance })
  }, [expandedId])

  const heading = (
    <h2 id="scoring-heading" className="text-sm font-medium">
      Ranking
    </h2>
  )
  if (ranking.kind === 'unavailable') {
    return (
      <section aria-labelledby="scoring-heading" className="border-b px-4 py-3">
        {heading}
        <p role="alert" className="text-sm text-danger">
          Nothing is scored: {ranking.reason}
        </p>
      </section>
    )
  }

  const { rows, currency } = ranking
  const collapse = hrefFor({ name: 'engagement', id: engagementId, tab: 'opportunities' })
  const missing = expandedId !== null && !rows.some((row) => row.opportunityId === expandedId)
  const columns: Column<RankedOpportunity>[] = [
    { id: 'rank', header: 'Rank', numeric: true, cell: (row) => (row.kind === 'scored' ? row.rank : <span className="text-muted">—</span>), sortValue: (row) => (row.kind === 'scored' ? row.rank : null) },
    {
      id: 'title',
      header: 'Opportunity',
      cell: (row) => (
        <span className="inline-flex items-center gap-2 whitespace-nowrap">
          <a
            href={hrefFor({ name: 'engagement', id: engagementId, tab: 'opportunities', item: row.opportunityId })}
            className="text-fg underline decoration-border underline-offset-2 hover:decoration-fg"
          >
            {row.title}
          </a>
          {row.kind === 'blocked' ? (
            <span className="text-xs text-danger">
              not scored: fix {row.problems} {row.problems === 1 ? 'problem' : 'problems'}
            </span>
          ) : null}
          <WorkingToggle row={row} open={row.opportunityId === expandedId} engagementId={engagementId} />
        </span>
      ),
    },
    {
      id: 'value',
      header: 'Annual value',
      numeric: true,
      cell: (row) => <Scored row={row} figure={(result) => <InlineStat value={result.annualValue} unit={`${currency}/year`} currency={currency} confidence={result.confidence} />} />,
      sortValue: sortBy((result) => result.annualValue),
      firstSortDirection: 'descending',
    },
    {
      id: 'saved',
      header: 'Hours saved',
      numeric: true,
      cell: (row) => <Scored row={row} figure={(result) => <InlineStat value={result.hoursSavedPerMonth} unit="hours/month" confidence={result.confidence} />} />,
      sortValue: sortBy((result) => result.hoursSavedPerMonth),
      firstSortDirection: 'descending',
    },
    {
      id: 'build',
      header: 'Build hours, uncalibrated',
      numeric: true,
      cell: (row) => <Scored row={row} figure={(result) => <InlineStat value={result.rawBuildHours} unit="hours" confidence={result.confidence} />} />,
      sortValue: sortBy((result) => result.rawBuildHours),
    },
    {
      id: 'valueScore',
      header: 'Value',
      numeric: true,
      cell: (row) => <Scored row={row} figure={(result) => <InlineStat value={result.valueScore} unit="points" confidence={result.confidence} />} />,
      sortValue: sortBy((result) => result.valueScore),
      firstSortDirection: 'descending',
    },
    {
      id: 'effortScore',
      header: 'Effort',
      numeric: true,
      cell: (row) => <Scored row={row} figure={(result) => <InlineStat value={result.effortScore} unit="points" confidence={result.confidence} />} />,
      sortValue: sortBy((result) => result.effortScore),
    },
    {
      id: 'confidence',
      header: 'Confidence',
      numeric: true,
      cell: (row) => <Scored row={row} figure={(result) => <ConfidenceBadge confidence={result.confidence} />} />,
      sortValue: sortBy((result) => result.confidence),
      firstSortDirection: 'descending',
    },
    {
      id: 'priority',
      header: 'Priority',
      numeric: true,
      cell: (row) => <Scored row={row} figure={(result) => <InlineStat value={result.priorityIndex} unit="index" confidence={result.confidence} />} />,
      sortValue: sortBy((result) => result.priorityIndex),
      firstSortDirection: 'descending',
    },
    { id: 'quadrant', header: 'Quadrant', cell: (row) => (row.kind === 'scored' ? QUADRANT_NAMES[row.result.quadrant] : <span className="text-muted">—</span>) },
    {
      id: 'warnings',
      header: 'Warnings',
      numeric: true,
      cell: (row) =>
        row.kind === 'blocked' || row.result.warnings.length === 0 ? (
          <span className="text-muted">—</span>
        ) : (
          <span className="text-warn" title={row.result.warnings.map((warning) => warning.code).join(', ')}>
            {row.result.warnings.length}
          </span>
        ),
      sortValue: sortBy((result) => result.warnings.length),
      firstSortDirection: 'descending',
    },
  ]

  return (
    <section aria-labelledby="scoring-heading" className="border-b px-4 py-3">
      <div className="flex items-baseline gap-3 pb-1">
        {heading}
        <p className="text-xs text-muted">
          Worked out from the figures on these tabs{changed ? ', unsaved edits included: Save stores them' : ''}. Value, effort, priority and quadrant are internal and
          never reach a client.
        </p>
      </div>
      {missing ? (
        <p className="pb-2 text-sm">
          This engagement has no opportunity <span className="num">{expandedId}</span> to show the working for.{' '}
          <a href={collapse} className="text-fg underline">
            Back to its opportunities
          </a>
          .
        </p>
      ) : null}
      {/* The plot sits under the table, not beside it: every column of the ranking needs the width. */}
      <div className="flex flex-col gap-3">
        <div className="min-w-0 overflow-x-auto">
          <Table
            caption="Opportunities ranked by priority"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.opportunityId}
            empty="No opportunities to rank yet"
            sort={sort}
            onSort={onSort}
            detail={(row) => (row.opportunityId === expandedId ? <WorkingPanel row={row} /> : null)}
          />
        </div>
        {rows.length === 0 ? null : <QuadrantPlot rows={rows} expandedId={expandedId} />}
      </div>
    </section>
  )
}
