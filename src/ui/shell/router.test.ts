import { describe, expect, it } from 'vitest'
import { hrefFor, parseRoute, type RouteTarget } from './router'

describe('parseRoute', () => {
  it('treats an empty hash as the engagement list', () => {
    for (const hash of ['', '#', '#/', '#//']) {
      expect(parseRoute(hash), hash).toEqual({ name: 'engagements' })
    }
  })

  it('parses every route', () => {
    expect(parseRoute('#/engagements')).toEqual({ name: 'engagements' })
    expect(parseRoute('#/engagements/eng-1')).toEqual({ name: 'engagement', id: 'eng-1', tab: null })
    expect(parseRoute('#/engagements/eng-1/processes')).toEqual({ name: 'engagement', id: 'eng-1', tab: 'processes' })
    expect(parseRoute('#/settings')).toEqual({ name: 'settings' })
    expect(parseRoute('#/primitives')).toEqual({ name: 'primitives' })
  })

  it('tolerates trailing and doubled slashes', () => {
    expect(parseRoute('#/settings/')).toEqual({ name: 'settings' })
    expect(parseRoute('#/engagements/eng-1/')).toEqual({ name: 'engagement', id: 'eng-1', tab: null })
    expect(parseRoute('#//engagements//eng-1')).toEqual({ name: 'engagement', id: 'eng-1', tab: null })
  })

  it('reports an unknown address as not found, keeping the path for display', () => {
    expect(parseRoute('#/pipeline')).toEqual({ name: 'not-found', path: '/pipeline' })
    expect(parseRoute('#/settings/extra')).toEqual({ name: 'not-found', path: '/settings/extra' })
    expect(parseRoute('#/engagements/eng-1/processes/extra')).toEqual({
      name: 'not-found',
      path: '/engagements/eng-1/processes/extra',
    })
  })

  it('reports a malformed percent-escape as not found instead of throwing', () => {
    expect(parseRoute('#/engagements/%E0%A4%A')).toEqual({ name: 'not-found', path: '/engagements/%E0%A4%A' })
    expect(parseRoute('#/%')).toEqual({ name: 'not-found', path: '/%' })
  })
})

describe('hrefFor', () => {
  it('writes plain routes as their name', () => {
    expect(hrefFor({ name: 'engagements' })).toBe('#/engagements')
    expect(hrefFor({ name: 'settings' })).toBe('#/settings')
    expect(hrefFor({ name: 'primitives' })).toBe('#/primitives')
  })

  it('writes an engagement with and without a tab', () => {
    expect(hrefFor({ name: 'engagement', id: 'eng-1', tab: null })).toBe('#/engagements/eng-1')
    expect(hrefFor({ name: 'engagement', id: 'eng-1', tab: 'scope' })).toBe('#/engagements/eng-1/scope')
  })

  it('round-trips ids that contain separators, escapes, spaces and non-ASCII text', () => {
    const ids = ['eng/1', '100%', 'a b', 'Солидна ООД', '#?&=', '%E0%A4%A', '..']
    for (const id of ids) {
      for (const tab of [null, 'discovery', 'a/b']) {
        const route: RouteTarget = { name: 'engagement', id, tab }
        expect(parseRoute(hrefFor(route)), `${id} ${String(tab)}`).toEqual(route)
      }
    }
  })
})
