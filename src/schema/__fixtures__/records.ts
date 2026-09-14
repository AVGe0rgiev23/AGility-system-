import type { z } from 'zod'
import type { Blueprint } from '../blueprint'
import type { Company, Contact, DetectedTool, TimestampedNote } from '../company'
import { defaultConfig } from '../config'
import type { Answer, DiscoverySession, Question, QuestionSet } from '../discovery'
import type { Engagement } from '../engagement'
import type { CalibrationRecord, DocumentTemplate, Library, Pattern } from '../library'
import type { Meta } from '../meta'
import type { Opportunity } from '../opportunity'
import type { Process, ProcessStep } from '../process'
import type { EstimateResult, ROIResult, RunCostResult, ScoringResult } from '../results'
import type { RunCostLineItem } from '../run-cost'
import type {
  ArtifactRef,
  ArtifactSet,
  Deliverable,
  Phase,
  Project,
  ProjectScope,
  Task,
  TimeEntry,
} from '../scope'
import type { WholeStore } from '../store'
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

export function deliverable(): Deliverable {
  return {
    id: 'del-1',
    name: 'Quote intake automation',
    description: 'Quote emails become HubSpot deals without retyping.',
    acceptanceCriteria: ['A test quote email creates exactly one HubSpot deal within 2 minutes'],
    opportunityId: 'opp-1',
  }
}

export function phase(): Phase {
  return { id: 'ph-1', name: 'Build', description: 'Build and test the intake flow.', order: 1, estimatedWeeks: 2 }
}

export function projectScope(): ProjectScope {
  return {
    selectedOpportunityIds: ['opp-1'],
    deliveryModel: 'hybrid',
    deliverables: [deliverable()],
    exclusions: ['Historic email backfill'],
    assumptions: ['HubSpot API access is granted in week 1'],
    phases: [phase()],
    supportRetainerMonthly: 350,
    runCostItems: [runCostLineItem(), usageRunCostLineItem()],
    estimate: estimateResult(),
    runCost: runCostResult(),
    roi: roiResult(),
  }
}

export function artifactRef(): ArtifactRef {
  return {
    templateId: 'tpl-proposal',
    overrides: [
      {
        sectionId: 'executive-summary',
        content: 'Rewritten opening paragraph.',
        editedAt: '2026-09-12T14:00:00.000Z',
        baseInputsHash: 'h-estimate',
      },
    ],
    lastRenderedAt: '2026-09-12T14:05:00.000Z',
    sentAt: null,
    version: 2,
  }
}

export function artifactSet(): ArtifactSet {
  return {
    teardown: null,
    proposal: artifactRef(),
    sow: null,
    projectPlan: null,
    handoverDocs: null,
    caseStudy: null,
  }
}

export function task(): Task {
  return {
    id: 'task-1',
    phaseId: 'ph-1',
    title: 'Parse quote emails',
    patternId: 'pat-email-triage',
    estimatedHours: 6,
    actualHours: null,
    status: 'doing',
  }
}

export function timeEntry(): TimeEntry {
  return { id: 'te-1', taskId: 'task-1', minutes: 90, at: '2026-09-13T11:00:00.000Z', note: 'Parser first pass' }
}

export function project(): Project {
  return {
    startedAt: '2026-09-13T09:00:00.000Z',
    phases: [phase()],
    tasks: [task()],
    timeLog: [timeEntry()],
    status: 'active',
    deliveredAt: null,
  }
}

// A brand-new lead: nothing captured yet beyond the company.
export function newEngagement(): Engagement {
  return {
    id: 'eng-2',
    createdAt: '2026-09-14T08:00:00.000Z',
    updatedAt: '2026-09-14T08:00:00.000Z',
    company: {
      name: 'Solo Bakery',
      industry: 'E-commerce',
      currency: 'EUR',
      blendedHourlyCost: null,
      detectedStack: [],
      statedTools: [],
      constraints: { compliance: [] },
    },
    contacts: [],
    stage: 'LEAD',
    source: 'inbound-form',
    stageHistory: [{ stage: 'LEAD', at: '2026-09-14T08:00:00.000Z' }],
    discovery: [],
    processes: [],
    opportunities: [],
    blueprints: [],
    scope: null,
    artifacts: { teardown: null, proposal: null, sow: null, projectPlan: null, handoverDocs: null, caseStudy: null },
    project: null,
    tags: [],
    notes: [],
    nextAction: null,
  }
}

// An engagement with every section populated, so nested validation is exercised end to end.
export function engagement(): Engagement {
  return {
    id: 'eng-1',
    createdAt: '2026-09-01T08:00:00.000Z',
    updatedAt: '2026-09-13T11:00:00.000Z',
    company: company(),
    contacts: [contact()],
    stage: 'IMPLEMENTATION',
    source: 'teardown',
    stageHistory: [
      { stage: 'LEAD', at: '2026-09-01T08:00:00.000Z' },
      { stage: 'WON', at: '2026-09-12T16:00:00.000Z', note: 'Signed the SOW' },
      { stage: 'IMPLEMENTATION', at: '2026-09-13T09:00:00.000Z' },
    ],
    discovery: [discoverySession()],
    processes: [businessProcess()],
    opportunities: [{ ...opportunity(), scoring: scoringResult() }],
    blueprints: [blueprint()],
    scope: projectScope(),
    artifacts: artifactSet(),
    project: project(),
    tags: ['logistics'],
    notes: [timestampedNote()],
    nextAction: { text: 'Send week 1 update', due: '2026-09-18' },
  }
}

export function pattern(): Pattern {
  const { id: _id, opportunityId: _opportunityId, ...skeleton } = blueprint()
  return {
    id: 'pat-email-triage',
    name: 'Email triage',
    category: 'email',
    problem: 'Inbound requests are read and retyped by hand.',
    solution: 'Incoming email is classified and routed automatically.',
    architecture: 'Mailbox webhook, classifier, CRM write with retry.',
    requiredIntegrations: ['Gmail', 'HubSpot'],
    complexity: 'medium',
    baseHours: 12,
    risks: ['Ambiguous emails need a human fallback'],
    clientExplanation: 'Every request lands in the right place without anyone copying it.',
    blueprintSkeleton: skeleton,
    codeNotes: 'Keep the classifier prompt versioned.',
    usedInEngagements: ['eng-1'],
  }
}

export function calibrationRecord(): CalibrationRecord {
  return {
    patternId: 'pat-email-triage',
    samples: [
      { engagementId: 'eng-0', estimatedHours: 20, actualHours: 26, completedAt: '2026-08-30T17:00:00.000Z' },
    ],
    multiplier: 1,
    sampleCount: 1,
    trustworthy: false,
  }
}

export function documentTemplate(): DocumentTemplate {
  return {
    id: 'tpl-proposal',
    kind: 'proposal',
    name: 'Standard proposal',
    sections: [
      { id: 'executive-summary', heading: 'Executive summary', body: '{{company.name}} spends too long retyping quotes.' },
      {
        id: 'deliverables',
        heading: 'Deliverables',
        body: '{{name}}',
        showIf: 'scope.deliverables',
        repeatOver: 'scope.deliverables',
      },
    ],
  }
}

export function library(): Library {
  return {
    patterns: [pattern()],
    questionSets: [questionSet()],
    templates: [documentTemplate()],
    calibration: [calibrationRecord()],
  }
}

export function meta(): Meta {
  return {
    schemaVersion: 1,
    createdAt: '2026-09-01T08:00:00.000Z',
    lastMigratedAt: null,
    appVersion: '0.0.0',
  }
}

export function wholeStore(): WholeStore {
  return {
    meta: meta(),
    config: defaultConfig(),
    library: library(),
    engagements: [engagement(), newEngagement()],
  }
}

export function issuePaths(schema: z.ZodType, input: unknown): string[] {
  const result = schema.safeParse(input)
  return result.success ? [] : result.error.issues.map((issue) => issue.path.map(String).join('.'))
}

export function roundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown
}
