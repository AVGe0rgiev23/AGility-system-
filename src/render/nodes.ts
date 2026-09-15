// Rendered documents are trees of these nodes, never strings of HTML. Every piece of text,
// client-supplied or not, is a text node, so a company name containing markup is displayed as
// the characters it contains. toDom turns a tree into real DOM through createElement and
// createTextNode only; nothing here or downstream ever assigns innerHTML.

export type RenderTag = 'section' | 'h2' | 'p' | 'div'

export interface TextNode {
  kind: 'text'
  text: string
}

export interface ElementNode {
  kind: 'element'
  tag: RenderTag
  attrs: { id?: string; className?: string }
  children: RenderNode[]
}

export type RenderNode = TextNode | ElementNode

export function text(value: string): TextNode {
  return { kind: 'text', text: value }
}

export function el(tag: RenderTag, attrs: ElementNode['attrs'], children: RenderNode[]): ElementNode {
  return { kind: 'element', tag, attrs, children }
}

// The subset of Document the adapter needs, injected so the render layer never touches a global.
export type DocumentLike = Pick<Document, 'createElement' | 'createTextNode'>

export function toDom(node: RenderNode, doc: DocumentLike): Node {
  if (node.kind === 'text') return doc.createTextNode(node.text)
  const element = doc.createElement(node.tag)
  if (node.attrs.id !== undefined) element.setAttribute('id', node.attrs.id)
  if (node.attrs.className !== undefined) element.setAttribute('class', node.attrs.className)
  for (const child of node.children) element.appendChild(toDom(child, doc))
  return element
}

// The visible text of a tree, for tests and plain-text previews. Not HTML.
export function textContent(node: RenderNode): string {
  return node.kind === 'text' ? node.text : node.children.map(textContent).join('')
}
