import { EngagementSchema, StageSchema, type Engagement, type LeadSource, type Stage } from '../schema/engagement'
import type { Currency } from '../schema/traced'
import { schemaIssues, type FormIssue } from './form-paths'

// The engagement list and the new-engagement panel, as pure functions.

export type NextActionFilter = 'any' | 'with' | 'without' | 'due'

export interface EngagementFilter {
  stage: Stage | null
  tag: string | null
  nextAction: NextActionFilter
}

export const NO_FILTER: EngagementFilter = { stage: null, tag: null, nextAction: 'any' }

// `today` is the local calendar date as YYYY-MM-DD. The schema holds every due date to that form, so
// "due today or earlier" is a string comparison.
export function filterEngagements(engagements: readonly Engagement[], filter: EngagementFilter, today: string): Engagement[] {
  return engagements.filter((engagement) => {
    if (filter.stage !== null && engagement.stage !== filter.stage) return false
    if (filter.tag !== null && !engagement.tags.includes(filter.tag)) return false
    const { nextAction } = engagement
    switch (filter.nextAction) {
      case 'any':
        return true
      case 'with':
        return nextAction !== null
      case 'without':
        return nextAction === null
      case 'due':
        return nextAction?.due !== undefined && nextAction.due <= today
    }
  })
}

const TAGS = new Intl.Collator('en-GB', { sensitivity: 'base', numeric: true })

// Every tag in use, once, in reading order.
export function tagOptions(engagements: readonly Engagement[]): string[] {
  return [...new Set(engagements.flatMap((engagement) => engagement.tags))].sort((a, b) => TAGS.compare(a, b))
}

// Stages sort by where they sit in the pipeline, not alphabetically.
export function stageOrder(stage: Stage): number {
  return StageSchema.options.indexOf(stage)
}

// ---- New engagement -------------------------------------------------------------------------------

export interface NewEngagementDraft {
  name: string
  industry: string
  currency: Currency
  // No default: where a lead came from is only worth recording if someone chose it.
  source: LeadSource | null
  stage: Stage
}

export const SOURCE_REQUIRED = 'Choose where this engagement came from'

// Currency and stage start filled in and visible: most companies are EUR companies, and most
// engagements start as a lead.
export function initialNewEngagement(): NewEngagementDraft {
  return { name: '', industry: '', currency: 'EUR', source: null, stage: 'LEAD' }
}

export type BuiltEngagement = { ok: true; engagement: Engagement } | { ok: false; issues: FormIssue[] }

// Issues are at the engagement's own paths ('company.name', 'source'), which the panel's controls carry.
export function buildNewEngagement(draft: NewEngagementDraft, id: string, now: string): BuiltEngagement {
  const candidate: Engagement = {
    id,
    createdAt: now,
    updatedAt: now,
    company: {
      name: draft.name,
      industry: draft.industry,
      currency: draft.currency,
      blendedHourlyCost: null,
      detectedStack: [],
      statedTools: [],
      constraints: { compliance: [] },
    },
    contacts: [],
    stage: draft.stage,
    // A stand-in while none is chosen, so the rest is still checked; the missing choice is reported below.
    source: draft.source ?? 'other',
    stageHistory: [{ stage: draft.stage, at: now }],
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
  const result = EngagementSchema.safeParse(candidate)
  const issues = [...(draft.source === null ? [{ path: 'source', message: SOURCE_REQUIRED }] : []), ...schemaIssues(result.error)]
  if (issues.length > 0 || !result.success) return { ok: false, issues }
  return { ok: true, engagement: result.data }
}
