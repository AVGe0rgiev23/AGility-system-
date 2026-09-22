import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  addToList,
  initialPatternForm,
  locatedPaths,
  patternFormView,
  setChoice,
  setNumberText,
  setText,
  type PatternFormState,
} from '../../../hooks/use-pattern-form'
import { pattern } from '../../../schema/__fixtures__/records'
import type { Pattern } from '../../../schema/library'
import { describedBy, escapeHtml, renderedPaths, tagFor } from '../../__fixtures__/markup'
import { PatternEditorScreen, PatternMissing } from './pattern-editor-view'

const ignore = () => undefined

function render(state: PatternFormState, patch: { used?: number; saving?: boolean; saveError?: string | null } = {}): string {
  return renderToStaticMarkup(<PatternEditorScreen form={patternFormView(state, ignore)} used={patch.used ?? 0} saving={patch.saving ?? false} saveError={patch.saveError ?? null} onSave={ignore} />)
}

// A pattern with none of its list entries, so every control offered for an absent value is shown.
function bare(): Pattern {
  return { ...pattern(), requiredIntegrations: [], risks: [] }
}

describe('PatternEditorScreen, every field', () => {
  it('gives every leaf of a full pattern a control, except the id and what usedInEngagements holds', () => {
    const state = initialPatternForm(pattern())
    const html = render(state)
    const located = locatedPaths(state.draft)
    for (const key of Object.keys(pattern()) as (keyof Pattern)[]) {
      if (key === 'id' || key === 'blueprintSkeleton' || key === 'usedInEngagements') continue
      if (key === 'requiredIntegrations' || key === 'risks') {
        expect(located.has(key)).toBe(true)
        continue
      }
      expect(located.has(key), key).toBe(true)
      expect(tagFor(html, key), key).toMatch(/^<(input|select|textarea) /)
    }
  })

  it('offers a control to add a first entry when the lists are empty', () => {
    const html = render(initialPatternForm(bare()))
    expect(html).toContain('>Add integration</button>')
    expect(html).toContain('>Add risk</button>')
    expect(html).toContain('No required integrations')
    expect(html).toContain('No risks')
  })

  it('shows exactly the paths the form model places issues at', () => {
    const state = addToList(addToList(initialPatternForm(pattern()), 'requiredIntegrations'), 'risks')
    const addressed = [...locatedPaths(state.draft)]
    expect([...renderedPaths(render(state))].sort()).toEqual(addressed.sort())
  })
})

describe('PatternEditorScreen, what it says', () => {
  it('heads the pattern with its name, complexity and how many opportunities use it', () => {
    const html = render(initialPatternForm(pattern()), { used: 3 })
    expect(html).toContain('Email triage')
    expect(html).toContain('<span class="num text-xs text-muted">medium</span>')
    expect(html).toMatch(/<span class="num">3<\/span> opportunities/)
    expect(render(initialPatternForm(pattern()), { used: 1 })).toMatch(/<span class="num">1<\/span> opportunity(?!ies)/)
  })

  it('shows a stored value as raw editable text', () => {
    const html = render(initialPatternForm(pattern()))
    expect(tagFor(html, 'baseHours')).toContain('value="12"')
    expect(tagFor(html, 'name')).toContain('value="Email triage"')
    expect(html).toContain('<option value="medium" selected="">medium</option>')
  })

  it('lists required integrations and risks with a way to remove each', () => {
    const html = render(initialPatternForm(pattern()))
    expect(tagFor(html, 'requiredIntegrations.0')).toContain('value="Gmail"')
    expect(tagFor(html, 'requiredIntegrations.1')).toContain('value="HubSpot"')
    expect(html).toContain(`aria-label="${escapeHtml("Remove 'Gmail'")}"`)
  })

  it('reports a save error', () => {
    expect(render(initialPatternForm(pattern()), { saveError: 'the database is closed' })).toContain('The pattern was not saved: the database is closed')
  })
})

describe('PatternEditorScreen, issues', () => {
  it('writes the blank-name rule at its control', () => {
    const state = setText(initialPatternForm(pattern()), 'name', ' ')
    expect(describedBy(render(state), 'name')).toContain(`<li>${escapeHtml('A pattern needs a name')}</li>`)
  })

  it('writes the base-hours rules at its control: required when cleared, positive when not', () => {
    const cleared = setNumberText(initialPatternForm(pattern()), 'baseHours', '')
    expect(describedBy(render(cleared), 'baseHours')).toContain('A value is required')
    const zero = setNumberText(initialPatternForm(pattern()), 'baseHours', '0')
    expect(describedBy(render(zero), 'baseHours')).toContain(escapeHtml('expected number to be >0'))
  })

  it('edits complexity by choice', () => {
    const state = setChoice(initialPatternForm(pattern()), 'complexity', 'high')
    expect(render(state)).toContain('<option value="high" selected="">high</option>')
  })
})

describe('PatternMissing', () => {
  it('says so, with a way back, when the address names a pattern the Library does not have', () => {
    const html = renderToStaticMarkup(<PatternMissing title="Pattern not found" detail="There is no pattern 'pat-gone'." />)
    expect(html).toContain(escapeHtml("There is no pattern 'pat-gone'."))
    expect(html).toContain('href="#/patterns"')
    expect(html).toContain('Back to the patterns')
  })
})
