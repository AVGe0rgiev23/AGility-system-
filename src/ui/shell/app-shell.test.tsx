import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CURRENT_SCHEMA_VERSION } from '../../schema/version'
import { AppShell, folderLabel } from './app-shell'
import type { Route } from './router'

function shell(route: Route): string {
  return renderToStaticMarkup(
    <AppShell route={route} sync={{ kind: 'disconnected' }} notices={<div>NOTICES</div>}>
      <p>PAGE</p>
    </AppShell>,
  )
}

describe('AppShell', () => {
  it('links every screen by its hash address', () => {
    const html = shell({ name: 'settings' })
    expect(html).toContain('href="#/engagements"')
    expect(html).toContain('href="#/settings"')
    expect(html).toContain('href="#/primitives"')
    expect(html).toContain('href="#/question-sets"')
    expect(html).toContain('href="#/patterns"')
  })

  it('counts a question set as the question-set list', () => {
    const editor = shell({ name: 'question-set', id: 'qs-teardown' })
    expect(editor.match(/aria-current="page"/g)).toHaveLength(1)
    expect(editor).toMatch(/href="#\/question-sets" aria-current="page"/)
  })

  it('counts a pattern as the pattern list', () => {
    const editor = shell({ name: 'pattern', id: 'pat-email-triage' })
    expect(editor.match(/aria-current="page"/g)).toHaveLength(1)
    expect(editor).toMatch(/href="#\/patterns" aria-current="page"/)
  })

  it('marks exactly the current screen, counting engagement detail as the engagement list', () => {
    const detail = shell({ name: 'engagement', id: 'eng-1', tab: null })
    expect(detail.match(/aria-current="page"/g)).toHaveLength(1)
    expect(detail).toMatch(/href="#\/engagements" aria-current="page"/)

    const notFound = shell({ name: 'not-found', path: '/nowhere' })
    expect(notFound).not.toContain('aria-current')
  })

  it('reads the schema version from the schema, never a hardcoded number', () => {
    expect(shell({ name: 'engagements' })).toContain(`>schema v${CURRENT_SCHEMA_VERSION}<`)
  })

  it('renders the notices above the page', () => {
    const html = shell({ name: 'engagements' })
    expect(html.indexOf('NOTICES')).toBeGreaterThan(-1)
    expect(html.indexOf('NOTICES')).toBeLessThan(html.indexOf('PAGE'))
  })
})

describe('folderLabel', () => {
  it('names every sync state in a few words', () => {
    expect(folderLabel(null)).toBe('not loaded')
    expect(folderLabel({ kind: 'unsupported' })).toBe('unsupported')
    expect(folderLabel({ kind: 'disconnected' })).toBe('not connected')
    expect(folderLabel({ kind: 'needs-permission', folderName: 'data' })).toBe('data (needs permission)')
    expect(folderLabel({ kind: 'error', folderName: 'data', message: 'x', staleFolders: [] })).toBe('data (failing)')
    expect(folderLabel({ kind: 'connected', folderName: 'data', lastSyncAt: null, staleFolders: [] })).toBe('data')
  })
})
