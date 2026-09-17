import type { ReactNode } from 'react'
import { CURRENT_SCHEMA_VERSION } from '../../schema/version'
import type { SyncStatus } from '../../storage/sync'
import { hrefFor, type Route, type RouteTarget } from './router'

interface NavItem {
  label: string
  target: RouteTarget
}

const MAIN_NAV: readonly NavItem[] = [
  { label: 'Engagements', target: { name: 'engagements' } },
  { label: 'Question sets', target: { name: 'question-sets' } },
  { label: 'Settings', target: { name: 'settings' } },
]

const REFERENCE_NAV: readonly NavItem[] = [{ label: 'Primitives', target: { name: 'primitives' } }]

function isActive(route: Route, target: RouteTarget): boolean {
  if (target.name === 'engagements') return route.name === 'engagements' || route.name === 'engagement'
  if (target.name === 'question-sets') return route.name === 'question-sets' || route.name === 'question-set'
  return route.name === target.name
}

// The footer's one-line folder state. The banner carries the full text for anything unhealthy.
export function folderLabel(sync: SyncStatus | null): string {
  if (sync === null) return 'not loaded'
  switch (sync.kind) {
    case 'unsupported':
      return 'unsupported'
    case 'disconnected':
      return 'not connected'
    case 'needs-permission':
      return `${sync.folderName} (needs permission)`
    case 'error':
      return `${sync.folderName} (failing)`
    case 'connected':
      return sync.folderName
  }
}

function NavList({ route, items }: { route: Route; items: readonly NavItem[] }) {
  return (
    <ul>
      {items.map((item) => {
        const active = isActive(route, item.target)
        return (
          <li key={item.label}>
            <a
              href={hrefFor(item.target)}
              aria-current={active ? 'page' : undefined}
              className={`block h-7 border-l-2 px-3 text-sm leading-7 transition-colors ${
                active ? 'border-accent bg-bg text-fg' : 'border-transparent text-muted hover:text-fg'
              }`}
            >
              {item.label}
            </a>
          </li>
        )
      })}
    </ul>
  )
}

export interface AppShellProps {
  route: Route
  // Null until the store has loaded.
  sync: SyncStatus | null
  notices: ReactNode
  children: ReactNode
}

export function AppShell({ route, sync, notices, children }: AppShellProps) {
  return (
    <div className="flex min-h-screen">
      <nav aria-label="Main" className="flex w-44 shrink-0 flex-col border-r bg-surface">
        <div className="flex h-10 items-center border-b px-3">
          <span className="num text-sm font-semibold">AGility OS</span>
        </div>
        <div className="py-2">
          <NavList route={route} items={MAIN_NAV} />
        </div>
        <div className="px-3 pt-2 pb-1 text-xs text-muted">Reference</div>
        <NavList route={route} items={REFERENCE_NAV} />
        <div className="mt-auto border-t px-3 py-2 text-xs text-muted">
          <div className="num">schema v{CURRENT_SCHEMA_VERSION}</div>
          <div className="truncate" title={`Folder: ${folderLabel(sync)}`}>
            folder: <span className="num">{folderLabel(sync)}</span>
          </div>
        </div>
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        {notices}
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  )
}
