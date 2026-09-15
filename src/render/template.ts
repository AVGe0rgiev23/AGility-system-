import { fmt } from '../engines/format'
import { hashInputs } from '../engines/inputs-hash'
import type { DocumentTemplate, TemplateSection } from '../schema/library'
import type { RenderScalar } from '../schema/scope'
import { el, text, type ElementNode, type RenderNode } from './nodes'
import { RenderError, Resolver, isScalar, type Frame } from './resolve'
import type { ViewModel } from './view-model'

// Mustache-style rendering of a DocumentTemplate against a ViewModel, into a node tree.
// Each section is rendered on its own and records every value it read; the hash over those
// reads is what an override is pinned to. Nothing here produces HTML text: every interpolated
// value becomes a text node, so markup inside client data is displayed, never parsed.

export interface RenderedSection {
  id: string
  heading: string
  // False when showIf resolved falsy. The section is still listed, with its showIf read
  // recorded, so an override on it keeps a hash that changes when it becomes visible.
  visible: boolean
  body: RenderNode[]
  // Every value the section read, keyed by absolute view-model path: interpolations as their
  // value, showIf as its boolean, repeatOver as the collection's length.
  inputs: Record<string, RenderScalar>
  inputsHash: string
}

export interface RenderedDocument {
  templateId: string
  sections: RenderedSection[]
}

type Token = { kind: 'text'; value: string } | { kind: 'ref'; expression: string }

const REF = /\{\{([^{}]*)\}\}/g

// Paragraphs are separated by a blank line. Inside one, {{ path }} is a reference and
// everything else is literal text.
function parseBody(body: string, sectionId: string): Token[][] {
  return body
    .split(/\n[ \t]*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== '')
    .map((paragraph) => {
      const tokens: Token[] = []
      let last = 0
      for (const match of paragraph.matchAll(REF)) {
        const index = match.index
        if (index > last) tokens.push({ kind: 'text', value: paragraph.slice(last, index) })
        tokens.push({ kind: 'ref', expression: match[1] ?? '' })
        last = index + match[0].length
      }
      const rest = paragraph.slice(last)
      if (rest.includes('{{')) {
        throw new RenderError(`unclosed "{{" in "${rest.slice(rest.indexOf('{{'), rest.indexOf('{{') + 30)}"`, sectionId, '')
      }
      if (rest !== '') tokens.push({ kind: 'text', value: rest })
      return tokens
    })
}

function describe(value: unknown): string {
  if (Array.isArray(value)) return 'a list'
  if (value === null) return 'null'
  return typeof value === 'object' ? 'an object' : typeof value
}

// A falsy showIf hides the section: null anywhere along the path, false, 0, an empty string
// or an empty list. Only a path that does not exist at all is an error.
function truthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0
  return value !== null && value !== false && value !== 0 && value !== ''
}

function interpolate(resolver: Resolver, expression: string, frames: Frame[], sectionId: string): string {
  const { path, value, nullAt } = resolver.resolve(expression, frames)
  if (nullAt !== null) {
    throw new RenderError(
      `"${path}" cannot be shown because "${nullAt}" is null; guard the section with showIf`,
      sectionId,
      path,
    )
  }
  if (typeof value === 'string') {
    resolver.record(path, value)
    return value
  }
  if (typeof value === 'number') {
    resolver.record(path, value)
    // fmt rounds to two decimals, which is right for prose and wrong for a money column: a
    // stored 1234.567 prints as 1234.57 while the total is summed from the unrounded figures.
    // The investment and run-cost tables (Stage 3b) need a dedicated currency formatter that
    // does not silently round, and every printed line item must reconcile against its total.
    return fmt(value)
  }
  throw new RenderError(
    `"${path}" is ${describe(value)}, which cannot be written as text${value === null ? '; guard the section with showIf' : ''}`,
    sectionId,
    path,
  )
}

function renderParagraphs(resolver: Resolver, paragraphs: Token[][], frames: Frame[], sectionId: string): RenderNode[] {
  return paragraphs.map((tokens) =>
    el(
      'p',
      {},
      tokens.map((token) =>
        token.kind === 'text' ? text(token.value) : text(interpolate(resolver, token.expression, frames, sectionId)),
      ),
    ),
  )
}

function renderSection(section: TemplateSection, model: ViewModel): RenderedSection {
  const resolver = new Resolver(section.id)
  const root: Frame = { base: '', value: model }
  const paragraphs = parseBody(section.body, section.id)

  let visible = true
  if (section.showIf !== undefined) {
    const { path, value, nullAt } = resolver.resolve(section.showIf, [root])
    visible = nullAt === null && truthy(value)
    resolver.record(path, visible)
  }

  let body: RenderNode[] = []
  if (visible && section.repeatOver !== undefined) {
    const { path, value, nullAt } = resolver.resolve(section.repeatOver, [root])
    if (nullAt !== null) {
      throw new RenderError(`cannot repeat over "${path}" because "${nullAt}" is null; guard the section with showIf`, section.id, path)
    }
    if (!Array.isArray(value)) {
      throw new RenderError(`repeatOver "${path}" is ${describe(value)}, not a list`, section.id, path)
    }
    resolver.record(path, value.length)
    body = value.map((item: unknown, index) => {
      const frames = [root, { base: `${path}.${index}`, value: item }]
      return el('div', { className: 'repeat-item' }, renderParagraphs(resolver, paragraphs, frames, section.id))
    })
  } else if (visible) {
    body = renderParagraphs(resolver, paragraphs, [root], section.id)
  }

  const inputs = resolver.inputs()
  return { id: section.id, heading: section.heading, visible, body, inputs, inputsHash: hashInputs(inputs) }
}

export function renderTemplate(template: DocumentTemplate, model: ViewModel): RenderedDocument {
  const seen = new Set<string>()
  for (const section of template.sections) {
    if (seen.has(section.id)) {
      throw new RenderError('section id appears twice in the template, so an override could not name it', section.id, '')
    }
    seen.add(section.id)
  }
  return { templateId: template.id, sections: template.sections.map((section) => renderSection(section, model)) }
}

// A section as an element: heading first, then its body. Hidden sections have no element.
export function sectionNode(section: RenderedSection): ElementNode {
  return el('section', { id: section.id }, [el('h2', {}, [text(section.heading)]), ...section.body])
}

export { isScalar }
