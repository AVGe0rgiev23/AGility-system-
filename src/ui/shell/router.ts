import { useMemo, useSyncExternalStore } from 'react'

// Every screen is addressed by the URL hash, so a refresh, a bookmark or the back button returns
// to it. A hash needs no server rewrite rules, which keeps the bundle static.

export type Route =
  | { name: 'engagements' }
  // item names one record inside the tab, such as a discovery session.
  | { name: 'engagement'; id: string; tab: string | null; item?: string }
  | { name: 'question-sets' }
  | { name: 'question-set'; id: string }
  | { name: 'patterns' }
  | { name: 'pattern'; id: string }
  | { name: 'settings' }
  | { name: 'primitives' }
  | { name: 'not-found'; path: string }

export type RouteTarget = Exclude<Route, { name: 'not-found' }>

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '')
  const notFound: Route = { name: 'not-found', path }
  let segments: string[]
  try {
    segments = path.split('/').filter((segment) => segment !== '').map(decodeURIComponent)
  } catch {
    // A malformed percent-escape, typed or pasted by hand, is an address like any other unknown one.
    return notFound
  }
  const [head, id, tab, item, ...rest] = segments
  if (head === undefined) return { name: 'engagements' }
  if (head === 'engagements' && rest.length === 0) {
    if (id === undefined) return { name: 'engagements' }
    return item === undefined ? { name: 'engagement', id, tab: tab ?? null } : { name: 'engagement', id, tab: tab ?? null, item }
  }
  if (head === 'question-sets' && tab === undefined) {
    return id === undefined ? { name: 'question-sets' } : { name: 'question-set', id }
  }
  if (head === 'patterns' && tab === undefined) {
    return id === undefined ? { name: 'patterns' } : { name: 'pattern', id }
  }
  if (id !== undefined) return notFound
  if (head === 'settings') return { name: 'settings' }
  if (head === 'primitives') return { name: 'primitives' }
  return notFound
}

export function hrefFor(route: RouteTarget): string {
  if (route.name === 'question-set') return `#/question-sets/${encodeURIComponent(route.id)}`
  if (route.name === 'pattern') return `#/patterns/${encodeURIComponent(route.id)}`
  if (route.name !== 'engagement') return `#/${route.name}`
  // An item lives inside a tab, so it is written only with one.
  const segments = route.tab === null ? [route.id] : route.item === undefined ? [route.id, route.tab] : [route.id, route.tab, route.item]
  return `#/engagements/${segments.map(encodeURIComponent).join('/')}`
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash)
  return useMemo(() => parseRoute(hash), [hash])
}

export function navigate(target: RouteTarget): void {
  window.location.hash = hrefFor(target)
}
