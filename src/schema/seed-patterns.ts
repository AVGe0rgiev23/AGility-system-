import type { Pattern } from './library'

// The eight patterns BUILD-PLAN names, seeded on a new store the way the standard question sets are.
// Ids are readable and stable, so an existing store can be offered whichever it is missing, and so a
// linked opportunity's patternIds and primaryPatternId, and a CalibrationRecord's patternId, always
// name the same pattern.
//
// These ids are also what src/engines/signal-rules.ts's pain rules name as candidate patterns
// (ENGINES §6). schema/ may not import engines/ (schema is the base layer; engines imports schema,
// never the reverse), so the ids are written here as the same literal strings rather than imported,
// and hooks/pattern-library.test.ts pins the two lists equal so a typo on either side fails a test
// immediately rather than silently leaving a pain hint unresolved.

export const PAT_LEAD_ENRICHMENT = 'pat-lead-enrichment'
export const PAT_EMAIL_TRIAGE = 'pat-email-triage'
export const PAT_DOCUMENT_EXTRACTION = 'pat-document-extraction'
export const PAT_CRM_SYNC = 'pat-crm-sync'
export const PAT_WEBHOOK_PROCESSING = 'pat-webhook-processing'
export const PAT_APPROVAL_WORKFLOW = 'pat-approval-workflow'
export const PAT_REPORTING_AUTOMATION = 'pat-reporting-automation'
export const PAT_INVOICE_PROCESSING = 'pat-invoice-processing'

export const SEED_PATTERN_IDS: readonly string[] = [
  PAT_LEAD_ENRICHMENT,
  PAT_EMAIL_TRIAGE,
  PAT_DOCUMENT_EXTRACTION,
  PAT_CRM_SYNC,
  PAT_WEBHOOK_PROCESSING,
  PAT_APPROVAL_WORKFLOW,
  PAT_REPORTING_AUTOMATION,
  PAT_INVOICE_PROCESSING,
] as const

// A fresh object per call, like seedQuestionSets, so a caller can never mutate the seed itself.
export function seedPatterns(): Pattern[] {
  return [
    {
      id: PAT_LEAD_ENRICHMENT,
      name: 'Lead enrichment',
      category: 'sales',
      problem: 'A new lead arrives with only a name and an email address, so someone has to look up the company, role and fit before it is worth a reply.',
      solution: 'Each new lead is enriched from public company and contact data the moment it comes in, and the CRM record is filled in automatically.',
      architecture: 'Form or CRM webhook trigger, enrichment API lookup by domain or email, field mapping back onto the CRM contact and company records, with a fallback note when nothing is found.',
      requiredIntegrations: ['CRM', 'Enrichment API'],
      complexity: 'low',
      baseHours: 8,
      risks: ['An enrichment provider can misidentify a small or new company', 'A personal email domain returns nothing to enrich'],
      clientExplanation: 'Every lead lands in your CRM already filled in, so the first reply can be about the business, not spent looking it up.',
      blueprintSkeleton: null,
      codeNotes: 'Cache enrichment lookups by domain for a day; the same company applies for several leads in a row.',
      usedInEngagements: [],
    },
    {
      id: PAT_EMAIL_TRIAGE,
      name: 'Email triage',
      category: 'email',
      problem: 'Inbound requests land in a shared inbox and are read, classified and forwarded by hand, so nothing moves until someone has time to open the mailbox.',
      solution: 'Incoming email is classified by intent and routed to the right person or system automatically, with the original message attached.',
      architecture: 'Mailbox webhook or polling trigger, a classifier over subject and body, routing rules to a destination inbox, ticket system or CRM, with a manual-review queue for anything below confidence.',
      requiredIntegrations: ['Mailbox', 'Destination system (CRM or helpdesk)'],
      complexity: 'medium',
      baseHours: 12,
      risks: ['An ambiguous email needs a human fallback rather than a wrong routing', 'A classifier trained on one season of email drifts as the business changes'],
      clientExplanation: 'Every message reaches the right person within moments of arriving, without anyone reading the mailbox to route it.',
      blueprintSkeleton: null,
      codeNotes: 'Keep the classifier prompt or rule set versioned, and log every classification with its confidence for later review.',
      usedInEngagements: [],
    },
    {
      id: PAT_DOCUMENT_EXTRACTION,
      name: 'Document extraction',
      category: 'documents',
      problem: 'PDFs, scans and photographed forms arrive by email or upload, and someone retypes the figures on them into a system by hand.',
      solution: 'Each document is read automatically and its fields are extracted into structured data, with a confidence score on every field.',
      architecture: 'Intake trigger (email attachment or upload), OCR or document-model extraction, field validation against expected formats, write to the destination system, with a human-review step for low-confidence fields.',
      requiredIntegrations: ['Document intake (email or upload)', 'Destination system'],
      complexity: 'high',
      baseHours: 20,
      risks: ['A handwritten or poorly scanned document extracts unreliably', 'A new document layout needs its own template or a retrained model'],
      clientExplanation: 'A document is read the moment it arrives, and only the fields worth a second look are ever shown to someone.',
      blueprintSkeleton: null,
      codeNotes: 'Keep raw extraction output alongside the parsed fields, so a wrong value can be traced back to what the model actually read.',
      usedInEngagements: [],
    },
    {
      id: PAT_CRM_SYNC,
      name: 'CRM sync',
      category: 'crm',
      problem: 'The same contact or deal is kept in two systems by hand, so the two copies drift apart and nobody is sure which one is current.',
      solution: 'Records in both systems are kept in sync automatically, in whichever direction each field is meant to flow.',
      architecture: 'Change trigger on each system (webhook or poll), field mapping between the two schemas, conflict rule for a field both systems can write, write-back with retry on failure.',
      requiredIntegrations: ['CRM', 'Second system (accounting, support or marketing tool)'],
      complexity: 'medium',
      baseHours: 10,
      risks: ['A field both systems can edit needs an explicit rule for which one wins', 'A renamed or merged record on either side can desynchronise the pair'],
      clientExplanation: "Update a contact in either system and the other one catches up within moments, so there is one true record in practice, wherever it's kept.",
      blueprintSkeleton: null,
      codeNotes: 'Store the last-synced value per field, not just per record, so a conflict rule can compare what actually changed on each side.',
      usedInEngagements: [],
    },
    {
      id: PAT_WEBHOOK_PROCESSING,
      name: 'Webhook processing',
      category: 'integration',
      problem: 'An event a system already fires (a payment, a signup, a status change) is picked up and acted on by hand, or not at all.',
      solution: 'Incoming events are received, validated and acted on automatically, with nothing lost if the destination system is briefly unavailable.',
      architecture: 'Webhook endpoint with signature verification, a queue so a burst of events does not overwhelm the destination, idempotent processing keyed on the event id, retry with backoff on failure.',
      requiredIntegrations: ['Event source', 'Destination system'],
      complexity: 'low',
      baseHours: 8,
      risks: ['A source that resends an event on retry needs idempotent handling or it is actioned twice', 'A destination outage needs a queue, or events are lost rather than delayed'],
      clientExplanation: 'The moment something happens in one system, the right action happens in the next one, without anyone watching for it.',
      blueprintSkeleton: null,
      codeNotes: 'Log every received event with its id before processing, so a replay after an incident can be checked against what already ran.',
      usedInEngagements: [],
    },
    {
      id: PAT_APPROVAL_WORKFLOW,
      name: 'Approval workflow',
      category: 'operations',
      problem: 'A request has to be approved before it proceeds, and today that means an email chain, a chased Slack message, or a spreadsheet nobody remembers to check.',
      solution: 'A request is routed to the right approver automatically, with a reminder if it sits too long, and the outcome is recorded and acted on.',
      architecture: 'Request intake (form or system trigger), approver routing rule, notification and reminder schedule, state tracking (pending, approved, rejected), and a write-back or next action once decided.',
      requiredIntegrations: ['Request source', 'Notification channel (email or chat)'],
      complexity: 'medium',
      baseHours: 14,
      risks: ["An approver who leaves the business needs a fallback, or a request waits forever", 'A routing rule that depends on amount or type needs to stay in step with policy changes'],
      clientExplanation: 'A request reaches the right approver straight away, gets chased automatically if it sits too long, and its outcome is recorded without anyone chasing it by hand.',
      blueprintSkeleton: null,
      codeNotes: 'Keep the full decision trail (who, when, what they saw) on the record, not just the final status.',
      usedInEngagements: [],
    },
    {
      id: PAT_REPORTING_AUTOMATION,
      name: 'Reporting automation',
      category: 'reporting',
      problem: 'A recurring report is built by hand from several systems, on a spreadsheet that only one person knows how to update.',
      solution: 'Figures are pulled from every source system on a schedule and assembled into the report automatically, in the same shape every time.',
      architecture: 'Scheduled trigger, one data pull per source system, transformation into the report shape, delivery (a document, a dashboard refresh, or a sent file).',
      requiredIntegrations: ['Each source system the report draws from'],
      complexity: 'medium',
      baseHours: 10,
      risks: ['A source system changing its export format silently breaks the pull', 'A figure that needs a judgment call (an adjustment, an exclusion) has nowhere to go unless the automation has a manual-override step'],
      clientExplanation: 'The report is ready every time on the same schedule, built from the same sources the same way, so nobody needs to remember to make it.',
      blueprintSkeleton: null,
      codeNotes: 'Fail loudly and skip the run rather than send a report built from a partial pull.',
      usedInEngagements: [],
    },
    {
      id: PAT_INVOICE_PROCESSING,
      name: 'Invoice processing',
      category: 'finance',
      problem: 'A supplier invoice arrives by email, and someone reads it, checks it against the order, and types it into the accounting system by hand.',
      solution: 'An incoming invoice is read, matched against the purchase order, and posted to accounting automatically, with anything that does not match held for review.',
      architecture: 'Email or upload intake, document extraction of the invoice fields, matching against the purchase order or expected supplier terms, posting to the accounting system, exception queue for anything unmatched.',
      requiredIntegrations: ['Invoice intake (email or upload)', 'Accounting system'],
      complexity: 'high',
      baseHours: 18,
      risks: ['A supplier invoice format the extraction has not seen needs its own handling', 'A three-way match against a purchase order needs that data to already be accurate in the accounting system'],
      clientExplanation: 'A supplier invoice is checked and posted the same day it arrives, and only the ones that need a decision ever reach a person.',
      blueprintSkeleton: null,
      codeNotes: 'Keep the matching tolerance (amount, quantity) configurable per client; what counts as close enough varies.',
      usedInEngagements: [],
    },
  ]
}
