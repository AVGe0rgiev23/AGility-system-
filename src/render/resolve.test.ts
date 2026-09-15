import { describe, expect, it } from 'vitest'
import { RenderError, Resolver, parsePath, type Frame } from './resolve'

const model = {
  company: { name: 'Rila', website: null, blendedHourlyCost: { value: 16 } },
  scope: null,
  items: ['a', 'b'],
  nested: { list: [{ name: 'first' }] },
}
const root: Frame = { base: '', value: model }

describe('parsePath', () => {
  it('splits dotted names and indices, trimming whitespace', () => {
    expect(parsePath(' company.name ', 's')).toEqual(['company', 'name'])
    expect(parsePath('items.0', 's')).toEqual(['items', '0'])
    expect(parsePath('.', 's')).toEqual([])
  })

  it('refuses an empty path and anything that is not names and indices', () => {
    expect(() => parsePath('', 's')).toThrow(RenderError)
    for (const bad of ['company..name', 'company[0]', 'a b', 'company.', '-x']) {
      expect(() => parsePath(bad, 's'), bad).toThrow(RenderError)
    }
  })
})

describe('Resolver', () => {
  it('walks own keys from the root and reports the absolute path', () => {
    const resolver = new Resolver('s')
    expect(resolver.resolve('company.name', [root])).toEqual({ path: 'company.name', value: 'Rila', nullAt: null })
    expect(resolver.resolve('nested.list.0.name', [root])).toEqual({ path: 'nested.list.0.name', value: 'first', nullAt: null })
  })

  it('throws a RenderError naming the full path and the section for a key that does not exist', () => {
    const resolver = new Resolver('summary')
    let error: unknown
    try {
      resolver.resolve('company.nmae', [root])
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(RenderError)
    const rendered = error as RenderError
    expect(rendered.sectionId).toBe('summary')
    expect(rendered.path).toBe('company.nmae')
    expect(rendered.message).toContain('"summary"')
    expect(rendered.message).toContain('company.nmae')
  })

  it('stops at the first null on the way and says where', () => {
    const resolver = new Resolver('s')
    expect(resolver.resolve('scope.estimate.price', [root])).toEqual({ path: 'scope.estimate.price', value: null, nullAt: 'scope' })
    expect(resolver.resolve('company.website', [root])).toEqual({ path: 'company.website', value: null, nullAt: null })
  })

  it('never reaches an inherited property', () => {
    const resolver = new Resolver('s')
    for (const path of ['constructor', '__proto__', 'company.constructor', 'company.name.length', 'items.map']) {
      expect(() => resolver.resolve(path, [root]), path).toThrow(RenderError)
    }
  })

  it('does not walk into a primitive', () => {
    const resolver = new Resolver('s')
    expect(() => resolver.resolve('company.name.first', [root])).toThrow(RenderError)
  })

  it('resolves against the innermost frame first and falls back to the root', () => {
    const resolver = new Resolver('s')
    const item: Frame = { base: 'nested.list.0', value: { name: 'first' } }
    expect(resolver.resolve('name', [root, item])).toEqual({ path: 'nested.list.0.name', value: 'first', nullAt: null })
    expect(resolver.resolve('company.name', [root, item])).toEqual({ path: 'company.name', value: 'Rila', nullAt: null })
    expect(() => resolver.resolve('missing', [root, item])).toThrow(RenderError)
  })

  it('resolves "." to the current item, keyed by its index, and refuses it outside a repeat', () => {
    const resolver = new Resolver('s')
    const item: Frame = { base: 'items.1', value: 'b' }
    expect(resolver.resolve('.', [root, item])).toEqual({ path: 'items.1', value: 'b', nullAt: null })
    expect(() => resolver.resolve('.', [root])).toThrow(RenderError)
  })

  it('records reads as plain data keyed by path', () => {
    const resolver = new Resolver('s')
    resolver.record('company.name', 'Rila')
    resolver.record('scope', false)
    resolver.record('items', 2)
    expect(resolver.inputs()).toEqual({ 'company.name': 'Rila', scope: false, items: 2 })
  })
})
