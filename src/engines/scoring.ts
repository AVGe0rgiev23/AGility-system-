import type { Company } from '../schema/company'
import type { Config } from '../schema/config'
import type { Pattern } from '../schema/library'
import type { Opportunity } from '../schema/opportunity'
import type { Process } from '../schema/process'
import type { ScoringResult, ScoringWarningCode } from '../schema/results'
import type { Source, TracedValue } from '../schema/traced'
import { fmt } from './format'
import { hashInputs } from './inputs-hash'

// ENGINES §1.2. The table is the scoring model itself, so it is code rather than Config:
// an operator tuning it would be redefining what a point of effort means.
export const EFFORT_POINTS = {
  integration: 2,
  integrationWithoutPublicApi: 4,
  integrationWithoutAuth: 3,
  dataReadiness: { structured: 0, 'semi-structured': 2, unstructured: 5 },
  approvalStep: 1.5,
  complianceFlag: 3,
  volumeTier: { low: 0, medium: 1, high: 3 },
  novelty: { 'known-pattern': 0, 'similar-pattern': 2, new: 5 },
  humanInLoop: 2,
} as const

// ENGINES §1.3.
export const CONFIDENCE_PENALTIES = {
  defaultSource: 12,
  estimatedSource: 6,
  noPattern: 15,
  hourlyCostNotClientStated: 10,
} as const
export const CONFIDENCE_MIN = 15
export const CONFIDENCE_MAX = 100

// Below this the proposal warns before rendering (§1.3), the estimate flags LOW_CONFIDENCE (§2)
// and the ROI case is said to rest on guesses (§4).
export const LOW_CONFIDENCE_THRESHOLD = 50
// §1.4: a value score at or above is high value, an effort score at or above is high effort.
export const QUADRANT_THRESHOLD = 50

export interface ScoringInput {
  opportunity: Opportunity
  // Only those the opportunity references; anything else passed is ignored.
  processes: Process[]
  // Only those in opportunity.patternIds. baseHours is uncalibrated and used raw here.
  patterns: Pick<Pattern, 'id' | 'baseHours'>[]
  company: Company
  config: Config
  // ISO timestamp from the caller. Copied to computedAt, never hashed.
  now: string
}

type BreakdownRow = ScoringResult['breakdown'][number]
type RevenueImpact = Process['revenueImpact']

// A derived figure is labelled with its least trustworthy input.
const SOURCE_RANK: Record<Source, number> = { default: 0, estimated: 1, measured: 2, 'client-stated': 3 }
const IMPACT_RANK: Record<RevenueImpact, number> = { none: 0, indirect: 1, direct: 2 }

function worstSource(sources: readonly Source[]): Source {
  let worst: Source = 'client-stated'
  for (const source of sources) {
    if (SOURCE_RANK[source] < SOURCE_RANK[worst]) worst = source
  }
  return worst
}

// A value is money exactly when it carries a currency; its unit is display text and is never
// parsed. fxRates holds units per 1 EUR. A value without a currency is used as is.
export function toAgencyCurrency(traced: TracedValue, config: Config): number {
  const currency = traced.currency ?? config.agencyCurrency
  if (currency === config.agencyCurrency) return traced.value
  return traced.value / config.fxRates.rates[currency]
}

function resolveLinked<T extends { id: string }>(ids: readonly string[], items: readonly T[], onMissing: (id: string) => void): T[] {
  const found: T[] = []
  for (const id of ids) {
    const item = items.find((candidate) => candidate.id === id)
    if (item === undefined) onMissing(id)
    else found.push(item)
  }
  return found
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, score))
}

export function scoreOpportunity(input: ScoringInput): ScoringResult {
  const { opportunity, company, config, now } = input
  const eur = config.agencyCurrency
  const warnings: ScoringResult['warnings'] = []
  const warn = (code: ScoringWarningCode, message: string): void => {
    warnings.push({ code, message })
  }
  const breakdown: BreakdownRow[] = []
  const assumptions: TracedValue[] = []
  // One entry per TracedValue object, so a company rate shared by several processes is one
  // assumption and is penalised once.
  const assume = (traced: TracedValue): void => {
    if (!assumptions.includes(traced)) assumptions.push(traced)
  }
  const show = (label: string, value: number, unit: string, source: Source, formula: string): void => {
    breakdown.push({ label, value, unit, source, formula })
  }

  const processes = resolveLinked(opportunity.processIds, input.processes, (id) => {
    warn('MISSING_PROCESS', `Linked process '${id}' was not supplied, so it contributes no value`)
  })
  const patterns = resolveLinked(opportunity.patternIds, input.patterns, (id) => {
    warn('MISSING_PATTERN', `Linked pattern '${id}' was not supplied, so its hours are not counted`)
  })
  if (processes.length === 0) {
    warn('NO_PROCESSES', 'No linked process, so the annual value is 0')
  }

  // §1.1 Value
  const { automatablePercent: automatable, errorReductionPercent: errorReduction } = opportunity
  let labourTotal = 0
  let errorTotal = 0
  let hoursSavedPerMonth = 0
  // With no process there is no client-stated hourly cost either.
  let everyHourlyCostClientStated = processes.length > 0
  let errorReductionUsed = false

  for (const process of processes) {
    const { occurrencesPerMonth: occurrences, minutesPerOccurrence: minutes, peopleInvolved: people } = process.frequency
    assume(occurrences)
    assume(minutes)
    assume(people)
    const hoursWasted = (occurrences.value * minutes.value * people.value) / 60
    const wastedSource = worstSource([occurrences.source, minutes.source, people.source])
    show(
      `${process.name}: hours wasted per month`,
      hoursWasted,
      'hours/month',
      wastedSource,
      `(${fmt(occurrences.value)} × ${fmt(minutes.value)} × ${fmt(people.value)}) / 60`,
    )
    const recoverable = hoursWasted * (automatable.value / 100)
    const recoverableSource = worstSource([wastedSource, automatable.source])
    show(
      `${process.name}: recoverable hours per month`,
      recoverable,
      'hours/month',
      recoverableSource,
      `${fmt(hoursWasted)} × ${fmt(automatable.value)}%`,
    )
    hoursSavedPerMonth += recoverable

    const cost = process.roleHourlyCost ?? company.blendedHourlyCost
    if (cost === null) {
      everyHourlyCostClientStated = false
      warn(
        'NO_HOURLY_COST',
        `'${process.name}' has no role hourly cost and the company has no blended hourly cost, so its labour value is 0`,
      )
      show(`${process.name}: effective hourly cost`, 0, `${eur}/hour`, 'default', 'no hourly cost available')
    } else {
      assume(cost)
      if (cost.source !== 'client-stated') everyHourlyCostClientStated = false
      // Without a currency the figure is not money, yet it is still multiplied by hours as if it were.
      if (cost.currency === undefined) {
        warn(
          'NON_HOURLY_COST_UNIT',
          `The hourly cost for '${process.name}' carries no currency, so it is not a money figure and is used as ${eur}; check the figure`,
        )
      }
      const costEur = toAgencyCurrency(cost, config)
      const basis = process.roleHourlyCost === null ? 'company blended rate' : 'role rate'
      const conversion =
        cost.currency !== undefined && cost.currency !== eur
          ? `${fmt(cost.value)} ${cost.currency} / ${config.fxRates.rates[cost.currency]} (${cost.currency} per ${eur})`
          : `${fmt(cost.value)} ${eur}`
      show(`${process.name}: effective hourly cost`, costEur, `${eur}/hour`, cost.source, `${conversion}, ${basis}`)
      const labour = recoverable * 12 * costEur
      show(
        `${process.name}: annual labour value`,
        labour,
        `${eur}/year`,
        worstSource([recoverableSource, cost.source]),
        `${fmt(recoverable)} × 12 × ${fmt(costEur)}`,
      )
      labourTotal += labour
    }

    const { errorRatePercent: errorRate, costPerError } = process.errorProfile
    if (errorRate !== null && costPerError !== null) {
      assume(errorRate)
      assume(costPerError)
      errorReductionUsed = true
      const costPerErrorEur = toAgencyCurrency(costPerError, config)
      const errorValue =
        occurrences.value * 12 * (errorRate.value / 100) * costPerErrorEur * (errorReduction.value / 100)
      show(
        `${process.name}: annual error value`,
        errorValue,
        `${eur}/year`,
        worstSource([occurrences.source, errorRate.source, costPerError.source, errorReduction.source]),
        `${fmt(occurrences.value)} × 12 × ${fmt(errorRate.value)}% × ${fmt(costPerErrorEur)} × ${fmt(errorReduction.value)}%`,
      )
      errorTotal += errorValue
    }
  }
  assume(automatable)
  // The reduction feeds nothing unless some process has both error inputs.
  if (errorReductionUsed) assume(errorReduction)

  const annualValue = labourTotal + errorTotal
  const valueSource = worstSource(assumptions.map((traced) => traced.source))
  show('Hours saved per month', hoursSavedPerMonth, 'hours/month', valueSource, 'Σ recoverable hours per month')
  show('Annual value', annualValue, `${eur}/year`, valueSource, `Σ labour (${fmt(labourTotal)}) + Σ error (${fmt(errorTotal)})`)

  const impact = processes.reduce<RevenueImpact>(
    (highest, process) => (IMPACT_RANK[process.revenueImpact] > IMPACT_RANK[highest] ? process.revenueImpact : highest),
    'none',
  )
  const strategicMultiplier = config.scoring.strategicMultipliers[impact]
  // The factor is shown so the working panel can explain the value score. The weighted value
  // itself is for ranking only and stays off the breakdown, which proposals render.
  show(
    'Strategic multiplier',
    strategicMultiplier,
    'factor',
    'default',
    `config.scoring.strategicMultipliers.${impact} (highest revenue impact among linked processes)`,
  )
  const weightedValue = annualValue * strategicMultiplier
  const valueScore = clampScore(Math.round((100 * weightedValue) / config.scoring.valueCeiling))
  show(
    'Value score',
    valueScore,
    'points',
    valueSource,
    `min(100, round(100 × ${fmt(annualValue)} × ${fmt(strategicMultiplier)} / ${fmt(config.scoring.valueCeiling)}))`,
  )

  // §1.2 Effort. The inputs are Alex's assessment of the build, hence 'estimated'.
  const effort = opportunity.effortInputs
  const integrations = effort.integrations.length
  const withoutApi = effort.integrations.filter((integration) => !integration.hasPublicApi).length
  const withoutAuth = effort.integrations.filter((integration) => !integration.authAvailable).length
  const factors: [label: string, points: number, formula: string][] = [
    ['Integrations', integrations * EFFORT_POINTS.integration, `${integrations} × ${EFFORT_POINTS.integration}`],
    [
      'Integrations without a public API',
      withoutApi * EFFORT_POINTS.integrationWithoutPublicApi,
      `${withoutApi} × ${EFFORT_POINTS.integrationWithoutPublicApi}`,
    ],
    [
      'Integrations without available auth',
      withoutAuth * EFFORT_POINTS.integrationWithoutAuth,
      `${withoutAuth} × ${EFFORT_POINTS.integrationWithoutAuth}`,
    ],
    [
      'Data readiness',
      EFFORT_POINTS.dataReadiness[effort.dataReadiness],
      `${effort.dataReadiness} → ${EFFORT_POINTS.dataReadiness[effort.dataReadiness]}`,
    ],
    ['Approval steps', effort.approvalSteps * EFFORT_POINTS.approvalStep, `${fmt(effort.approvalSteps)} × ${EFFORT_POINTS.approvalStep}`],
    [
      'Compliance flags',
      effort.complianceFlags.length * EFFORT_POINTS.complianceFlag,
      `${effort.complianceFlags.length} × ${EFFORT_POINTS.complianceFlag}`,
    ],
    ['Volume tier', EFFORT_POINTS.volumeTier[effort.volumeTier], `${effort.volumeTier} → ${EFFORT_POINTS.volumeTier[effort.volumeTier]}`],
    ['Novelty', EFFORT_POINTS.novelty[effort.novelty], `${effort.novelty} → ${EFFORT_POINTS.novelty[effort.novelty]}`],
    [
      'Human in the loop',
      effort.requiresHumanInLoop ? EFFORT_POINTS.humanInLoop : 0,
      effort.requiresHumanInLoop ? `yes → ${EFFORT_POINTS.humanInLoop}` : 'no → 0',
    ],
  ]
  let effortPoints = 0
  for (const [label, points, formula] of factors) {
    show(label, points, 'points', 'estimated', formula)
    effortPoints += points
  }
  show('Effort points', effortPoints, 'points', 'estimated', 'Σ effort factors')

  const patternLinked = patterns.length > 0
  if (!patternLinked) {
    warn('NO_PATTERN', 'No linked pattern, so build hours start from config.estimation.fallbackPatternHours')
  }
  const baseHours = patternLinked
    ? patterns.reduce((sum, pattern) => sum + pattern.baseHours, 0)
    : config.estimation.fallbackPatternHours
  const effortSource: Source = patternLinked ? 'estimated' : 'default'
  show(
    'Base hours (uncalibrated)',
    baseHours,
    'hours',
    effortSource,
    patternLinked
      ? patterns.map((pattern) => `${pattern.id} (${fmt(pattern.baseHours)})`).join(' + ')
      : 'config.estimation.fallbackPatternHours (no pattern linked)',
  )
  const rawBuildHours = baseHours + effortPoints * config.scoring.hoursPerEffortPoint
  show(
    'Raw build hours',
    rawBuildHours,
    'hours',
    effortSource,
    `${fmt(baseHours)} + ${fmt(effortPoints)} × ${fmt(config.scoring.hoursPerEffortPoint)}`,
  )
  const effortScore = clampScore(Math.round((100 * rawBuildHours) / config.scoring.effortCeiling))
  show(
    'Effort score',
    effortScore,
    'points',
    effortSource,
    `min(100, round(100 × ${fmt(rawBuildHours)} / ${fmt(config.scoring.effortCeiling)}))`,
  )

  // §1.3 Confidence
  const defaults = assumptions.filter((traced) => traced.source === 'default').length
  const estimates = assumptions.filter((traced) => traced.source === 'estimated').length
  const noPatternPenalty = patternLinked ? 0 : CONFIDENCE_PENALTIES.noPattern
  const hourlyCostPenalty = everyHourlyCostClientStated ? 0 : CONFIDENCE_PENALTIES.hourlyCostNotClientStated
  const rawConfidence =
    CONFIDENCE_MAX -
    CONFIDENCE_PENALTIES.defaultSource * defaults -
    CONFIDENCE_PENALTIES.estimatedSource * estimates -
    noPatternPenalty -
    hourlyCostPenalty
  const confidence = Math.max(CONFIDENCE_MIN, Math.min(CONFIDENCE_MAX, rawConfidence))
  show(
    'Confidence',
    confidence,
    'percent',
    valueSource,
    `${CONFIDENCE_MAX} − ${CONFIDENCE_PENALTIES.defaultSource} × ${defaults} (default) − ${CONFIDENCE_PENALTIES.estimatedSource} × ${estimates} (estimated) − ${noPatternPenalty} (${patternLinked ? 'pattern linked' : 'no pattern linked'}) − ${hourlyCostPenalty} (hourly cost ${everyHourlyCostClientStated ? 'client-stated' : 'not client-stated'}), clamped to [${CONFIDENCE_MIN}, ${CONFIDENCE_MAX}]`,
  )
  if (confidence < LOW_CONFIDENCE_THRESHOLD) {
    warn(
      'LOW_CONFIDENCE',
      `Confidence ${confidence} is below ${LOW_CONFIDENCE_THRESHOLD}; warn before this opportunity reaches a proposal`,
    )
  }

  // §1.4 Priority and quadrant
  const priorityIndex = (valueScore * confidence) / 100 / (0.5 + effortScore / 100)
  show(
    'Priority index',
    priorityIndex,
    'index',
    valueSource,
    `(${fmt(valueScore)} × ${fmt(confidence)} / 100) / (0.5 + ${fmt(effortScore)} / 100)`,
  )
  const highValue = valueScore >= QUADRANT_THRESHOLD
  const highEffort = effortScore >= QUADRANT_THRESHOLD
  const quadrant: ScoringResult['quadrant'] = highValue
    ? highEffort
      ? 'strategic'
      : 'quick-win'
    : highEffort
      ? 'avoid'
      : 'fill-in'

  // Exactly the inputs read above, so an unread edit (a title, a sync timestamp) never
  // invalidates a cached score and a read one always does.
  const inputsHash = hashInputs({
    opportunity: {
      id: opportunity.id,
      processIds: opportunity.processIds,
      patternIds: opportunity.patternIds,
      automatablePercent: automatable,
      errorReductionPercent: errorReduction,
      effortInputs: effort,
    },
    processes: processes.map((process) => ({
      id: process.id,
      name: process.name,
      frequency: process.frequency,
      roleHourlyCost: process.roleHourlyCost,
      errorProfile: {
        errorRatePercent: process.errorProfile.errorRatePercent,
        costPerError: process.errorProfile.costPerError,
      },
      revenueImpact: process.revenueImpact,
    })),
    patterns: patterns.map((pattern) => ({ id: pattern.id, baseHours: pattern.baseHours })),
    company: { blendedHourlyCost: company.blendedHourlyCost },
    config: {
      agencyCurrency: eur,
      fxRates: config.fxRates.rates,
      scoring: config.scoring,
      fallbackPatternHours: config.estimation.fallbackPatternHours,
    },
  })

  return {
    annualValue,
    weightedValue,
    valueScore,
    effortPoints,
    rawBuildHours,
    effortScore,
    confidence,
    priorityIndex,
    quadrant,
    hoursSavedPerMonth,
    breakdown,
    assumptions,
    warnings,
    inputsHash,
    computedAt: now,
  }
}
