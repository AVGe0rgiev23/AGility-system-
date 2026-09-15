import { describe, expect, it } from 'vitest'
import { asFake, fakeDocument } from './__fixtures__/fake-document'
import { el, text, textContent, toDom } from './nodes'

const SCRIPT = '<script>alert(1)</script>'

describe('toDom', () => {
  it('builds elements and text nodes through the document factories only', () => {
    const doc = fakeDocument()
    const tree = el('section', { id: 'summary' }, [el('h2', {}, [text('Summary')]), el('p', {}, [text('Body')])])
    const root = asFake(toDom(tree, doc))
    expect(root.tag).toBe('section')
    expect(root.attrs).toEqual({ id: 'summary' })
    expect(root.children.map((child) => child.tag)).toEqual(['h2', 'p'])
    expect(root.children[0]?.children[0]?.data).toBe('Summary')
    expect(doc.createdTags).toEqual(['section', 'h2', 'p'])
    expect(doc.createdText).toEqual(['Summary', 'Body'])
  })

  it('renders markup in text as the literal characters, never as elements', () => {
    const doc = fakeDocument()
    const root = asFake(toDom(el('p', {}, [text(SCRIPT), text('<img src=x onerror=alert(1)>'), text('&lt;b&gt;')]), doc))
    expect(doc.createdTags).toEqual(['p'])
    expect(doc.createdText).toEqual([SCRIPT, '<img src=x onerror=alert(1)>', '&lt;b&gt;'])
    expect(root.children.every((child) => child.nodeType === 'text')).toBe(true)
  })

  it('sets a class through setAttribute and omits attributes that are not given', () => {
    const doc = fakeDocument()
    const root = asFake(toDom(el('div', { className: 'repeat-item' }, []), doc))
    expect(root.attrs).toEqual({ class: 'repeat-item' })
    expect(asFake(toDom(el('div', {}, []), doc)).attrs).toEqual({})
  })
})

describe('textContent', () => {
  it('concatenates every text node in document order', () => {
    const tree = el('section', {}, [el('h2', {}, [text('A')]), el('p', {}, [text('B'), text('C')])])
    expect(textContent(tree)).toBe('ABC')
    expect(textContent(text(SCRIPT))).toBe(SCRIPT)
  })
})
