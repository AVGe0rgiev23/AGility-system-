import type { z } from 'zod'
import type { Blueprint } from '../blueprint'
import type { Company, Contact, DetectedTool, TimestampedNote } from '../company'
import type { Answer, DiscoverySession, Question, QuestionSet } from '../discovery'
import type { Opportunity } from '../opportunity'
import type { Process, ProcessStep } from '../process'
import type { EstimateResult, ROIResult, RunCostResult, ScoringResult } from '../results'
import type { RunCostLineItem } from '../run-cost'
import type { TracedValue } from '../traced'

// Builders return fresh objects so a test can mutate or spread without leaking into others.

export function tracedHours(): TracedValue {
  return {
    value: 4,
    unit: 'hours/week',
    source: 'client-stated',
    note: "Marta said 'about 4 hours, most weeks'",
    capturedAt: '2026-09-10T09:30:00.000Z',
    answerId: 'ans-hours',
  }
}

export function tracedMoney(): TracedValue {
  return { value: 32, unit: 'BGN/hour', currency: 'BGN', source: 'estimated' }
}

export function tracedPercent(): TracedValue {
  return { value: 70, unit: 'percent', source: 'estimated' }
}

export function detectedTool(): DetectedTool {
  return {
    name: 'HubSpot',
    category: 'crm',
    evidence: 'js.hs-scripts.com/1234567.js',
    confidence: 'high',
    confirmed: false,
  }
}

export function contact(): Contact {
  return { id: 'ct-1', name: 'Marta Ivanova', role: 'Operations lead', isDecisionMaker: true }
}

export function timestampedNote(): TimestampedNote {
  return { id: 'note-1', at: '2026-09-10T10:00:00.000Z', body: 'Prefers async updates.', tags: [] }
}

export function company(): Company {
  return {
    name: 'Rila Logistics',
    website: 'https://rila-logistics.example',
    industry: 'logistics',
    employeeCount: 40,
    locationCountry: 'BG',
    currency: 'BGN',
    blendedHourlyCost: tracedMoney(),
    detectedStack: [detectedTool()],
    statedTools: ['Google Sheets', 'HubSpot'],
    sourceOfTruth: 'HubSpot for contacts, Sheets for jobs',
    constraints: { compliance: ['GDPR'] },
    preferredDeliveryModel: 'hybrid',
  }
}

export function processStep(): ProcessStep {
  return {
    id: 'step-1',
    action: 'Copy quote request from email into CRM',
    system: 'HubSpot',
    isManual: true,
    isBottleneck: true,
    waitTimeMinutes: 90,
  }
}

export function businessProcess(): Process {
  return {
    id: 'proc-1',
    name: 'Quote request to CRM entry',
    description: 'Inbound quote emails are retyped into HubSpot by hand.',
    owner: 'Dispatcher',
    frequency: {
      occurrencesPerMonth: { value: 120, unit: 'count/month', source: 'client-stated' },
      minutesPerOccurrence: { value: 12, unit: 'minutes', source: 'measured' },
      peopleInvolved: { value: 2, unit: 'count', source: 'client-stated' },
    },
    roleHourlyCost: null,
    steps: [processStep()],
    systemsTouched: ['Gmail', 'HubSpot'],
    painPoints: ['Retyping', 'Missed follow-ups'],
    errorProfile: {
      errorRatePercent: { value: 5, unit: 'percent', source: 'estimated' },
      costPerError: { value: 40, unit: 'EUR', currency: 'EUR', source: 'estimated' },
      errorDescription: 'Wrong delivery address copied',
    },
    revenueImpact: 'direct',
    customerFacing: true,
  }
}

export function runCostLineItem(): RunCostLineItem {
  return {
    id: 'rc-hosting',
    label: 'Worker hosting',
    category: 'hosting',
    monthlyCost: 5,
    paidBy: { 'fully-managed': 'agency', 'client-owned': 'client', hybrid: 'client' },
    usageBased: false,
  }
}

export function usageRunCostLineItem(): RunCostLineItem {
  return {
    id: 'rc-ai',
    label: 'Email classification model',
    category: 'ai',
    monthlyCost: 0,
    paidBy: { 'fully-managed': 'agency', 'client-owned': 'client', hybrid: 'client' },
    usageBased: true,
    usageFormula: {
      callsPerMonth: 3000,
      avgInputTokens: 1200,
      avgOutputTokens: 150,
      inputPricePerMTok: 0.9,
      outputPricePerMTok: 4.5,
    },
  }
}

export function scoringResult(): ScoringResult {
  return {
    annualValue: 18240,
    weightedValue: 22800,
    valueScore: 76,
    effortPoints: 9,
    rawBuildHours: 21.5,
    effortScore: 27,
    confidence: 82,
    priorityIndex: 80.4,
    quadrant: 'quick-win',
    hoursSavedPerMonth: 33.6,
    breakdown: [
      {
        label: 'Hours wasted per month',
        value: 48,
        unit: 'hours/month',
        source: 'client-stated',
        formula: '(120 × 12 × 2) / 60',
      },
    ],
    assumptions: [tracedHours()],
    warnings: [],
    inputsHash: 'h-scoring',
    computedAt: '2026-09-14T08:00:00.000Z',
  }
}

export function estimateResult(): EstimateResult {
  return {
    calibratedHours: 21.5,
    overheadBreakdown: [
      { label: 'discovery', hours: 2.15 },
      { label: 'testing', hours: 4.3 },
      { label: 'documentation', hours: 2.15 },
      { label: 'deployment', hours: 1.72 },
    ],
    contingencyHours: 4.773,
    totalHours: 36.593,
    bandId: 'full-workflow',
    indicativePrice: 2378.545,
    price: 2378.545,
    effectiveHourlyRate: 65,
    flags: ['UNCALIBRATED_PATTERN'],
    perOpportunity: [
      {
        opportunityId: 'opp-1',
        rawHours: 21.5,
        multiplier: 1,
        trustworthy: false,
        calibratedHours: 21.5,
      },
    ],
    advisoryBlueprintHours: null,
    inputsHash: 'h-estimate',
    computedAt: '2026-09-14T08:00:00.000Z',
  }
}

export function runCostResult(): RunCostResult {
  const perModel = { clientMonthly: 5, agencyMonthly: 0, agencyAnnual: 0, lineItems: [] }
  return {
    perModel: { 'fully-managed': perModel, 'client-owned': perModel, hybrid: perModel },
    selectedModel: 'hybrid',
    clientMonthly: 5,
    agencyMonthly: 0,
    agencyAnnual: 0,
    warnings: [],
    inputsHash: 'h-runcost',
    computedAt: '2026-09-14T08:00:00.000Z',
  }
}

export function roiResult(): ROIResult {
  const scenario = {
    grossAnnualValue: 18240,
    netAnnualBenefit: 18180,
    paybackMonths: 1.57,
    roiYear1: 6.64,
    roiYear3: 21.93,
    npv: 44473,
  }
  return {
    scenarios: {
      conservative: { ...scenario, paybackMonths: null },
      expected: scenario,
      optimistic: scenario,
    },
    hoursSavedPerMonth: 33.6,
    hoursSavedPerYear: 403.2,
    implementationCost: 2378.545,
    annualRunCost: 60,
    assumptions: [tracedHours()],
    lowestConfidence: 82,
    warnings: [],
    inputsHash: 'h-roi',
    computedAt: '2026-09-14T08:00:00.000Z',
  }
}

export function opportunity(): Opportunity {
  return {
    id: 'opp-1',
    processIds: ['proc-1'],
    title: 'Automatic quote intake',
    summary: 'Quote emails land in HubSpot as structured deals within a minute.',
    patternIds: ['pat-email-triage', 'pat-crm-sync'],
    primaryPatternId: 'pat-email-triage',
    automatablePercent: tracedPercent(),
    errorReductionPercent: { value: 80, unit: 'percent', source: 'default' },
    effortInputs: {
      integrations: [{ name: 'HubSpot', hasPublicApi: true, authAvailable: true }],
      dataReadiness: 'semi-structured',
      approvalSteps: 1,
      complianceFlags: [],
      volumeTier: 'medium',
      novelty: 'known-pattern',
      requiresHumanInLoop: false,
    },
    scoring: null,
    selected: true,
  }
}

export function blueprint(): Blueprint {
  return {
    id: 'bp-1',
    opportunityId: 'opp-1',
    name: 'Quote intake',
    nodes: [
      { id: 'n-1', kind: 'trigger', name: 'New email', purpose: 'Starts on each quote email', requiresApproval: false },
      {
        id: 'n-2',
        kind: 'action',
        name: 'Create deal',
        purpose: 'Creates the HubSpot deal',
        service: 'HubSpot',
        requiresApproval: false,
        advisoryHours: 3,
      },
    ],
    edges: [{ from: 'n-1', to: 'n-2' }],
  }
}

export function answer(): Answer {
  return {
    id: 'ans-hours',
    questionId: 'q-hours',
    kind: 'number',
    value: 4,
    traced: tracedHours(),
    followUpTriggered: ['q-hours-detail'],
    flags: ['pain'],
  }
}

export function discoverySession(): DiscoverySession {
  return {
    id: 'ds-1',
    kind: 'discovery',
    questionSetId: 'qs-discovery',
    heldAt: '2026-09-10T09:00:00.000Z',
    attendees: ['Marta Ivanova'],
    answers: [answer()],
    rawNotes: 'Keen to start before peak season.',
    completeness: 60,
  }
}

export function question(): Question {
  return {
    id: 'q-hourly-cost',
    text: 'Roughly what does an hour of this person’s time cost you?',
    kind: 'number',
    required: true,
    showIf: { answerId: 'q-has-staff', equals: true },
    mapsTo: 'company.blendedHourlyCost',
    suggestsPatterns: ['pat-email-triage'],
  }
}

export function questionSet(): QuestionSet {
  return {
    id: 'qs-discovery',
    name: 'Full discovery',
    kind: 'discovery',
    appliesTo: { industries: ['logistics'], minEmployees: 5 },
    questions: [question()],
  }
}

export function issuePaths(schema: z.ZodType, input: unknown): string[] {
  const result = schema.safeParse(input)
  return result.success ? [] : result.error.issues.map((issue) => issue.path.map(String).join('.'))
}

export function roundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown
}
