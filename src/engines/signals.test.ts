import { describe, expect, it } from 'vitest'
import { DetectedToolSchema } from '../schema/company'
import { SEED_QUESTION_SET_IDS } from '../schema/seed-question-sets'
import { mulberry32, pick, randomInt, type Random } from './__fixtures__/engine-fixtures'
import { PAIN_RULES, TOOL_RULES, type ToolCategory } from './signal-rules'
import { evidenceFrom, extractSignals, mergeDetectedTools } from './signals'

const CATEGORIES: readonly ToolCategory[] = ['crm', 'email', 'ecommerce', 'support', 'scheduling', 'accounting', 'analytics', 'forms', 'chat']

// One example per rule, as a page or a client would actually write it. A mis-escaped pattern silently
// never matches, and only an example per rule catches that, so a rule with none fails the suite.
const TOOL_EXAMPLES: Readonly<Record<string, string>> = {
  HubSpot: '<script src="//js.hs-scripts.com/1234567.js"></script>',
  Salesforce: 'Our pipeline lives in Salesforce.',
  Pipedrive: 'https://app.pipedrive.com/deals',
  'Zoho CRM': 'We moved the deals into Zoho CRM last year.',
  Freshsales: 'Leads sit in Freshsales until someone calls them.',
  Keap: 'The old Infusionsoft account is still running.',
  'Microsoft Dynamics 365': 'Finance runs on Dynamics 365.',

  Mailchimp: '<script src="https://chimpstatic.com/mcjs-connected/js"></script>',
  Klaviyo: 'static.klaviyo.com/onsite/js/klaviyo.js',
  ActiveCampaign: 'The newsletter goes out through ActiveCampaign.',
  Brevo: 'We switched from Sendinblue to something else.',
  'Constant Contact': 'Constant Contact sends the monthly update.',
  'Campaign Monitor': 'Unsubscribe link points at createsend.com.',
  ConvertKit: 'The course list is in ConvertKit.',
  SendGrid: 'Transactional mail goes via sendgrid.net.',

  Shopify: 'cdn.shopify.com/s/files/1/0000/t/1/assets/theme.js',
  WooCommerce: 'wp-content/plugins/woocommerce/assets/js/frontend.js',
  Magento: '/static/version1234/frontend/Magento/luma/en_GB/js/theme.js',
  BigCommerce: 'cdn11.bigcommerce.com/s-abc123/stencil',
  PrestaShop: 'modules/prestashop_checkout/views/js/front.js',
  Stripe: '<script src="https://js.stripe.com/v3/"></script>',
  PayPal: 'www.paypalobjects.com/api/checkout.js',
  Square: 'Book and pay at squareup.com/appointments.',

  Zendesk: 'static.zdassets.com/ekr/snippet.js',
  Freshdesk: 'Tickets are raised in Freshdesk.',
  'Help Scout': 'beacon.helpscout.net/v2/beacon.js',
  Gorgias: 'config.gorgias.chat/loader.js',
  'Zoho Desk': 'desk.zoho.com/portal/home',
  Front: 'Shared inboxes are in frontapp.com.',
  'Jira Service Management': 'Requests go through Jira Service Management.',

  Calendly: 'assets.calendly.com/assets/external/widget.js',
  'Acuity Scheduling': 'embed.acuityscheduling.com/js/embed.js',
  'Cal.com': 'Book a slot at cal.com/agility.',
  'SimplyBook.me': 'company.simplybook.me/v2/',
  Setmore: 'Appointments are taken in Setmore.',
  'Microsoft Bookings': 'Staff use Microsoft Bookings for site visits.',

  Xero: 'The books are in Xero.',
  QuickBooks: 'Invoices are raised in QuickBooks.',
  Sage: 'Payroll still runs on Sage 50.',
  FreshBooks: 'Time is tracked in FreshBooks.',
  'Zoho Books': 'books.zoho.com/app/invoices',
  NetSuite: 'ERP is NetSuite.',
  Odoo: 'Stock is managed in Odoo.',
  Wave: 'Bookkeeping is done in waveapps.com.',

  'Google Analytics': 'https://www.google-analytics.com/analytics.js',
  'Google Tag Manager': 'GTM-ABC1234 is on every page.',
  Hotjar: 'static.hotjar.com/c/hotjar-123.js',
  'Meta Pixel': "fbq('init', '123456789');",
  Mixpanel: 'cdn.mixpanel.com/libs/mixpanel-2-latest.min.js',
  Segment: 'cdn.segment.com/analytics.js/v1/abc/analytics.min.js',
  Matomo: '/matomo.php?idsite=1',
  Plausible: 'plausible.io/js/script.js',

  Typeform: 'The intake form is a Typeform.',
  JotForm: 'form.jotform.com/2300000000',
  'Gravity Forms': 'wp-content/plugins/gravityforms/js/jquery.json.min.js',
  WPForms: 'wp-content/plugins/wpforms-lite/assets/js/',
  'Google Forms': 'docs.google.com/forms/d/e/1FAIpQLSf/viewform',
  Formspree: '<form action="https://formspree.io/f/abc123" method="POST">',

  Intercom: 'widget.intercom.io/widget/abc123',
  Drift: 'js.driftt.com/include/abc/def.js',
  'Tawk.to': 'embed.tawk.to/000000/default',
  LiveChat: 'cdn.livechatinc.com/tracking.js',
  Crisp: "window.$crisp=[];window.CRISP_WEBSITE_ID='abc';",
  Tidio: 'code.tidio.co is loaded from tidiochat.com',
}

const PAIN_EXAMPLES: Readonly<Record<string, string>> = {
  'pain-manual': 'Every order is entered manually by the dispatcher.',
  'pain-spreadsheet': 'The rota lives in a spreadsheet nobody owns.',
  'pain-copy-paste': 'They copy and paste each quote into the CRM.',
  'pain-data-entry': 'Two people do data entry every morning.',
  'pain-hiring-admin': 'We are hiring an admin to keep up with the inbox.',
}

function toolNames(text: string): string[] {
  return extractSignals(text).tools.map((tool) => tool.name)
}

describe('TOOL_RULES', () => {
  it('covers roughly sixty rules across every category ENGINES names', () => {
    expect(TOOL_RULES.length).toBeGreaterThanOrEqual(60)
    expect([...new Set(TOOL_RULES.map((rule) => rule.category))].sort()).toEqual([...CATEGORIES].sort())
  })

  it('names each tool once and gives each rule at least one pattern', () => {
    const names = TOOL_RULES.map((rule) => rule.name)
    expect(names).toEqual([...new Set(names)])
    for (const rule of TOOL_RULES) expect(rule.patterns.length, rule.name).toBeGreaterThan(0)
  })

  it('carries no g or y flag on any pattern, which would make a second call over the same text differ', () => {
    const labelled = [
      ...TOOL_RULES.map((rule) => ({ label: rule.name, patterns: rule.patterns })),
      ...PAIN_RULES.map((rule) => ({ label: rule.id, patterns: rule.patterns })),
    ]
    for (const { label, patterns } of labelled) {
      for (const pattern of patterns) expect(pattern.flags, `${label}: ${pattern.source}`).toMatch(/^i?$/)
    }
  })

  it('has an example for every rule, and finds exactly that tool in it', () => {
    expect(Object.keys(TOOL_EXAMPLES).sort()).toEqual(TOOL_RULES.map((rule) => rule.name).sort())
    for (const rule of TOOL_RULES) {
      const example = TOOL_EXAMPLES[rule.name] ?? ''
      // Exactly that one: a pattern wide enough to catch a neighbour's example is a pattern that will
      // catch an unrelated page.
      expect(toolNames(example), rule.name).toEqual([rule.name])
    }
  })

  it('reads a tool out of an example with its category, confidence and the text that proved it', () => {
    const [tool] = extractSignals(TOOL_EXAMPLES.HubSpot ?? '').tools
    expect(tool).toEqual({ name: 'HubSpot', category: 'crm', evidence: 'js.hs-scripts.com', confidence: 'high', confirmed: false })
  })

  it('leaves an ordinary word alone where the product name is one', () => {
    // Every one of these is a tool name and an English word; only the host may count.
    expect(toolNames('A square wave drifts past the front of a sage segment of plausible prose.')).toEqual([])
  })
})

describe('PAIN_RULES', () => {
  it('holds the five signals ENGINES names, each pointing at seeded question sets and candidate patterns', () => {
    expect(PAIN_RULES).toHaveLength(5)
    for (const rule of PAIN_RULES) {
      expect(rule.questionSetIds.length, rule.id).toBeGreaterThan(0)
      expect(rule.patternIds.length, rule.id).toBeGreaterThan(0)
      // A hint that named a set the app does not seed could never be acted on.
      for (const id of rule.questionSetIds) expect(SEED_QUESTION_SET_IDS, rule.id).toContain(id)
      for (const id of rule.patternIds) expect(id, rule.id).toMatch(/^pat-[a-z-]+$/)
    }
  })

  it('has an example for every rule, and finds that pain in it', () => {
    expect(Object.keys(PAIN_EXAMPLES).sort()).toEqual(PAIN_RULES.map((rule) => rule.id).sort())
    for (const rule of PAIN_RULES) {
      const example = PAIN_EXAMPLES[rule.id] ?? ''
      expect(extractSignals(example).pains.map((pain) => pain.id), rule.id).toContain(rule.id)
    }
  })

  it('reads the same phrase written either way, since a pasted page carries the curly apostrophe', () => {
    for (const text of ["We're hiring an admin.", 'We’re hiring an admin.']) {
      expect(extractSignals(text).pains.map((pain) => pain.id), text).toContain('pain-hiring-admin')
    }
    for (const text of ['They copy-paste it.', 'They copy‑paste it.', 'They copy/paste it.']) {
      expect(extractSignals(text).pains.map((pain) => pain.id), text).toContain('pain-copy-paste')
    }
  })

  it('carries what to do next: the sets worth running and the patterns to consider', () => {
    const [pain] = extractSignals(PAIN_EXAMPLES['pain-data-entry'] ?? '').pains
    expect(pain).toMatchObject({ id: 'pain-data-entry', evidence: 'data entry', patternIds: ['pat-document-extraction', 'pat-invoice-processing'] })
  })
})

describe('extractSignals', () => {
  it('finds nothing in empty text, and nothing in text that names no tool', () => {
    for (const text of ['', '   ', 'We deliver pallets across the country and answer the phone.']) {
      expect(extractSignals(text), text).toEqual({ tools: [], pains: [] })
    }
  })

  it('reads every tool in one page, in table order, so the same text always gives the same list', () => {
    const page = [TOOL_EXAMPLES.Shopify, TOOL_EXAMPLES.HubSpot, TOOL_EXAMPLES.Xero].join('\n')
    expect(toolNames(page)).toEqual(['HubSpot', 'Shopify', 'Xero'])
    expect(extractSignals(page)).toEqual(extractSignals(page))
  })

  it('suggests and never concludes: every tool comes back unconfirmed', () => {
    const page = Object.values(TOOL_EXAMPLES).join('\n')
    const { tools } = extractSignals(page)
    expect(tools.length).toBe(TOOL_RULES.length)
    for (const tool of tools) expect(tool.confirmed, tool.name).toBe(false)
  })

  it('gives every tool as the schema stores one', () => {
    const page = Object.values(TOOL_EXAMPLES).join('\n')
    for (const tool of extractSignals(page).tools) {
      expect(DetectedToolSchema.safeParse(tool).success, tool.name).toBe(true)
    }
  })

  it('shows evidence that is text actually in the page, within the length the schema stores', () => {
    const page = Object.values(TOOL_EXAMPLES).join('\n')
    for (const tool of extractSignals(page).tools) {
      expect(tool.evidence.length, tool.name).toBeLessThanOrEqual(80)
      expect(page, tool.name).toContain(tool.evidence)
    }
  })
})

describe('evidenceFrom', () => {
  it('keeps a short match as it is and cuts a long one to what the schema stores', () => {
    expect(evidenceFrom('js.stripe.com')).toBe('js.stripe.com')
    expect(evidenceFrom('x'.repeat(80))).toHaveLength(80)
    expect(evidenceFrom('x'.repeat(200))).toHaveLength(80)
  })

  it('cuts between characters, never through one, so no half character is stored', () => {
    // The 80th unit would be the first half of a pair, so the cut backs off to 79.
    const match = `${'x'.repeat(79)}😀tail`
    const evidence = evidenceFrom(match)
    expect(evidence).toHaveLength(79)
    expect([...evidence]).toHaveLength(79)
    // A pair that ends exactly on the limit is kept whole.
    const fits = `${'x'.repeat(78)}😀tail`
    expect([...evidenceFrom(fits)].at(-1)).toBe('😀')
  })
})

describe('mergeDetectedTools', () => {
  const found = () => extractSignals(TOOL_EXAMPLES.HubSpot ?? '').tools

  it('adds what the stack does not hold', () => {
    expect(mergeDetectedTools([], found()).map((tool) => tool.name)).toEqual(['HubSpot'])
  })

  it('never touches an entry already there, so a confirmed tool stays confirmed and keeps its evidence', () => {
    const confirmed = { ...(found()[0] ?? { name: 'HubSpot', category: 'crm', evidence: 'x', confidence: 'high' as const }), evidence: 'said on the call', confirmed: true }
    const merged = mergeDetectedTools([confirmed], found())
    expect(merged).toEqual([confirmed])
  })

  it('returns the same array when nothing is new, so a re-run leaves the record untouched', () => {
    const existing = found()
    expect(mergeDetectedTools(existing, found())).toBe(existing)
    expect(mergeDetectedTools(existing, [])).toBe(existing)
  })

  it('is idempotent, and never produces the repeat the schema refuses', () => {
    const page = Object.values(TOOL_EXAMPLES).join('\n')
    const { tools } = extractSignals(page)
    const once = mergeDetectedTools([], tools)
    const twice = mergeDetectedTools(once, extractSignals(page).tools)
    expect(twice).toBe(once)
    expect(once.map((tool) => tool.name)).toEqual([...new Set(once.map((tool) => tool.name))])
  })
})

describe('properties', () => {
  const CASES = 200

  function randomProse(random: Random): string {
    const words = ['pallet', 'invoice', 'driver', 'depot', 'route', 'customer', 'quote', 'shift', 'label', 'pickup']
    return Array.from({ length: randomInt(random, 5, 40) }, () => pick(random, words)).join(' ')
  }

  it('is deterministic: the same text read twice gives the same result', () => {
    const random = mulberry32(11)
    for (let round = 0; round < CASES; round++) {
      const text = `${randomProse(random)} ${pick(random, Object.values(TOOL_EXAMPLES))} ${randomProse(random)}`
      expect(extractSignals(text)).toEqual(extractSignals(text))
    }
  })

  it('never loses a detection when more text is added around it', () => {
    const random = mulberry32(12)
    for (let round = 0; round < CASES; round++) {
      const seed = pick(random, Object.values(TOOL_EXAMPLES))
      const before = toolNames(seed)
      const after = toolNames(`${randomProse(random)}\n${seed}\n${randomProse(random)}`)
      for (const name of before) expect(after, seed).toContain(name)
    }
  })

  it('reads a large page without pathological backtracking', () => {
    // A timeout rather than a measured duration: lint bans the clock in every file under engines/.
    const adversarial = `${'a'.repeat(100_000)} ${'https://'.repeat(10_000)} ${'copy and '.repeat(5_000)}`
    expect(adversarial.length).toBeGreaterThan(200_000)
    expect(() => extractSignals(adversarial)).not.toThrow()
  }, 2000)
})
