import type { DocumentLike } from '../nodes'

// A stand-in for the DOM that records exactly which factory each piece of text went through.
// Tests run in node, and a real document would also let markup slip in unnoticed; this one
// makes every text node and every attribute assignment visible.

export interface FakeNode {
  nodeType: 'element' | 'text'
  tag?: string
  data?: string
  attrs: Record<string, string>
  children: FakeNode[]
  setAttribute(name: string, value: string): void
  appendChild(child: FakeNode): FakeNode
}

export interface FakeDocument extends DocumentLike {
  createdText: string[]
  createdTags: string[]
}

function fakeNode(init: Pick<FakeNode, 'nodeType' | 'tag' | 'data'>): FakeNode {
  const node: FakeNode = {
    ...init,
    attrs: {},
    children: [],
    setAttribute(name, value) {
      node.attrs[name] = value
    },
    appendChild(child) {
      node.children.push(child)
      return child
    },
  }
  return node
}

export function fakeDocument(): FakeDocument {
  const createdText: string[] = []
  const createdTags: string[] = []
  // The Document methods are typed against real DOM nodes; the fake satisfies the calls the
  // adapter makes and nothing more, so the cast is confined to this fixture.
  const doc = {
    createdText,
    createdTags,
    createElement(tag: string) {
      createdTags.push(tag)
      return fakeNode({ nodeType: 'element', tag })
    },
    createTextNode(data: string) {
      createdText.push(data)
      return fakeNode({ nodeType: 'text', data })
    },
  }
  return doc as unknown as FakeDocument
}

export function asFake(node: Node): FakeNode {
  return node as unknown as FakeNode
}
