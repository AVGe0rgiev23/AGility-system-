import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CONFIG_RULE_BREAKS } from '../../../hooks/__fixtures__/config-rule-breaks'
import { leafPaths } from '../../../hooks/form-paths'
import {
  configFormView,
  formIssues,
  initialConfigForm,
  locatedPaths,
  READ_ONLY_PATHS,
  setNumberText,
  setUsageBased,
  type ConfigFormState,
} from '../../../hooks/use-config-form'
import { dotReadingWarning, NOT_A_NUMBER, VALUE_REQUIRED } from '../../../hooks/use-traced-draft'
import { runCostLineItem, usageRunCostLineItem } from '../../../schema/__fixtures__/records'
import { defaultConfig, type Config } from '../../../schema/config'
import { describedBy, escapeHtml, renderedPaths, tagFor } from '../../__fixtures__/markup'
import { ConfigSections } from './config-sections'

function render(state: ConfigFormState): string {
  const form = configFormView(state, () => undefined)
  if (form.draft === null) throw new Error('expected a draft')
  return renderToStaticMarkup(<ConfigSections form={form} draft={form.draft} />)
}

// A Config with every optional field set, a usage-based item with a formula and a plain item.
function everyField(): Config {
  const config = defaultConfig()
  config.agency.vatId = 'BG123456789'
  config.runCostDefaults = [{ ...usageRunCostLineItem(), notes: 'Haiku, batched' }, { ...runCostLineItem(), notes: 'One machine' }]
  return config
}

describe('ConfigSections, every field', () => {
  it('gives every leaf an editable control, or a read-only row with its reason', () => {
    const draft = everyField()
    const html = render(initialConfigForm(draft))
    for (const path of leafPaths(draft)) {
      const tag = tagFor(html, path)
      const reason = READ_ONLY_PATHS[path]
      if (reason === undefined) {
        expect(tag, path).toMatch(/^<(input|select) /)
      } else {
        expect(tag, path).toMatch(/^<output /)
        expect(describedBy(html, path), path).toContain(escapeHtml(reason))
      }
    }
    for (const path of Object.keys(READ_ONLY_PATHS)) expect(leafPaths(draft), path).toContain(path)
  })

  it('renders exactly the paths issues are placed at, each once', () => {
    const draft = everyField()
    const paths = renderedPaths(render(initialConfigForm(draft)))
    expect(new Set(paths).size).toBe(paths.length)
    expect([...paths].sort()).toEqual([...locatedPaths(draft)].sort())
  })

  it('shows read-only values as they are stored', () => {
    const html = render(initialConfigForm(defaultConfig()))
    expect(html).toMatch(/<output[^>]*data-config-path="agencyCurrency"[^>]*>EUR<\/output>/)
    expect(html).toMatch(/<output[^>]*data-config-path="fxRates.rates.EUR"[^>]*>1<\/output>/)
    expect(html).toMatch(/<output[^>]*data-config-path="storage.lastSyncAt"[^>]*>none<\/output>/)
  })

  it('marks a monthly cost required only on an item that is not usage-based, and shows an empty one as empty', () => {
    const config = defaultConfig()
    config.runCostDefaults = [usageRunCostLineItem(), runCostLineItem()]
    const html = render(initialConfigForm(config))
    expect(tagFor(html, 'runCostDefaults.0.monthlyCost')).toContain('value=""')
    expect(tagFor(html, 'runCostDefaults.0.monthlyCost')).toContain('aria-required="false"')
    expect(tagFor(html, 'runCostDefaults.1.monthlyCost')).toContain('value="5"')
    expect(tagFor(html, 'runCostDefaults.1.monthlyCost')).toContain('aria-required="true"')
  })

  it('shows no usage formula table without a usage-based item', () => {
    const config = defaultConfig()
    config.runCostDefaults = [runCostLineItem()]
    const html = render(initialConfigForm(config))
    expect(html).not.toContain('Usage formulas')
    expect(html).toContain('Who pays, by delivery model')
  })
})

describe('ConfigSections, issue placement', () => {
  it('writes every issue of every broken rule under the control for its exact path', () => {
    for (const { rule, apply, paths } of CONFIG_RULE_BREAKS) {
      const draft = defaultConfig()
      apply(draft)
      const state: ConfigFormState = { saved: defaultConfig(), draft, texts: {} }
      const html = render(state)
      const issues = formIssues(state)
      expect(issues.map((issue) => issue.path).sort(), rule).toEqual([...paths].sort())
      for (const issue of issues) {
        expect(describedBy(html, issue.path), `${rule}: ${issue.path}`).toContain(`<li>${escapeHtml(issue.message)}</li>`)
      }
    }
  })

  it('marks the control invalid where its own issue is', () => {
    const draft = defaultConfig()
    draft.pricing.targetHourlyRate = 0
    const html = render({ saved: defaultConfig(), draft, texts: {} })
    expect(tagFor(html, 'pricing.targetHourlyRate')).toContain('aria-invalid="true"')
    expect(tagFor(html, 'scoring.valueCeiling')).toContain('aria-invalid="false"')
  })

  it('writes text issues under their fields: a new formula needs all five values', () => {
    const config = defaultConfig()
    config.runCostDefaults = [runCostLineItem()]
    const state = setNumberText(setUsageBased(initialConfigForm(config), 0, true), 'pricing.bands.0.floor', 'six hundred')
    const html = render(state)
    for (const key of ['callsPerMonth', 'avgInputTokens', 'avgOutputTokens', 'inputPricePerMTok', 'outputPricePerMTok']) {
      const path = `runCostDefaults.0.usageFormula.${key}`
      expect(tagFor(html, path), path).toContain('value=""')
      expect(describedBy(html, path), path).toContain(`<li>${VALUE_REQUIRED}</li>`)
    }
    expect(tagFor(html, 'pricing.bands.0.floor')).toContain('value="six hundred"')
    expect(describedBy(html, 'pricing.bands.0.floor')).toContain(`<li>${escapeHtml(NOT_A_NUMBER)}</li>`)
  })

  it('offers to add the formula a usage-based item is missing', () => {
    const config = defaultConfig()
    const { usageFormula: _dropped, ...missing } = usageRunCostLineItem()
    config.runCostDefaults = [missing]
    const html = render({ saved: defaultConfig(), draft: config, texts: {} })
    expect(html).toContain('>Add formula</button>')
    expect(describedBy(html, 'runCostDefaults.0.usageFormula')).toContain('usageFormula is required when usageBased is true')
  })

  it('warns about a stored rate with a dot before three digits, under that rate', () => {
    const config = defaultConfig()
    config.fxRates.rates.GBP = 1.175
    const html = render(initialConfigForm(config))
    expect(describedBy(html, 'fxRates.rates.GBP')).toContain(`text-warn">${escapeHtml(dotReadingWarning(1.175, 1175))}<`)
    expect(tagFor(html, 'fxRates.rates.GBP')).toContain('aria-invalid="false"')
  })
})

describe('ConfigSections, fractions', () => {
  it('shows the fraction as stored in the box and its percent in the label', () => {
    const html = render(initialConfigForm(defaultConfig()))
    expect(tagFor(html, 'estimation.overheads.testing')).toContain('value="0.2"')
    expect(html).toContain('>Testing overhead (20%)<span aria-hidden="true"> *</span></label>')
    expect(html).toContain('>Deployment overhead (8%)<')
    expect(html).toContain('>Contingency (15%)<')
    expect(html).toContain('>Discount rate (8%)<')
    expect(html).toContain('>Conservative factor<')
  })

  it('reads the percent from what is typed now, and shows none while the text does not parse', () => {
    const typed = render(setNumberText(initialConfigForm(defaultConfig()), 'estimation.overheads.testing', '0,15'))
    expect(tagFor(typed, 'estimation.overheads.testing')).toContain('value="0,15"')
    expect(typed).toContain('>Testing overhead (15%)<')

    // A comma before three digits is refused as ambiguous, so there is no reading to show a percent of.
    const ambiguous = render(setNumberText(initialConfigForm(defaultConfig()), 'estimation.overheads.testing', '0,125'))
    expect(ambiguous).toContain('>Testing overhead<span aria-hidden="true"> *</span></label>')

    const unreadable = render(setNumberText(initialConfigForm(defaultConfig()), 'estimation.overheads.testing', '20%'))
    expect(unreadable).toContain('>Testing overhead<span aria-hidden="true"> *</span></label>')
    expect(unreadable).not.toContain('Testing overhead (')

    const empty = render(setNumberText(initialConfigForm(defaultConfig()), 'estimation.contingency', ''))
    expect(empty).toContain('>Contingency<span aria-hidden="true"> *</span></label>')
  })

  it('never converts a typed percent: 20 stays 20 and the rule refuses it', () => {
    const state = setNumberText(initialConfigForm(defaultConfig()), 'estimation.overheads.testing', '20')
    const html = render(state)
    expect(html).toContain('>Testing overhead (2,000%)<')
    expect(describedBy(html, 'estimation.overheads.testing')).toContain('The testing overhead must be at least 0 and below 1')
  })
})
