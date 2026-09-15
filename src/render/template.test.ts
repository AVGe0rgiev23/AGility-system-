import { describe, expect, it } from 'vitest'
import { hashInputs } from '../engines/inputs-hash'
import { defaultConfig } from '../schema/config'
import { deliverable, documentTemplate, engagement, library, newEngagement } from '../schema/__fixtures__/records'
import type { Engagement } from '../schema/engagement'
import type { DocumentTemplate, TemplateSection } from '../schema/library'
import { fakeDocument } from './__fixtures__/fake-document'
import { textContent, toDom } from './nodes'
import { RenderError } from './resolve'
import { renderTemplate, sectionNode, type RenderedSection } from './template'
import { buildViewModel, type ViewModel } from './view-model'

const SCRIPT = '<script>alert(1)</script>'
const IMG = '<img src=x onerror=alert(1)>'

function model(record: Engagement = engagement()): ViewModel {
  return buildViewModel({ engagement: record, config: defaultConfig(), library: library() })
}

function template(...sections: TemplateSection[]): DocumentTemplate {
  return { id: 'tpl', kind: 'proposal', name: 'Test', sections }
}

function section(partial: Partial<TemplateSection> & { body: string }): TemplateSection {
  return { id: 'sec', heading: 'Heading', ...partial }
}

function render(partial: Partial<TemplateSection> & { body: string }, record?: Engagement): RenderedSection {
  const [rendered] = renderTemplate(template(section(partial)), model(record)).sections
  if (rendered === undefined) throw new Error('one section in, one out')
  return rendered
}

function paragraphs(rendered: RenderedSection): string[] {
  return rendered.body.map(textContent)
}

function catchRender(partial: Partial<TemplateSection> & { body: string }, record?: Engagement): RenderError {
  try {
    render(partial, record)
  } catch (caught) {
    if (caught instanceof RenderError) return caught
    throw caught
  }
  throw new Error('expected a RenderError')
}

describe('renderTemplate interpolation', () => {
  it('interpolates strings and numbers into paragraphs split on blank lines', () => {
    const rendered = render({ body: '{{company.name}} in {{company.industry}}.\n\nRate {{ company.blendedHourlyCost.value }} {{company.blendedHourlyCost.unit}}.' })
    expect(paragraphs(rendered)).toEqual(['Rila Logistics in logistics.', 'Rate 16 EUR/hour.'])
    expect(rendered.body.map((node) => (node.kind === 'element' ? node.tag : 'text'))).toEqual(['p', 'p'])
    expect(rendered.visible).toBe(true)
  })

  it('formats a number with two decimals at most, which is for prose and not for money columns', () => {
    const record = engagement()
    record.company.employeeCount = 41.256
    expect(paragraphs(render({ body: '{{company.employeeCount}} people' }, record))).toEqual(['41.26 people'])
  })

  it('records exactly the values it read, keyed by absolute path, and hashes them', () => {
    const rendered = render({ body: '{{company.name}} pays {{company.blendedHourlyCost.value}}.' })
    expect(rendered.inputs).toEqual({ 'company.name': 'Rila Logistics', 'company.blendedHourlyCost.value': 16 })
    expect(rendered.inputsHash).toBe(hashInputs(rendered.inputs))
  })

  it('pins the hash of a fixed section, so a change to the read map or the hash is deliberate', () => {
    expect(render({ body: '{{company.name}}' }).inputsHash).toBe(hashInputs({ 'company.name': 'Rila Logistics' }))
    expect(render({ body: '{{company.name}}' }).inputsHash).toBe('053f6bdca163a0')
  })

  it('errors on a path that does not exist, naming the path and the section', () => {
    const error = catchRender({ id: 'intro', body: 'Hello {{company.nmae}}' })
    expect(error.sectionId).toBe('intro')
    expect(error.path).toBe('company.nmae')
    expect(error.message).toContain('company.nmae')
    expect(error.message).toContain('"intro"')
  })

  it('errors on a null value or a null on the way, pointing at showIf', () => {
    expect(catchRender({ body: '{{company.website}}' }, newEngagement()).message).toContain('showIf')
    const deep = catchRender({ body: '{{scope.estimate.price}}' }, newEngagement())
    expect(deep.path).toBe('scope.estimate.price')
    expect(deep.message).toContain('"scope" is null')
  })

  it('errors on a value that is not text: an object, a list or a boolean', () => {
    expect(catchRender({ body: '{{company}}' }).message).toContain('an object')
    expect(catchRender({ body: '{{company.statedTools}}' }).message).toContain('a list')
    expect(catchRender({ body: '{{company.constraints}}' }).path).toBe('company.constraints')
    const record = engagement()
    expect(catchRender({ body: '{{processes.0.customerFacing}}' }, record).message).toContain('boolean')
  })

  it('errors on an unclosed reference, an empty one and a malformed path', () => {
    expect(catchRender({ body: 'Dear {{company.name' }).message).toContain('unclosed')
    expect(() => render({ body: '{{}}' })).toThrow(RenderError)
    expect(() => render({ body: '{{company[0]}}' })).toThrow(RenderError)
  })

  it('never resolves an inherited property', () => {
    expect(() => render({ body: '{{constructor}}' })).toThrow(RenderError)
    expect(() => render({ body: '{{company.__proto__}}' })).toThrow(RenderError)
  })

  it('refuses a template whose section ids collide', () => {
    const doc = template(section({ id: 'dup', body: 'a' }), section({ id: 'dup', body: 'b' }))
    expect(() => renderTemplate(doc, model())).toThrow(RenderError)
  })

  it('renders an empty body as a visible section with no paragraphs', () => {
    const rendered = render({ body: '' })
    expect(rendered.visible).toBe(true)
    expect(rendered.body).toEqual([])
    expect(rendered.inputs).toEqual({})
  })
})

describe('renderTemplate markup in data', () => {
  function hostile(): Engagement {
    const record = engagement()
    record.company.name = SCRIPT
    record.opportunities = record.opportunities.map((o) => ({ ...o, summary: IMG }))
    if (record.scope !== null) {
      record.scope = {
        ...record.scope,
        deliverables: [{ ...deliverable(), name: SCRIPT }],
        exclusions: ['</p><script>x</script>', '&lt;b&gt;'],
      }
    }
    return record
  }

  it('renders a company name containing <script> as visible text through a plain interpolation', () => {
    const rendered = render({ body: 'Prepared for {{company.name}}.' }, hostile())
    expect(paragraphs(rendered)).toEqual([`Prepared for ${SCRIPT}.`])
    const doc = fakeDocument()
    toDom(sectionNode(rendered), doc)
    expect(doc.createdTags).toEqual(['section', 'h2', 'p'])
    expect(doc.createdText).toEqual(['Heading', 'Prepared for ', SCRIPT, '.'])
  })

  it('keeps markup literal inside a repeat, in the current item and in a root fallback', () => {
    const rendered = render({ body: '{{name}} for {{company.name}}', repeatOver: 'scope.deliverables' }, hostile())
    expect(paragraphs(rendered)).toEqual([`${SCRIPT} for ${SCRIPT}`])
    const items = render({ body: '{{.}}', repeatOver: 'scope.exclusions' }, hostile())
    expect(paragraphs(items)).toEqual(['</p><script>x</script>', '&lt;b&gt;'])
    const doc = fakeDocument()
    for (const node of items.body) toDom(node, doc)
    expect(doc.createdTags).toEqual(['div', 'p', 'div', 'p'])
    expect(doc.createdText).toEqual(['</p><script>x</script>', '&lt;b&gt;'])
  })

  it('keeps markup literal in an opportunity summary and in a heading', () => {
    const rendered = render({ heading: SCRIPT, body: '{{opportunities.0.summary}}' }, hostile())
    expect(paragraphs(rendered)).toEqual([IMG])
    const doc = fakeDocument()
    toDom(sectionNode(rendered), doc)
    expect(doc.createdText).toEqual([SCRIPT, IMG])
    expect(doc.createdTags).not.toContain('script')
    expect(doc.createdTags).not.toContain('img')
  })

  it('keeps braces in data literal rather than resolving them', () => {
    const record = engagement()
    record.company.name = '{{company.industry}}'
    expect(paragraphs(render({ body: '{{company.name}}' }, record))).toEqual(['{{company.industry}}'])
  })
})

describe('renderTemplate showIf', () => {
  it('hides a section whose path leads through a null, recording the read as false', () => {
    const rendered = render({ body: '{{scope.estimate.price}}', showIf: 'scope.estimate.price' }, newEngagement())
    expect(rendered.visible).toBe(false)
    expect(rendered.body).toEqual([])
    expect(rendered.inputs).toEqual({ 'scope.estimate.price': false })
    expect(rendered.inputsHash).toBe(hashInputs({ 'scope.estimate.price': false }))
  })

  it('shows a section whose nested path is truthy and records the read as true', () => {
    const rendered = render({ body: 'Price {{scope.estimate.price}}', showIf: 'scope.estimate.price' })
    expect(rendered.visible).toBe(true)
    expect(paragraphs(rendered)).toEqual(['Price 2378.55'])
    // The interpolated value replaces the showIf boolean under the same path: it carries strictly
    // more, since visibility follows from it. It is the stored value, not the printed one.
    expect(rendered.inputs).toEqual({ 'scope.estimate.price': 2378.545 })
  })

  it('treats false, 0, an empty string, an empty list and null as hidden', () => {
    const record = engagement()
    record.company.employeeCount = 0
    record.company.statedTools = []
    record.company.sourceOfTruth = ''
    record.processes = record.processes.map((p) => ({ ...p, customerFacing: false }))
    for (const path of ['company.employeeCount', 'company.statedTools', 'company.sourceOfTruth', 'processes.0.customerFacing', 'company.website']) {
      const rendered = render({ body: 'x', showIf: path }, path === 'company.website' ? newEngagement() : record)
      expect(rendered.visible, path).toBe(false)
    }
    expect(render({ body: 'x', showIf: 'company.statedTools' }).visible).toBe(true)
  })

  it('errors on a showIf path that does not exist, so a typo cannot hide a section forever', () => {
    const error = catchRender({ id: 'roi', body: 'x', showIf: 'scope.estimat.price' })
    expect(error.path).toBe('scope.estimat.price')
    expect(error.sectionId).toBe('roi')
  })

  it('gives two hidden sections different hashes, so visibility is part of the inputs', () => {
    const a = render({ body: 'x', showIf: 'scope.estimate' }, newEngagement())
    const b = render({ body: 'x', showIf: 'scope.roi' }, newEngagement())
    expect(a.visible).toBe(false)
    expect(b.visible).toBe(false)
    expect(a.inputsHash).not.toBe(b.inputsHash)
  })

  it('does not read the body of a hidden section, so a null inside it is not an error', () => {
    const rendered = render({ body: '{{scope.estimate.price}} {{company.nonsense}}', showIf: 'scope' }, newEngagement())
    expect(rendered.visible).toBe(false)
  })
})

describe('renderTemplate repeatOver', () => {
  it('renders the body once per item, keyed by index, and records the length', () => {
    const record = engagement()
    if (record.scope === null) throw new Error('fixture has a scope')
    record.scope = { ...record.scope, deliverables: [deliverable(), { ...deliverable(), id: 'd-2', name: 'Second' }] }
    const rendered = render({ body: '{{name}}: {{description}}', repeatOver: 'scope.deliverables' }, record)
    expect(rendered.body.map((node) => (node.kind === 'element' ? node.attrs.className : ''))).toEqual(['repeat-item', 'repeat-item'])
    expect(paragraphs(rendered)).toEqual([
      `Quote intake automation: ${deliverable().description}`,
      `Second: ${deliverable().description}`,
    ])
    expect(rendered.inputs).toEqual({
      'scope.deliverables': 2,
      'scope.deliverables.0.name': 'Quote intake automation',
      'scope.deliverables.0.description': deliverable().description,
      'scope.deliverables.1.name': 'Second',
      'scope.deliverables.1.description': deliverable().description,
    })
  })

  it('renders nothing for an empty collection, without error, and records length 0', () => {
    const record = engagement()
    if (record.scope === null) throw new Error('fixture has a scope')
    record.scope = { ...record.scope, deliverables: [] }
    const rendered = render({ body: '{{name}}', repeatOver: 'scope.deliverables' }, record)
    expect(rendered.visible).toBe(true)
    expect(rendered.body).toEqual([])
    expect(rendered.inputs).toEqual({ 'scope.deliverables': 0 })
  })

  it('hides the section when showIf names the empty collection', () => {
    const record = engagement()
    if (record.scope === null) throw new Error('fixture has a scope')
    record.scope = { ...record.scope, deliverables: [] }
    const rendered = render({ body: '{{name}}', showIf: 'scope.deliverables', repeatOver: 'scope.deliverables' }, record)
    expect(rendered.visible).toBe(false)
    expect(rendered.inputs).toEqual({ 'scope.deliverables': false })
  })

  it('errors when the path is not a list or leads through a null', () => {
    expect(catchRender({ body: 'x', repeatOver: 'scope.deliveryModel' }).message).toContain('not a list')
    expect(catchRender({ body: 'x', repeatOver: 'company' }).message).toContain('not a list')
    const error = catchRender({ body: 'x', repeatOver: 'scope.deliverables' }, newEngagement())
    expect(error.message).toContain('"scope" is null')
  })

  it('resolves "." to the item of a list of strings', () => {
    const rendered = render({ body: '- {{.}}', repeatOver: 'scope.exclusions' })
    expect(paragraphs(rendered)).toEqual(['- Historic email backfill'])
    expect(rendered.inputs).toEqual({ 'scope.exclusions': 1, 'scope.exclusions.0': 'Historic email backfill' })
  })

  it('renders the fixture template end to end', () => {
    const rendered = renderTemplate(documentTemplate(), model())
    expect(rendered.templateId).toBe('tpl-proposal')
    expect(rendered.sections.map((s) => s.id)).toEqual(['executive-summary', 'deliverables'])
    expect(paragraphs(rendered.sections[0] as RenderedSection)).toEqual(['Rila Logistics spends too long retyping quotes.'])
    expect(paragraphs(rendered.sections[1] as RenderedSection)).toEqual(['Quote intake automation'])
  })
})

describe('sectionNode', () => {
  it('wraps the heading and body in a section carrying the id', () => {
    const node = sectionNode(render({ id: 'intro', heading: 'Intro', body: 'Hi {{company.name}}' }))
    expect(node.tag).toBe('section')
    expect(node.attrs).toEqual({ id: 'intro' })
    expect(textContent(node)).toBe('IntroHi Rila Logistics')
  })
})
