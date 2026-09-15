import { useMemo, useSyncExternalStore } from 'react'

// Every screen is addressed by the URL hash, so a refresh, a bookmark or the back button returns
// to it. A hash needs no server rewrite rules, which keeps the bundle static.

export type Route =
  | { name: 'engagements' }
  | { name: 'engagement'; id: string; tab: string | null }
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
  const [head, id, tab, ...rest] = segments
  if (head === undefined) return { name: 'engagements' }
  if (head === 'engagements' && rest.length === 0) {
    return id === undefined ? { name: 'engagements' } : { name: 'engagement', id, tab: tab ?? null }
  }
  if (id !== undefined) return notFound
  if (head === 'settings') return { name: 'settings' }
  if (head === 'primitives') return { name: 'primitives' }
  return notFound
}

export function hrefFor(route: RouteTarget): string {
  if (route.name !== 'engagement') return `#/${route.name}`
  const segments = route.tab === null ? [route.id] : [route.id, route.tab]
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
