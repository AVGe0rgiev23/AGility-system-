import { TEARDOWN_SET_ID, DISCOVERY_SET_ID } from '../schema/seed-question-sets'

// The tables signal extraction matches against (ENGINES §6). Constants in code rather than Library
// data, because a RegExp cannot survive the JSON export every record is required to round-trip
// through, and because these encode the matching itself rather than anything Alex tunes per client.
//
// Every pattern is a distinctive string: a script host, a domain, a measurement id, or a product name
// that is not an ordinary English word. Where the name alone is common ('Front', 'Square', 'Wave',
// 'Drift', 'Crisp', 'Sage', 'Segment'), only its host is matched, so prose about a wave or a drift
// does not become a detected tool.
//
// No pattern carries the `g` or `y` flag: those keep `lastIndex` between calls, so the same text would
// match differently the second time it was pasted. No pattern nests a quantifier inside another, so
// matching stays linear in the length of the text.

export type ToolCategory = 'crm' | 'email' | 'ecommerce' | 'support' | 'scheduling' | 'accounting' | 'analytics' | 'forms' | 'chat'

export interface ToolRule {
  name: string
  category: ToolCategory
  patterns: readonly RegExp[]
  // How much the strongest pattern in this rule proves. Evidence is shown beside it either way, and
  // nothing counts until Alex confirms it.
  confidence: 'high' | 'medium' | 'low'
}

export const TOOL_RULES: readonly ToolRule[] = [
  // ---- crm ----------------------------------------------------------------------------------------
  { name: 'HubSpot', category: 'crm', patterns: [/js\.hs-scripts\.com/i, /hs-analytics\.net/i, /\bhbspt\b/i, /\bHubSpot\b/i], confidence: 'high' },
  { name: 'Salesforce', category: 'crm', patterns: [/salesforce\.com/i, /\bforce\.com/i, /\bSalesforce\b/i], confidence: 'high' },
  { name: 'Pipedrive', category: 'crm', patterns: [/pipedrive\.com/i, /\bPipedrive\b/i], confidence: 'high' },
  { name: 'Zoho CRM', category: 'crm', patterns: [/crm\.zoho\.com/i, /\bZoho CRM\b/i], confidence: 'high' },
  { name: 'Freshsales', category: 'crm', patterns: [/freshsales\.io/i, /\bFreshsales\b/i], confidence: 'high' },
  { name: 'Keap', category: 'crm', patterns: [/keap\.com/i, /infusionsoft\.com/i, /\bKeap\b/i, /\bInfusionsoft\b/i], confidence: 'high' },
  { name: 'Microsoft Dynamics 365', category: 'crm', patterns: [/dynamics\.com/i, /\bDynamics 365\b/i], confidence: 'high' },

  // ---- email --------------------------------------------------------------------------------------
  { name: 'Mailchimp', category: 'email', patterns: [/mailchimp\.com/i, /list-manage\.com/i, /chimpstatic\.com/i, /\bMailchimp\b/i], confidence: 'high' },
  { name: 'Klaviyo', category: 'email', patterns: [/klaviyo\.com/i, /\bKlaviyo\b/i], confidence: 'high' },
  { name: 'ActiveCampaign', category: 'email', patterns: [/activecampaign\.com/i, /\bActiveCampaign\b/i], confidence: 'high' },
  { name: 'Brevo', category: 'email', patterns: [/brevo\.com/i, /sendinblue\.com/i, /\bBrevo\b/i, /\bSendinblue\b/i], confidence: 'high' },
  { name: 'Constant Contact', category: 'email', patterns: [/constantcontact\.com/i, /\bConstant Contact\b/i], confidence: 'high' },
  { name: 'Campaign Monitor', category: 'email', patterns: [/createsend\.com/i, /campaignmonitor\.com/i, /\bCampaign Monitor\b/i], confidence: 'high' },
  { name: 'ConvertKit', category: 'email', patterns: [/convertkit\.com/i, /\bConvertKit\b/i], confidence: 'high' },
  { name: 'SendGrid', category: 'email', patterns: [/sendgrid\.(com|net)/i, /\bSendGrid\b/i], confidence: 'high' },

  // ---- ecommerce ----------------------------------------------------------------------------------
  { name: 'Shopify', category: 'ecommerce', patterns: [/cdn\.shopify\.com/i, /myshopify\.com/i, /shopify\.com/i, /\bShopify\b/i], confidence: 'high' },
  { name: 'WooCommerce', category: 'ecommerce', patterns: [/woocommerce/i, /\bwc-ajax\b/i], confidence: 'high' },
  { name: 'Magento', category: 'ecommerce', patterns: [/magento/i], confidence: 'high' },
  { name: 'BigCommerce', category: 'ecommerce', patterns: [/bigcommerce\.com/i, /\bBigCommerce\b/i], confidence: 'high' },
  { name: 'PrestaShop', category: 'ecommerce', patterns: [/prestashop/i], confidence: 'high' },
  { name: 'Stripe', category: 'ecommerce', patterns: [/js\.stripe\.com/i, /stripe\.com/i, /\bStripe\b/i], confidence: 'high' },
  { name: 'PayPal', category: 'ecommerce', patterns: [/paypalobjects\.com/i, /paypal\.com/i, /\bPayPal\b/i], confidence: 'high' },
  // 'Square' alone is an ordinary word, so only its hosts count.
  { name: 'Square', category: 'ecommerce', patterns: [/squareup\.com/i, /square\.site/i, /squarecdn\.com/i], confidence: 'high' },

  // ---- support ------------------------------------------------------------------------------------
  { name: 'Zendesk', category: 'support', patterns: [/zendesk\.com/i, /zdassets\.com/i, /\bZendesk\b/i], confidence: 'high' },
  { name: 'Freshdesk', category: 'support', patterns: [/freshdesk\.com/i, /\bFreshdesk\b/i], confidence: 'high' },
  { name: 'Help Scout', category: 'support', patterns: [/helpscout\.(com|net)/i, /\bHelp Scout\b/i], confidence: 'high' },
  { name: 'Gorgias', category: 'support', patterns: [/gorgias\.(com|chat)/i, /\bGorgias\b/i], confidence: 'high' },
  { name: 'Zoho Desk', category: 'support', patterns: [/desk\.zoho\.com/i, /\bZoho Desk\b/i], confidence: 'high' },
  // 'Front' alone is an ordinary word.
  { name: 'Front', category: 'support', patterns: [/frontapp\.com/i, /\bFront App\b/i], confidence: 'high' },
  { name: 'Jira Service Management', category: 'support', patterns: [/atlassian\.net\/servicedesk/i, /\bJira Service (Management|Desk)\b/i], confidence: 'high' },

  // ---- scheduling ---------------------------------------------------------------------------------
  { name: 'Calendly', category: 'scheduling', patterns: [/calendly\.com/i, /\bCalendly\b/i], confidence: 'high' },
  { name: 'Acuity Scheduling', category: 'scheduling', patterns: [/acuityscheduling\.com/i, /\bAcuity Scheduling\b/i], confidence: 'high' },
  { name: 'Cal.com', category: 'scheduling', patterns: [/\bcal\.com\b/i], confidence: 'high' },
  { name: 'SimplyBook.me', category: 'scheduling', patterns: [/simplybook\.(me|it)/i], confidence: 'high' },
  { name: 'Setmore', category: 'scheduling', patterns: [/setmore\.com/i, /\bSetmore\b/i], confidence: 'high' },
  { name: 'Microsoft Bookings', category: 'scheduling', patterns: [/outlook\.office365\.com\/owa\/calendar/i, /\bMicrosoft Bookings\b/i], confidence: 'high' },

  // ---- accounting ---------------------------------------------------------------------------------
  { name: 'Xero', category: 'accounting', patterns: [/xero\.com/i, /\bXero\b/i], confidence: 'high' },
  { name: 'QuickBooks', category: 'accounting', patterns: [/quickbooks\.intuit\.com/i, /quickbooks\.com/i, /\bQuickBooks\b/i, /\bQBO\b/], confidence: 'high' },
  // 'Sage' alone is an ordinary word, so the product line is named.
  { name: 'Sage', category: 'accounting', patterns: [/sage\.com/i, /\bSage (50|200|Accounting|Business Cloud|Intacct)\b/i], confidence: 'high' },
  { name: 'FreshBooks', category: 'accounting', patterns: [/freshbooks\.com/i, /\bFreshBooks\b/i], confidence: 'high' },
  { name: 'Zoho Books', category: 'accounting', patterns: [/books\.zoho\.com/i, /\bZoho Books\b/i], confidence: 'high' },
  { name: 'NetSuite', category: 'accounting', patterns: [/netsuite\.com/i, /\bNetSuite\b/i], confidence: 'high' },
  { name: 'Odoo', category: 'accounting', patterns: [/odoo\.com/i, /\bOdoo\b/i], confidence: 'high' },
  // 'Wave' alone is an ordinary word.
  { name: 'Wave', category: 'accounting', patterns: [/waveapps\.com/i, /\bWave Accounting\b/i], confidence: 'high' },

  // ---- analytics ----------------------------------------------------------------------------------
  { name: 'Google Analytics', category: 'analytics', patterns: [/google-analytics\.com/i, /gtag\/js/i, /\bUA-\d{4,}-\d+\b/, /\bG-[A-Z0-9]{8,}\b/], confidence: 'high' },
  { name: 'Google Tag Manager', category: 'analytics', patterns: [/googletagmanager\.com/i, /\bGTM-[A-Z0-9]{4,}\b/], confidence: 'high' },
  { name: 'Hotjar', category: 'analytics', patterns: [/hotjar\.(com|io)/i, /\bhjSiteSettings\b/, /\bHotjar\b/i], confidence: 'high' },
  { name: 'Meta Pixel', category: 'analytics', patterns: [/connect\.facebook\.net/i, /fbevents\.js/i, /\bfbq\(/, /\bMeta Pixel\b/i, /\bFacebook Pixel\b/i], confidence: 'high' },
  { name: 'Mixpanel', category: 'analytics', patterns: [/mixpanel\.com/i, /\bMixpanel\b/i], confidence: 'high' },
  // 'Segment' alone is an ordinary word.
  { name: 'Segment', category: 'analytics', patterns: [/cdn\.segment\.com/i, /segment\.io/i, /analytics\.segment\.com/i], confidence: 'high' },
  { name: 'Matomo', category: 'analytics', patterns: [/matomo\.(php|js|cloud)/i, /piwik\.(php|js)/i, /\bMatomo\b/i], confidence: 'high' },
  // 'Plausible' alone is an ordinary word.
  { name: 'Plausible', category: 'analytics', patterns: [/plausible\.io/i], confidence: 'high' },

  // ---- forms --------------------------------------------------------------------------------------
  { name: 'Typeform', category: 'forms', patterns: [/typeform\.com/i, /\bTypeform\b/i], confidence: 'high' },
  { name: 'JotForm', category: 'forms', patterns: [/jotform\.com/i, /\bJotForm\b/i], confidence: 'high' },
  { name: 'Gravity Forms', category: 'forms', patterns: [/gravityforms/i, /\bgform_wrapper\b/i, /\bGravity Forms\b/i], confidence: 'high' },
  { name: 'WPForms', category: 'forms', patterns: [/wpforms/i], confidence: 'high' },
  { name: 'Google Forms', category: 'forms', patterns: [/docs\.google\.com\/forms/i, /\bGoogle Forms?\b/i], confidence: 'high' },
  { name: 'Formspree', category: 'forms', patterns: [/formspree\.io/i, /\bFormspree\b/i], confidence: 'high' },

  // ---- chat ---------------------------------------------------------------------------------------
  { name: 'Intercom', category: 'chat', patterns: [/intercomcdn\.com/i, /intercom\.(io|com)/i, /\bIntercom\b/i], confidence: 'high' },
  // 'Drift' alone is an ordinary word.
  { name: 'Drift', category: 'chat', patterns: [/js\.driftt\.com/i, /\bdriftt\.com/i, /\bdrift\.com/i], confidence: 'high' },
  { name: 'Tawk.to', category: 'chat', patterns: [/tawk\.to/i], confidence: 'high' },
  { name: 'LiveChat', category: 'chat', patterns: [/livechatinc\.com/i, /\bLiveChat\b/i], confidence: 'high' },
  // 'Crisp' alone is an ordinary word.
  { name: 'Crisp', category: 'chat', patterns: [/crisp\.chat/i, /\$crisp\b/], confidence: 'high' },
  { name: 'Tidio', category: 'chat', patterns: [/tidio(chat)?\.com/i, /\bTidio\b/i], confidence: 'high' },
]

// The eight patterns BUILD-PLAN seeds the Library with in Stage 2, task 9, named here by the convention
// those seeds use. A hint whose id the Library does not hold yet is shown as not seeded, never dropped.
export const PAT_LEAD_ENRICHMENT = 'pat-lead-enrichment'
export const PAT_EMAIL_TRIAGE = 'pat-email-triage'
export const PAT_DOCUMENT_EXTRACTION = 'pat-document-extraction'
export const PAT_CRM_SYNC = 'pat-crm-sync'
export const PAT_WEBHOOK_PROCESSING = 'pat-webhook-processing'
export const PAT_APPROVAL_WORKFLOW = 'pat-approval-workflow'
export const PAT_REPORTING_AUTOMATION = 'pat-reporting-automation'
export const PAT_INVOICE_PROCESSING = 'pat-invoice-processing'

export interface PainRule {
  id: string
  // What the match says, in the words the panel shows.
  label: string
  patterns: readonly RegExp[]
  // The question sets worth running when this shows up.
  questionSetIds: readonly string[]
  // Candidate patterns, never a conclusion.
  patternIds: readonly string[]
}

// The five pain signals ENGINES §6 names, each with the spellings the same phrase is written in.
export const PAIN_RULES: readonly PainRule[] = [
  {
    id: 'pain-manual',
    label: 'Work described as done by hand',
    patterns: [/\bmanually\b/i, /\bmanual process\b/i, /\bby hand\b/i],
    questionSetIds: [DISCOVERY_SET_ID],
    patternIds: [PAT_APPROVAL_WORKFLOW, PAT_CRM_SYNC],
  },
  {
    id: 'pain-spreadsheet',
    label: 'A spreadsheet doing a system’s job',
    patterns: [/\bspreadsheets?\b/i, /\bgoogle sheets?\b/i, /\bexcel\b/i],
    questionSetIds: [DISCOVERY_SET_ID],
    patternIds: [PAT_REPORTING_AUTOMATION, PAT_DOCUMENT_EXTRACTION],
  },
  {
    id: 'pain-copy-paste',
    label: 'Copying between systems',
    patterns: [/\bcopy and paste\b/i, /\bcopy[-‑]paste\b/i, /\bcopy\/paste\b/i, /\bcopying and pasting\b/i, /\bre-?key(ed|ing)?\b/i],
    questionSetIds: [DISCOVERY_SET_ID],
    patternIds: [PAT_CRM_SYNC, PAT_DOCUMENT_EXTRACTION],
  },
  {
    id: 'pain-data-entry',
    label: 'Data entry as a job of its own',
    patterns: [/\bdata[- ]entry\b/i, /\bre-?typ(e|es|ed|ing)\b/i, /\bkeying in\b/i],
    questionSetIds: [DISCOVERY_SET_ID],
    patternIds: [PAT_DOCUMENT_EXTRACTION, PAT_INVOICE_PROCESSING],
  },
  {
    id: 'pain-hiring-admin',
    // Written with either apostrophe, since a pasted page usually carries the curly one.
    label: 'Hiring to absorb the volume',
    patterns: [/\bwe(’|')re hiring\b/i, /\bhiring an? (admin|administrator|assistant|co-?ordinator)\b/i, /\blooking to hire an? (admin|assistant)\b/i],
    questionSetIds: [TEARDOWN_SET_ID, DISCOVERY_SET_ID],
    patternIds: [PAT_EMAIL_TRIAGE, PAT_LEAD_ENRICHMENT],
  },
]
