import type { Contact, DeliveryModel } from '../schema/company'
import type { Config } from '../schema/config'
import type { Engagement, LeadSource, Stage } from '../schema/engagement'
import type { Library, Pattern } from '../schema/library'
import type { EffortInputs, Opportunity } from '../schema/opportunity'
import type { Process } from '../schema/process'
import type { EstimateResult, ROIResult, RunCostResult, ScoringResult } from '../schema/results'
import type { RunCostLineItem } from '../schema/run-cost'
import type { Deliverable, Phase, ProjectScope } from '../schema/scope'
import type { Currency, Source, TracedValue } from '../schema/traced'

// The shape templates resolve against: one engagement, the Config and the Library flattened
// into plain data with every cross-reference already followed. Two rules make path resolution
// safe. Every optional field becomes null, so a key that is missing is always a typo in the
// template, and a null is always "not set" to be guarded with showIf. And a client-facing model
// never holds an internal figure: ranking rows are dropped by their audience flag and ranking
// fields are left out entirely, so a client template that names one fails to resolve instead of
// leaking it. No timestamp is put in the model: a section that read the clock would drift on
// every render and conflict with every override.

export type Audience = 'client' | 'internal'

export interface TracedView {
  value: number
  unit: string
  currency: Currency | null
  source: Source
  note: string | null
}

export interface BreakdownRowView {
  label: string
  value: number
  unit: string
  source: Source
  formula: string
}

export interface ClientScoringView {
  annualValue: number
  effortPoints: number
  rawBuildHours: number
  confidence: number
  hoursSavedPerMonth: number
  breakdown: BreakdownRowView[]
  assumptions: TracedView[]
  warnings: ScoringResult['warnings']
  computedAt: string
}

export interface InternalScoringView extends ClientScoringView {
  weightedValue: number
  valueScore: number
  effortScore: number
  priorityIndex: number
  quadrant: ScoringResult['quadrant']
}

export interface PatternView {
  id: string
  name: string
  category: string
  problem: string
  solution: string
  architecture: string
  clientExplanation: string
  risks: string[]
  complexity: Pattern['complexity']
}

export interface ProcessView {
  id: string
  name: string
  description: string
  owner: string | null
  frequency: {
    occurrencesPerMonth: TracedView
    minutesPerOccurrence: TracedView
    peopleInvolved: TracedView
  }
  roleHourlyCost: TracedView | null
  steps: {
    id: string
    action: string
    system: string | null
    isManual: boolean
    isBottleneck: boolean
    waitTimeMinutes: number | null
  }[]
  systemsTouched: string[]
  painPoints: string[]
  errorRatePercent: TracedView | null
  costPerError: TracedView | null
  errorDescription: string | null
  revenueImpact: Process['revenueImpact']
  customerFacing: boolean
}

export interface OpportunityView {
  id: string
  title: string
  summary: string
  processes: { id: string; name: string }[]
  patterns: PatternView[]
  primaryPattern: PatternView | null
  automatablePercent: TracedView
  errorReductionPercent: TracedView
  effortInputs: Omit<EffortInputs, 'integrations'> & {
    integrations: { name: string; hasPublicApi: boolean; authAvailable: boolean; notes: string | null }[]
  }
  scoring: ClientScoringView | InternalScoringView | null
}

export interface DeliverableView extends Omit<Deliverable, 'opportunityId'> {
  opportunity: { id: string; title: string } | null
}

export interface RunCostLineItemView extends Omit<RunCostLineItem, 'notes' | 'usageFormula'> {
  notes: string | null
  usageFormula: NonNullable<RunCostLineItem['usageFormula']> | null
}

export interface ScopeView {
  deliveryModel: DeliveryModel
  selected: OpportunityView[]
  deliverables: DeliverableView[]
  exclusions: string[]
  assumptions: string[]
  phases: Phase[]
  supportRetainerMonthly: number | null
  runCostItems: RunCostLineItemView[]
  estimate: EstimateResult | null
  runCost: RunCostResult | null
  roi: (Omit<ROIResult, 'assumptions'> & { assumptions: TracedView[] }) | null
}

export interface ContactView {
  id: string
  name: string
  role: string | null
  email: string | null
  phone: string | null
  isDecisionMaker: boolean
}

export interface ViewModel {
  agency: { name: string; email: string; website: string; vatId: string | null }
  company: {
    name: string
    website: string | null
    industry: string
    employeeCount: number | null
    locationCountry: string | null
    currency: Currency
    blendedHourlyCost: TracedView | null
    statedTools: string[]
    // Signal extraction only suggests; a tool is listed once Alex has confirmed it.
    confirmedTools: { name: string; category: string }[]
    sourceOfTruth: string | null
    compliance: string[]
    dataResidency: string | null
    securityNotes: string | null
    preferredDeliveryModel: DeliveryModel | null
  }
  contacts: ContactView[]
  decisionMakers: ContactView[]
  stage: Stage
  source: LeadSource
  tags: string[]
  processes: ProcessView[]
  opportunities: OpportunityView[]
  scope: ScopeView | null
}

export interface ViewModelInput {
  engagement: Engagement
  config: Config
  library: Library
  audience?: Audience
}

function orNull<T>(value: T | undefined): T | null {
  return value === undefined ? null : value
}

function traced(value: TracedValue): TracedView {
  return {
    value: value.value,
    unit: value.unit,
    currency: orNull(value.currency),
    source: value.source,
    note: orNull(value.note),
  }
}

function tracedOrNull(value: TracedValue | null): TracedView | null {
  return value === null ? null : traced(value)
}

function contactView(contact: Contact): ContactView {
  return {
    id: contact.id,
    name: contact.name,
    role: orNull(contact.role),
    email: orNull(contact.email),
    phone: orNull(contact.phone),
    isDecisionMaker: contact.isDecisionMaker,
  }
}

function patternView(pattern: Pattern): PatternView {
  return {
    id: pattern.id,
    name: pattern.name,
    category: pattern.category,
    problem: pattern.problem,
    solution: pattern.solution,
    architecture: pattern.architecture,
    clientExplanation: pattern.clientExplanation,
    risks: pattern.risks,
    complexity: pattern.complexity,
  }
}

function processView(process: Process): ProcessView {
  return {
    id: process.id,
    name: process.name,
    description: process.description,
    owner: orNull(process.owner),
    frequency: {
      occurrencesPerMonth: traced(process.frequency.occurrencesPerMonth),
      minutesPerOccurrence: traced(process.frequency.minutesPerOccurrence),
      peopleInvolved: traced(process.frequency.peopleInvolved),
    },
    roleHourlyCost: tracedOrNull(process.roleHourlyCost),
    steps: process.steps.map((step) => ({
      id: step.id,
      action: step.action,
      system: orNull(step.system),
      isManual: step.isManual,
      isBottleneck: step.isBottleneck,
      waitTimeMinutes: orNull(step.waitTimeMinutes),
    })),
    systemsTouched: process.systemsTouched,
    painPoints: process.painPoints,
    errorRatePercent: tracedOrNull(process.errorProfile.errorRatePercent),
    costPerError: tracedOrNull(process.errorProfile.costPerError),
    errorDescription: orNull(process.errorProfile.errorDescription),
    revenueImpact: process.revenueImpact,
    customerFacing: process.customerFacing,
  }
}

// Rows are filtered on their audience flag and never on label text (ENGINES §1, Renderer rule).
function scoringView(scoring: ScoringResult, audience: Audience): ClientScoringView | InternalScoringView {
  const client: ClientScoringView = {
    annualValue: scoring.annualValue,
    effortPoints: scoring.effortPoints,
    rawBuildHours: scoring.rawBuildHours,
    confidence: scoring.confidence,
    hoursSavedPerMonth: scoring.hoursSavedPerMonth,
    breakdown: scoring.breakdown
      .filter((row) => audience === 'internal' || row.audience === 'client')
      .map(({ label, value, unit, source, formula }) => ({ label, value, unit, source, formula })),
    assumptions: scoring.assumptions.map(traced),
    warnings: scoring.warnings,
    computedAt: scoring.computedAt,
  }
  if (audience === 'client') return client
  return {
    ...client,
    weightedValue: scoring.weightedValue,
    valueScore: scoring.valueScore,
    effortScore: scoring.effortScore,
    priorityIndex: scoring.priorityIndex,
    quadrant: scoring.quadrant,
  }
}

function opportunityView(
  opportunity: Opportunity,
  processesById: Map<string, Process>,
  patternsById: Map<string, Pattern>,
  audience: Audience,
): OpportunityView {
  const patterns = opportunity.patternIds.flatMap((id) => {
    const pattern = patternsById.get(id)
    return pattern === undefined ? [] : [patternView(pattern)]
  })
  const primary = opportunity.primaryPatternId === null ? undefined : patternsById.get(opportunity.primaryPatternId)
  return {
    id: opportunity.id,
    title: opportunity.title,
    summary: opportunity.summary,
    processes: opportunity.processIds.flatMap((id) => {
      const process = processesById.get(id)
      return process === undefined ? [] : [{ id: process.id, name: process.name }]
    }),
    patterns,
    primaryPattern: primary === undefined ? null : patternView(primary),
    automatablePercent: traced(opportunity.automatablePercent),
    errorReductionPercent: traced(opportunity.errorReductionPercent),
    effortInputs: {
      ...opportunity.effortInputs,
      integrations: opportunity.effortInputs.integrations.map((integration) => ({
        name: integration.name,
        hasPublicApi: integration.hasPublicApi,
        authAvailable: integration.authAvailable,
        notes: orNull(integration.notes),
      })),
    },
    scoring: opportunity.scoring === null ? null : scoringView(opportunity.scoring, audience),
  }
}

function scopeView(scope: ProjectScope, opportunities: OpportunityView[]): ScopeView {
  const byId = new Map(opportunities.map((opportunity) => [opportunity.id, opportunity]))
  return {
    deliveryModel: scope.deliveryModel,
    // In the scope's own order, which is the only record of what is selected. An id whose
    // opportunity no longer exists has nothing to show and is skipped, as the engines skip it.
    selected: scope.selectedOpportunityIds.flatMap((id) => {
      const opportunity = byId.get(id)
      return opportunity === undefined ? [] : [opportunity]
    }),
    deliverables: scope.deliverables.map(({ opportunityId, ...deliverable }) => {
      const opportunity = opportunityId === undefined ? undefined : byId.get(opportunityId)
      return {
        ...deliverable,
        opportunity: opportunity === undefined ? null : { id: opportunity.id, title: opportunity.title },
      }
    }),
    exclusions: scope.exclusions,
    assumptions: scope.assumptions,
    phases: [...scope.phases].sort((a, b) => a.order - b.order),
    supportRetainerMonthly: scope.supportRetainerMonthly,
    runCostItems: scope.runCostItems.map(({ notes, usageFormula, ...item }) => ({
      ...item,
      notes: orNull(notes),
      usageFormula: orNull(usageFormula),
    })),
    estimate: scope.estimate,
    runCost: scope.runCost,
    roi: scope.roi === null ? null : { ...scope.roi, assumptions: scope.roi.assumptions.map(traced) },
  }
}

export function buildViewModel({ engagement, config, library, audience = 'client' }: ViewModelInput): ViewModel {
  const { company } = engagement
  const processesById = new Map(engagement.processes.map((process) => [process.id, process]))
  const patternsById = new Map(library.patterns.map((pattern) => [pattern.id, pattern]))
  const contacts = engagement.contacts.map(contactView)
  const opportunities = engagement.opportunities.map((opportunity) =>
    opportunityView(opportunity, processesById, patternsById, audience),
  )
  return {
    agency: {
      name: config.agency.name,
      email: config.agency.email,
      website: config.agency.website,
      vatId: orNull(config.agency.vatId),
    },
    company: {
      name: company.name,
      website: orNull(company.website),
      industry: company.industry,
      employeeCount: orNull(company.employeeCount),
      locationCountry: orNull(company.locationCountry),
      currency: company.currency,
      blendedHourlyCost: tracedOrNull(company.blendedHourlyCost),
      statedTools: company.statedTools,
      confirmedTools: company.detectedStack
        .filter((tool) => tool.confirmed)
        .map((tool) => ({ name: tool.name, category: tool.category })),
      sourceOfTruth: orNull(company.sourceOfTruth),
      compliance: company.constraints.compliance,
      dataResidency: orNull(company.constraints.dataResidency),
      securityNotes: orNull(company.constraints.securityNotes),
      preferredDeliveryModel: orNull(company.preferredDeliveryModel),
    },
    contacts,
    decisionMakers: contacts.filter((contact) => contact.isDecisionMaker),
    stage: engagement.stage,
    source: engagement.source,
    tags: engagement.tags,
    processes: engagement.processes.map(processView),
    opportunities,
    scope: engagement.scope === null ? null : scopeView(engagement.scope, opportunities),
  }
}
