import { defaultConfig } from './config'
import type { Question, QuestionSet } from './discovery'

// The two question sets a new store starts with. They are ordinary Library records: Alex edits them in
// the question-set editor like any other. Ids are readable and stable, so an existing store can be
// offered whichever of them it is missing.

export const TEARDOWN_SET_ID = 'qs-teardown'
export const DISCOVERY_SET_ID = 'qs-full-discovery'
export const SEED_QUESTION_SET_IDS: readonly string[] = [TEARDOWN_SET_ID, DISCOVERY_SET_ID]

const TOOLS = [
  'Google Sheets',
  'Excel',
  'Airtable',
  'Notion',
  'HubSpot',
  'Salesforce',
  'Pipedrive',
  'Gmail',
  'Outlook',
  'Slack',
  'Microsoft Teams',
  'Shopify',
  'WooCommerce',
  'Xero',
  'QuickBooks',
  'Zapier',
]

function teardown(): QuestionSet {
  const questions: Question[] = [
    { id: 'td-business', text: 'In one sentence, what does the business do, and for whom?', kind: 'text', required: true },
    { id: 'td-industry', text: 'Which industry is it in?', kind: 'choice', choices: defaultConfig().industries, required: true, mapsTo: 'company.industry' },
    {
      id: 'td-team-size',
      text: 'How many people work in the business?',
      helpText: 'Everyone on the payroll, part-time included.',
      kind: 'number',
      required: true,
      mapsTo: 'company.employeeCount',
    },
    { id: 'td-biggest-pain', text: 'Which task eats the most of the team’s time every week?', kind: 'text', required: true },
    { id: 'td-hours-lost', text: 'Roughly how many hours a week does that task take, across the whole team?', kind: 'number', unit: 'hours/week', required: true },
    {
      id: 'td-hourly-cost',
      text: 'What does an hour of the team’s time cost the business, all in?',
      helpText: 'Blended cost, not salary: wages, employer taxes and overhead together.',
      kind: 'number',
      required: true,
      mapsTo: 'company.blendedHourlyCost',
    },
    { id: 'td-tools', text: 'Which tools does the team use day to day?', kind: 'multi', choices: TOOLS, required: false, mapsTo: 'company.statedTools' },
    { id: 'td-source-of-truth', text: 'Where does the data everyone trusts actually live?', kind: 'text', required: false, mapsTo: 'company.sourceOfTruth' },
    { id: 'td-tried-before', text: 'Have you tried to fix this before, with software or a hire?', kind: 'boolean', required: true },
    { id: 'td-tried-what', text: 'What did you try, and why did it not stick?', kind: 'text', required: true, showIf: { answerId: 'td-tried-before', equals: true } },
    {
      id: 'td-off-the-shelf',
      text: 'Have you looked at an off-the-shelf tool for this?',
      helpText: 'Buying an existing tool is a real outcome of a teardown, not a failure of one.',
      kind: 'boolean',
      required: true,
    },
    { id: 'td-off-the-shelf-which', text: 'Which one, and what stopped you?', kind: 'text', required: false, showIf: { answerId: 'td-off-the-shelf', equals: true } },
    { id: 'td-urgency', text: 'How soon does this need to change?', kind: 'choice', choices: ['this month', 'this quarter', 'this year', 'just exploring'], required: true },
  ]
  return { id: TEARDOWN_SET_ID, name: 'Teardown', kind: 'teardown', appliesTo: {}, questions }
}

function fullDiscovery(): QuestionSet {
  const questions: Question[] = [
    // The business
    { id: 'fd-business', text: 'What does the business do, and who are its customers?', kind: 'text', required: true },
    { id: 'fd-industry', text: 'Which industry is it in?', kind: 'choice', choices: defaultConfig().industries, required: true, mapsTo: 'company.industry' },
    { id: 'fd-team-size', text: 'How many people work in the business?', helpText: 'Everyone on the payroll, part-time included.', kind: 'number', required: true, mapsTo: 'company.employeeCount' },
    {
      id: 'fd-hourly-cost',
      text: 'What does an average hour of the team’s time cost, all in?',
      helpText: 'Blended cost, not salary: wages, employer taxes and overhead together.',
      kind: 'number',
      required: true,
      mapsTo: 'company.blendedHourlyCost',
    },
    { id: 'fd-tools', text: 'Which tools does the team use day to day?', kind: 'multi', choices: TOOLS, required: true, mapsTo: 'company.statedTools' },
    { id: 'fd-source-of-truth', text: 'Where does the data everyone trusts actually live?', kind: 'text', required: true, mapsTo: 'company.sourceOfTruth' },
    { id: 'fd-regulated', text: 'Is any of the data regulated or sensitive?', helpText: 'Personal data, payments, health records, financial records.', kind: 'boolean', required: true },
    {
      id: 'fd-compliance',
      text: 'Which rules apply to it?',
      kind: 'multi',
      choices: ['GDPR', 'PCI DSS', 'HIPAA', 'ISO 27001', 'SOC 2'],
      required: true,
      mapsTo: 'company.constraints.compliance',
      showIf: { answerId: 'fd-regulated', equals: true },
    },
    { id: 'fd-data-location', text: 'Does the data have to stay in a particular country or region?', kind: 'text', required: false, showIf: { answerId: 'fd-regulated', equals: true } },
    { id: 'fd-tech-team', text: 'Does anyone in-house look after software or IT?', kind: 'boolean', required: true },
    { id: 'fd-tech-team-size', text: 'How many people?', kind: 'number', unit: 'people', required: false, showIf: { answerId: 'fd-tech-team', equals: true } },
    {
      id: 'fd-delivery-model',
      text: 'Once it is built, who should run it?',
      helpText: 'Fully managed: we run it. Client-owned: your team runs it. Hybrid: you own it and we support it.',
      kind: 'choice',
      choices: ['fully-managed', 'client-owned', 'hybrid'],
      required: true,
      mapsTo: 'company.preferredDeliveryModel',
    },

    // The process
    { id: 'fd-process-name', text: 'Which process should we look at first?', kind: 'text', required: true },
    { id: 'fd-process-steps', text: 'Walk through it step by step: who does what, in which tool?', kind: 'text', required: true },
    { id: 'fd-occurrences', text: 'How many times a month does it run?', kind: 'number', required: true, mapsTo: 'process.frequency.occurrencesPerMonth' },
    { id: 'fd-minutes', text: 'How long does one run take, start to finish?', kind: 'duration', required: true, mapsTo: 'process.frequency.minutesPerOccurrence' },
    { id: 'fd-people', text: 'How many people touch each run?', kind: 'number', required: true, mapsTo: 'process.frequency.peopleInvolved' },
    { id: 'fd-role-cost-differs', text: 'Do the people doing it cost noticeably more or less than the average hour?', kind: 'boolean', required: true },
    {
      id: 'fd-role-cost',
      text: 'What does an hour of their time cost, all in?',
      kind: 'number',
      required: true,
      mapsTo: 'process.roleHourlyCost',
      showIf: { answerId: 'fd-role-cost-differs', equals: true },
    },
    { id: 'fd-errors', text: 'Does it go wrong in ways that cost money or customers?', kind: 'boolean', required: true },
    {
      id: 'fd-error-rate',
      text: 'Out of every 100 runs, how many go wrong?',
      kind: 'number',
      required: true,
      mapsTo: 'process.errorProfile.errorRatePercent',
      showIf: { answerId: 'fd-errors', equals: true },
    },
    {
      id: 'fd-error-cost',
      text: 'What does one mistake cost to put right?',
      kind: 'number',
      required: true,
      mapsTo: 'process.errorProfile.costPerError',
      showIf: { answerId: 'fd-errors', equals: true },
    },
    { id: 'fd-error-example', text: 'Describe the last time it went wrong.', kind: 'text', required: false, showIf: { answerId: 'fd-errors', equals: true } },
    {
      id: 'fd-revenue-impact',
      text: 'How close is it to revenue?',
      helpText: 'Direct: it wins or loses sales. Indirect: it slows the people who do. None: back office only.',
      kind: 'choice',
      choices: ['direct', 'indirect', 'none'],
      required: true,
      mapsTo: 'process.revenueImpact',
    },
    { id: 'fd-volume-trend', text: 'Is the volume changing?', kind: 'choice', choices: ['shrinking', 'flat', 'growing', 'growing fast'], required: true },
    { id: 'fd-volume-breaks', text: 'What breaks first if the volume doubles?', kind: 'text', required: false, showIf: { answerId: 'fd-volume-trend', equals: 'growing fast' } },

    // The systems
    { id: 'fd-api', text: 'Do the tools in this process connect to other software?', kind: 'choice', choices: ['yes, all of them', 'some of them', 'none of them', 'not sure'], required: true },
    {
      id: 'fd-api-gaps',
      text: 'Which tools have no way to connect?',
      kind: 'text',
      required: true,
      showIf: {
        any: [
          { answerId: 'fd-api', equals: 'some of them' },
          { answerId: 'fd-api', equals: 'none of them' },
        ],
      },
    },
    {
      id: 'fd-data-shape',
      text: 'What does the information arrive as?',
      kind: 'choice',
      choices: ['forms or tables', 'emails or PDFs with a fixed layout', 'free text or scans'],
      required: true,
    },
    { id: 'fd-approvals', text: 'How many sign-offs does one run need?', kind: 'number', unit: 'sign-offs', required: false },
    { id: 'fd-judgement', text: 'Does someone need to make a judgement call before it can continue?', kind: 'boolean', required: true },
    {
      id: 'fd-judgement-what',
      text: 'What are they deciding, and what do they look at?',
      kind: 'text',
      required: true,
      showIf: { all: [{ answerId: 'fd-judgement', equals: true }, { answerId: 'fd-data-shape', equals: 'free text or scans' }] },
    },

    // The outcome
    { id: 'fd-success', text: 'If this worked perfectly six months from now, what would be different?', kind: 'text', required: true },
    { id: 'fd-decision-maker', text: 'Who signs off on a project like this?', kind: 'text', required: true },
    { id: 'fd-budget', text: 'Is there a budget range in mind?', kind: 'choice', choices: ['under €2,000', '€2,000 to €5,000', '€5,000 to €15,000', 'over €15,000', 'not set'], required: false },
    { id: 'fd-timeline', text: 'When does this need to be live?', kind: 'choice', choices: ['this month', 'this quarter', 'this year', 'no deadline'], required: true },
    { id: 'fd-deadline-driver', text: 'What is driving that date?', kind: 'text', required: false, showIf: { answerId: 'fd-timeline', equals: 'this month' } },
  ]
  return { id: DISCOVERY_SET_ID, name: 'Full discovery', kind: 'discovery', appliesTo: {}, questions }
}

// Fresh objects on every call, so editing one copy never leaks into the seed.
export function seedQuestionSets(): QuestionSet[] {
  return [teardown(), fullDiscovery()]
}
