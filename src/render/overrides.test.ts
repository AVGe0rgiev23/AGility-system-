import { describe, expect, it } from 'vitest'
import { mulberry32, randomInt } from '../engines/__fixtures__/engine-fixtures'
import { hashInputs } from '../engines/inputs-hash'
import { defaultConfig } from '../schema/config'
import { deliverable, engagement, library, newEngagement } from '../schema/__fixtures__/records'
import type { Engagement } from '../schema/engagement'
import type { DocumentTemplate, TemplateSection } from '../schema/library'
import { ArtifactRefSchema, type SectionOverride } from '../schema/scope'
import { textContent } from './nodes'
import {
  MAX_SNAPSHOT_PATHS,
  acceptEdit,
  createOverride,
  diffInputs,
  overrideBody,
  reconcileOverrides,
} from './overrides'
import { renderTemplate, type RenderedDocument, type RenderedSection } from './template'
import { buildViewModel } from './view-model'

const NOW = '2026-09-15T10:00:00.000Z'
const LATER = '2026-09-16T10:00:00.000Z'

const SECTIONS: TemplateSection[] = [
  { id: 'summary', heading: 'Summary', body: '{{company.name}} in {{company.industry}}.' },
  { id: 'deliverables', heading: 'Deliverables', body: '{{name}}', showIf: 'scope.deliverables', repeatOver: 'scope.deliverables' },
  { id: 'price', heading: 'Investment', body: 'Price {{scope.estimate.price}}', showIf: 'scope.estimate' },
]

function template(sections: TemplateSection[] = SECTIONS): DocumentTemplate {
  return { id: 'tpl', kind: 'proposal', name: 'Test', sections }
}

function render(record: Engagement = engagement(), sections?: TemplateSection[]): RenderedDocument {
  return renderTemplate(template(sections), buildViewModel({ engagement: record, config: defaultConfig(), library: library() }))
}

function sectionOf(doc: RenderedDocument, id: string): RenderedSection {
  const found = doc.sections.find((section) => section.id === id)
  if (found === undefined) throw new Error(`no section ${id}`)
  return found
}

function scopeOf(record: Engagement): NonNullable<Engagement['scope']> {
  if (record.scope === null) throw new Error('fixture has a scope')
  return record.scope
}

function edited(doc: RenderedDocument, id: string, content = 'My own words.'): SectionOverride {
  return createOverride(sectionOf(doc, id), content, NOW)
}

describe('createOverride', () => {
  it('pins the edit to the section hash and snapshots exactly what the section read', () => {
    const doc = render()
    const override = edited(doc, 'summary')
    expect(override).toEqual({
      sectionId: 'summary',
      content: 'My own words.',
      editedAt: NOW,
      baseInputsHash: sectionOf(doc, 'summary').inputsHash,
      baseInputs: { 'company.name': 'Rila Logistics', 'company.industry': 'logistics' },
      rebasedFrom: null,
    })
    expect(override.baseInputsHash).toBe(hashInputs(override.baseInputs))
  })

  it('produces an override the schema accepts, with leaf values only', () => {
    const doc = render()
    for (const id of ['summary', 'deliverables', 'price']) {
      const ref = { templateId: 'tpl', overrides: [edited(doc, id)], lastRenderedAt: null, sentAt: null, version: 1 }
      expect(ArtifactRefSchema.safeParse(ref).success, id).toBe(true)
    }
  })

  it('keys a repeated section by index, so per-iteration values are distinguishable', () => {
    const record = engagement()
    record.scope = { ...scopeOf(record), deliverables: [deliverable(), { ...deliverable(), id: 'd-2', name: 'Second' }] }
    const override = edited(render(record), 'deliverables')
    // The list length replaces the showIf boolean under the same path.
    expect(override.baseInputs).toEqual({
      'scope.deliverables': 2,
      'scope.deliverables.0.name': 'Quote intake automation',
      'scope.deliverables.1.name': 'Second',
    })
  })

  it('leaves the snapshot out above the path cap but keeps the hash', () => {
    const record = engagement()
    const many = Array.from({ length: MAX_SNAPSHOT_PATHS }, (_, i) => ({ ...deliverable(), id: `d-${i}`, name: `D${i}` }))
    record.scope = { ...scopeOf(record), deliverables: many }
    const section = sectionOf(render(record), 'deliverables')
    // The list length plus one name per item is one over the cap.
    expect(Object.keys(section.inputs)).toHaveLength(MAX_SNAPSHOT_PATHS + 1)
    const override = createOverride(section, 'x', NOW)
    expect(override.baseInputs).toBeNull()
    expect(override.baseInputsHash).toBe(section.inputsHash)

    record.scope = { ...scopeOf(record), deliverables: many.slice(0, -1) }
    expect(createOverride(sectionOf(render(record), 'deliverables'), 'x', NOW).baseInputs).not.toBeNull()
  })
})

describe('reconcileOverrides applies matching edits', () => {
  it('replaces the body with the edit when the hash matches, and reports it applied', () => {
    const doc = render()
    const override = edited(doc, 'summary', 'First line.\n\nSecond line.')
    const result = reconcileOverrides(doc, [override])
    expect(result.applied).toEqual(['summary'])
    expect(result.conflicts).toEqual([])
    expect(result.orphaned).toEqual([])
    const summary = result.sections.find((section) => section.id === 'summary')
    expect(summary?.override).toBe(override)
    expect(summary?.body.map(textContent)).toEqual(['First line.', 'Second line.'])
    expect(result.sections.find((section) => section.id === 'price')?.override).toBeNull()
  })

  it('renders edited text as literal characters', () => {
    const body = overrideBody('<b>bold</b> and {{company.name}}')
    expect(body.map(textContent)).toEqual(['<b>bold</b> and {{company.name}}'])
    expect(body[0]?.kind === 'element' && body[0].children[0]?.kind).toBe('text')
  })

  it('keeps an unrelated data change from conflicting: a contact, another section, an unread field', () => {
    const before = render()
    const overrides = [edited(before, 'summary'), edited(before, 'deliverables')]

    const record = engagement()
    record.contacts = [{ ...record.contacts[0], id: 'ct-9', name: 'Someone Else', isDecisionMaker: false }]
    record.company.employeeCount = 999
    record.tags = ['changed']
    // The price section reads the estimate; the summary and deliverables do not.
    const scope = scopeOf(record)
    if (scope.estimate === null) throw new Error('fixture has an estimate')
    record.scope = {
      ...scope,
      estimate: { ...scope.estimate, price: 9999 },
      // A deliverable field the repeated body never reads.
      deliverables: scope.deliverables.map((d) => ({ ...d, description: 'Rewritten description' })),
    }
    const result = reconcileOverrides(render(record), overrides)
    expect(result.applied).toEqual(['summary', 'deliverables'])
    expect(result.conflicts).toEqual([])
  })

  it('applies a migrated override with no snapshot when its hash still matches', () => {
    const doc = render()
    const legacy = { ...edited(doc, 'summary'), baseInputs: null }
    const result = reconcileOverrides(doc, [legacy])
    expect(result.applied).toEqual(['summary'])
  })

  it('keeps an edit on a hidden section without showing it', () => {
    const empty = newEngagement()
    const doc = render(empty)
    const override = edited(doc, 'price', 'Custom pricing text')
    const result = reconcileOverrides(doc, [override])
    expect(result.applied).toEqual(['price'])
    const price = result.sections.find((section) => section.id === 'price')
    expect(price?.visible).toBe(false)
    expect(price?.body).toEqual([])
    expect(price?.override).toBe(override)
  })

  it('returns an override whose section the template no longer has as orphaned, never dropped', () => {
    const doc = render()
    const override = edited(doc, 'summary')
    const result = reconcileOverrides(render(engagement(), SECTIONS.slice(1)), [override])
    expect(result.orphaned).toEqual([override])
    expect(result.applied).toEqual([])
    expect(result.conflicts).toEqual([])
  })
})

describe('reconcileOverrides conflicts', () => {
  it('conflicts when a value the section read changed, with old value, new value and the edit', () => {
    const before = render()
    const override = edited(before, 'summary', 'Edited summary.')
    const record = engagement()
    record.company.name = 'Rila Logistics EOOD'
    const after = render(record)
    const result = reconcileOverrides(after, [override])
    expect(result.applied).toEqual([])
    expect(result.conflicts).toEqual([
      {
        sectionId: 'summary',
        override,
        generated: sectionOf(after, 'summary'),
        drifted: [{ path: 'company.name', oldValue: 'Rila Logistics', newValue: 'Rila Logistics EOOD' }],
      },
    ])
    // The fresh body is what renders; the stale edit is not written over the new data.
    const summary = result.sections.find((section) => section.id === 'summary')
    expect(summary?.override).toBeNull()
    expect(summary?.body.map(textContent)).toEqual(['Rila Logistics EOOD in logistics.'])
    expect(result.conflicts[0]?.override.content).toBe('Edited summary.')
  })

  it('conflicts when a repeated collection grows, naming the added path', () => {
    const before = render()
    const override = edited(before, 'deliverables')
    const record = engagement()
    record.scope = { ...scopeOf(record), deliverables: [deliverable(), { ...deliverable(), id: 'd-2', name: 'Second' }] }
    const [conflict] = reconcileOverrides(render(record), [override]).conflicts
    expect(conflict?.drifted).toEqual([
      { path: 'scope.deliverables', oldValue: 1, newValue: 2 },
      { path: 'scope.deliverables.1.name', oldValue: undefined, newValue: 'Second' },
    ])
  })

  it('conflicts when a hidden section becomes visible', () => {
    const before = render(newEngagement())
    const override = edited(before, 'price')
    expect(override.baseInputs).toEqual({ 'scope.estimate': false })
    const [conflict] = reconcileOverrides(render(), [override]).conflicts
    expect(conflict?.sectionId).toBe('price')
    expect(conflict?.drifted).toEqual([
      { path: 'scope.estimate', oldValue: false, newValue: true },
      { path: 'scope.estimate.price', oldValue: undefined, newValue: 2378.545 },
    ])
  })

  it('conflicts when a visible section becomes hidden', () => {
    const override = edited(render(), 'price')
    const [conflict] = reconcileOverrides(render(newEngagement()), [override]).conflicts
    expect(conflict?.generated.visible).toBe(false)
    expect(conflict?.drifted?.map((d) => d.path)).toEqual(['scope.estimate', 'scope.estimate.price'])
  })

  it('still conflicts without a snapshot, with no per-path diff', () => {
    const legacy = { ...edited(render(), 'summary'), baseInputs: null }
    const record = engagement()
    record.company.name = 'Changed'
    const [conflict] = reconcileOverrides(render(record), [legacy]).conflicts
    expect(conflict?.drifted).toBeNull()
    expect(conflict?.override).toBe(legacy)
  })

  it('reports every override for one section, the later one winning the body', () => {
    const doc = render()
    const first = edited(doc, 'summary', 'First')
    const second = { ...edited(doc, 'summary', 'Second'), editedAt: LATER }
    const result = reconcileOverrides(doc, [first, second])
    expect(result.applied).toEqual(['summary', 'summary'])
    expect(result.sections.find((section) => section.id === 'summary')?.body.map(textContent)).toEqual(['Second'])
  })
})

describe('acceptEdit', () => {
  it('rebases the edit onto the fresh render and records the hash it was kept over', () => {
    const override = edited(render(), 'summary', 'Edited summary.')
    const record = engagement()
    record.company.name = 'Changed'
    const after = render(record)
    const [conflict] = reconcileOverrides(after, [override]).conflicts
    if (conflict === undefined) throw new Error('expected a conflict')
    const kept = acceptEdit(conflict, LATER)
    expect(kept).toEqual({
      sectionId: 'summary',
      content: 'Edited summary.',
      editedAt: LATER,
      baseInputsHash: sectionOf(after, 'summary').inputsHash,
      baseInputs: { 'company.name': 'Changed', 'company.industry': 'logistics' },
      rebasedFrom: override.baseInputsHash,
    })
    // Clean on the next render of the same data, and still a conflict on the next change.
    expect(reconcileOverrides(render(record), [kept]).applied).toEqual(['summary'])
    record.company.industry = 'freight'
    const [again] = reconcileOverrides(render(record), [kept]).conflicts
    expect(again?.drifted).toEqual([{ path: 'company.industry', oldValue: 'logistics', newValue: 'freight' }])
    expect(acceptEdit(again as NonNullable<typeof again>, LATER).rebasedFrom).toBe(kept.baseInputsHash)
  })
})

describe('diffInputs', () => {
  it('lists changed, added and removed paths in path order', () => {
    expect(diffInputs({ a: 1, b: 'x', c: true }, { a: 2, c: true, d: null })).toEqual([
      { path: 'a', oldValue: 1, newValue: 2 },
      { path: 'b', oldValue: 'x', newValue: undefined },
      { path: 'd', oldValue: undefined, newValue: null },
    ])
    expect(diffInputs({ a: 0 }, { a: -0 })).toEqual([{ path: 'a', oldValue: 0, newValue: -0 }])
  })
})

describe('conflict iff a read path changed (property)', () => {
  const random = mulberry32(7)
  // Fields the summary section reads and fields it does not, mutated at random.
  const readEdits = [
    (record: Engagement) => (record.company.name = `Name ${randomInt(random, 0, 3)}`),
    (record: Engagement) => (record.company.industry = `Industry ${randomInt(random, 0, 3)}`),
  ]
  const unreadEdits = [
    (record: Engagement) => (record.company.employeeCount = randomInt(random, 1, 500)),
    (record: Engagement) => (record.tags = [`t${randomInt(random, 0, 9)}`]),
    (record: Engagement) => (record.company.statedTools = [`tool${randomInt(random, 0, 9)}`]),
    (record: Engagement) => {
      record.scope = { ...scopeOf(record), exclusions: [`x${randomInt(random, 0, 9)}`] }
    },
  ]

  it('holds over 200 random edit sets', () => {
    for (let i = 0; i < 200; i++) {
      const base = engagement()
      base.company.name = `Name ${randomInt(random, 0, 3)}`
      base.company.industry = `Industry ${randomInt(random, 0, 3)}`
      const override = edited(render(base), 'summary')
      const baseInputs = override.baseInputs
      if (baseInputs === null) throw new Error('summary reads two paths')

      const record = structuredClone(base)
      for (const edit of unreadEdits) if (random() < 0.5) edit(record)
      for (const edit of readEdits) if (random() < 0.3) edit(record)

      const after = render(record)
      const result = reconcileOverrides(after, [override])
      const readChanged = diffInputs(baseInputs, sectionOf(after, 'summary').inputs).length > 0
      expect(result.conflicts.length > 0, `case ${i}`).toBe(readChanged)
      expect(result.applied.length > 0, `case ${i}`).toBe(!readChanged)
    }
  })
})
