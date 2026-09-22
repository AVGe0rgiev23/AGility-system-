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
    expect(parseRoute('#/question-sets')).toEqual({ name: 'question-sets' })
    expect(parseRoute('#/question-sets/qs-teardown')).toEqual({ name: 'question-set', id: 'qs-teardown' })
    expect(parseRoute('#/patterns')).toEqual({ name: 'patterns' })
    expect(parseRoute('#/patterns/pat-email-triage')).toEqual({ name: 'pattern', id: 'pat-email-triage' })
  })

  it('parses an item inside an engagement tab, such as a discovery session', () => {
    expect(parseRoute('#/engagements/eng-1/discovery/ds-7')).toEqual({ name: 'engagement', id: 'eng-1', tab: 'discovery', item: 'ds-7' })
    expect(parseRoute('#/engagements/eng-1/discovery')).not.toHaveProperty('item')
    expect(parseRoute('#/engagements/eng-1/discovery/ds-7/extra')).toEqual({ name: 'not-found', path: '/engagements/eng-1/discovery/ds-7/extra' })
    expect(parseRoute('#/question-sets/qs-teardown/extra')).toEqual({ name: 'not-found', path: '/question-sets/qs-teardown/extra' })
    expect(parseRoute('#/patterns/pat-email-triage/extra')).toEqual({ name: 'not-found', path: '/patterns/pat-email-triage/extra' })
  })

  it('tolerates trailing and doubled slashes', () => {
    expect(parseRoute('#/settings/')).toEqual({ name: 'settings' })
    expect(parseRoute('#/engagements/eng-1/')).toEqual({ name: 'engagement', id: 'eng-1', tab: null })
    expect(parseRoute('#//engagements//eng-1')).toEqual({ name: 'engagement', id: 'eng-1', tab: null })
  })

  it('reports an unknown address as not found, keeping the path for display', () => {
    expect(parseRoute('#/pipeline')).toEqual({ name: 'not-found', path: '/pipeline' })
    expect(parseRoute('#/settings/extra')).toEqual({ name: 'not-found', path: '/settings/extra' })
    expect(parseRoute('#/engagements/eng-1/processes/p-1/extra')).toEqual({
      name: 'not-found',
      path: '/engagements/eng-1/processes/p-1/extra',
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

  it('writes an engagement with and without a tab, and an item only inside a tab', () => {
    expect(hrefFor({ name: 'engagement', id: 'eng-1', tab: null })).toBe('#/engagements/eng-1')
    expect(hrefFor({ name: 'engagement', id: 'eng-1', tab: 'scope' })).toBe('#/engagements/eng-1/scope')
    expect(hrefFor({ name: 'engagement', id: 'eng-1', tab: 'discovery', item: 'ds 7' })).toBe('#/engagements/eng-1/discovery/ds%207')
    expect(hrefFor({ name: 'engagement', id: 'eng-1', tab: null, item: 'ds-7' })).toBe('#/engagements/eng-1')
  })

  it('writes the question-set list and one question set', () => {
    expect(hrefFor({ name: 'question-sets' })).toBe('#/question-sets')
    expect(hrefFor({ name: 'question-set', id: 'qs/1' })).toBe('#/question-sets/qs%2F1')
    expect(parseRoute(hrefFor({ name: 'question-set', id: 'Солидна/?' }))).toEqual({ name: 'question-set', id: 'Солидна/?' })
  })

  it('writes the pattern list and one pattern', () => {
    expect(hrefFor({ name: 'patterns' })).toBe('#/patterns')
    expect(hrefFor({ name: 'pattern', id: 'pat/1' })).toBe('#/patterns/pat%2F1')
    expect(parseRoute(hrefFor({ name: 'pattern', id: 'Солидна/?' }))).toEqual({ name: 'pattern', id: 'Солидна/?' })
  })

  it('round-trips ids that contain separators, escapes, spaces and non-ASCII text', () => {
    const ids = ['eng/1', '100%', 'a b', 'Солидна ООД', '#?&=', '%E0%A4%A', '..']
    for (const id of ids) {
      for (const tab of [null, 'discovery', 'a/b']) {
        const route: RouteTarget = { name: 'engagement', id, tab }
        expect(parseRoute(hrefFor(route)), `${id} ${String(tab)}`).toEqual(route)
        if (tab !== null) {
          const withItem: RouteTarget = { name: 'engagement', id, tab, item: id }
          expect(parseRoute(hrefFor(withItem)), `${id} ${tab} item`).toEqual(withItem)
        }
      }
    }
  })
})
