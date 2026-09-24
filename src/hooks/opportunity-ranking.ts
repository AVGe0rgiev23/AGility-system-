import { QUADRANT_THRESHOLD, scoreOpportunity } from '../engines/scoring'
import type { Config } from '../schema/config'
import type { Engagement } from '../schema/engagement'
import type { Pattern } from '../schema/library'
import type { ScoringResult } from '../schema/results'
import type { FormIssue } from './form-paths'

// The scoring screen's rules, as pure functions over the draft. Scores are worked out live from the
// unsaved draft, so every edit moves the ranking at once; after a Save they equal the cached ones,
// since it is the same engine on the same inputs.

export type Quadrant = ScoringResult['quadrant']

export type RankedOpportunity =
  | { kind: 'scored'; opportunityId: string; index: number; title: string; rank: number; result: ScoringResult }
  // Not scored while something it reads is refused or half-typed, so a figure being fixed never gives a rank.
  | { kind: 'blocked'; opportunityId: string; index: number; title: string; problems: number }

export type ScoredOpportunityRow = Extract<RankedOpportunity, { kind: 'scored' }>

export interface RankingInput {
  // The draft as it would be saved (mergedEngagement).
  engagement: Engagement
  issues: readonly FormIssue[]
  // Paths whose typed text is not yet a figure.
  pending: readonly string[]
  patterns: readonly Pick<Pattern, 'id' | 'baseHours'>[]
  config: Config
  // Only fills computedAt, which the screen does not show.
  now: string
}

export function opportunityTitle(title: string, index: number): string {
  return title === '' ? `Opportunity ${index + 1}` : title
}

function under(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}.`)
}

// Everything scoring reads that the form can refuse: the opportunity itself, each process it names,
// and the company rate a process falls back on. A pattern the Library lacks is not here: the engine
// scores without it and says so (MISSING_PATTERN).
function readPrefixes(engagement: Engagement, index: number, processIds: readonly string[]): string[] {
  const processes = engagement.processes.flatMap((process, processIndex) => (processIds.includes(process.id) ? [`processes.${processIndex}`] : []))
  return [`opportunities.${index}`, ...processes, 'company.blendedHourlyCost']
}

// Scored opportunities by priority index, highest first, then those not scored, each group in draft order.
export function rankOpportunities(input: RankingInput): RankedOpportunity[] {
  const { engagement, issues, pending, patterns, config, now } = input
  const scored: Omit<ScoredOpportunityRow, 'rank'>[] = []
  const blocked: RankedOpportunity[] = []

  engagement.opportunities.forEach((opportunity, index) => {
    const title = opportunityTitle(opportunity.title, index)
    const prefixes = readPrefixes(engagement, index, opportunity.processIds)
    const reads = (path: string) => prefixes.some((prefix) => under(path, prefix))
    const problems = issues.filter((issue) => reads(issue.path)).length + pending.filter(reads).length
    if (problems > 0) {
      blocked.push({ kind: 'blocked', opportunityId: opportunity.id, index, title, problems })
      return
    }
    const result = scoreOpportunity({ opportunity, processes: engagement.processes, patterns: [...patterns], company: engagement.company, config, now })
    scored.push({ kind: 'scored', opportunityId: opportunity.id, index, title, result })
  })

  // Array sort is stable, so equal priorities keep draft order.
  const ranked = [...scored].sort((a, b) => b.result.priorityIndex - a.result.priorityIndex).map((row, position) => ({ ...row, rank: position + 1 }))
  return [...ranked, ...blocked]
}

export type Ranking =
  // Nothing is scored, and the reason says which stored record cannot be used.
  | { kind: 'unavailable'; reason: string }
  | { kind: 'ranked'; rows: RankedOpportunity[]; currency: Config['agencyCurrency'] }

export interface RankingContext extends Omit<RankingInput, 'patterns' | 'config'> {
  // Each null when its stored record does not validate.
  patterns: RankingInput['patterns'] | null
  config: Config | null
}

// Scoring without the Config has no ceilings or rates, and without the Library every linked pattern
// would count as missing: either gives a score that looks real and is not, so neither is attempted.
// A single pattern the Library lacks is different; the engine scores around it and says so.
export function rankingFor(context: RankingContext): Ranking {
  const { patterns, config } = context
  if (config === null) {
    return { kind: 'unavailable', reason: 'the stored Config does not validate, so the scoring ceilings, multipliers and exchange rates are unknown. The store notice says why.' }
  }
  if (patterns === null) {
    return { kind: 'unavailable', reason: "the stored Library does not validate, so no pattern's base hours are known and every linked pattern would count as missing. The store notice says why." }
  }
  return { kind: 'ranked', rows: rankOpportunities({ ...context, patterns, config }), currency: config.agencyCurrency }
}

export const QUADRANT_NAMES: Record<Quadrant, string> = {
  'quick-win': 'Quick win',
  strategic: 'Strategic',
  'fill-in': 'Fill-in',
  avoid: 'Avoid',
}

const QUADRANT_ORDER: readonly Quadrant[] = ['quick-win', 'strategic', 'fill-in', 'avoid']

// The plot is square: effort score across, value score up, both 0 to 100.
export const QUADRANT_PLOT = { size: 320, margin: 36 } as const
const INNER = QUADRANT_PLOT.size - 2 * QUADRANT_PLOT.margin

export function plotX(effortScore: number): number {
  return QUADRANT_PLOT.margin + (INNER * effortScore) / 100
}

export function plotY(valueScore: number): number {
  return QUADRANT_PLOT.margin + INNER * (1 - valueScore / 100)
}

export interface QuadrantPoint {
  x: number
  y: number
  valueScore: number
  effortScore: number
  // Every opportunity at exactly these scores, in rank order, so none hides under another.
  members: ScoredOpportunityRow[]
}

export function quadrantPoints(ranked: readonly RankedOpportunity[]): QuadrantPoint[] {
  const points: QuadrantPoint[] = []
  for (const row of ranked) {
    if (row.kind !== 'scored') continue
    const { valueScore, effortScore } = row.result
    const shared = points.find((point) => point.valueScore === valueScore && point.effortScore === effortScore)
    if (shared === undefined) points.push({ x: plotX(effortScore), y: plotY(valueScore), valueScore, effortScore, members: [row] })
    else shared.members.push(row)
  }
  return points
}

// The plot's text equivalent: which opportunity landed in which quadrant, by rank.
export function quadrantSummary(ranked: readonly RankedOpportunity[]): string {
  const scored = ranked.filter((row): row is ScoredOpportunityRow => row.kind === 'scored')
  const parts = QUADRANT_ORDER.map((quadrant) => {
    const members = scored.filter((row) => row.result.quadrant === quadrant)
    const names = members.length === 0 ? 'none' : members.map((row) => `${row.rank} ${row.title}`).join(', ')
    return `${QUADRANT_NAMES[quadrant]}: ${names}.`
  })
  const unscored = ranked.length - scored.length
  if (unscored > 0) parts.push(`Not scored: ${unscored}.`)
  return `Value score against effort score, each split at ${QUADRANT_THRESHOLD}. ${parts.join(' ')}`
}
