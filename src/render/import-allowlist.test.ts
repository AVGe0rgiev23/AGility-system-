import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// Lint only bans the layers and globals it names. This is the allowlist behind it: a render
// module may import other render files, engines/ and schema/, nothing else. The same technique
// as src/engines/import-allowlist.test.ts, with engines/ added to the allowed set.
const renderSources = import.meta.glob<string>(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}'], {
  eager: true,
  query: '?raw',
  import: 'default',
})

function isInside(path: string, directory: string): boolean {
  return path === directory || path.startsWith(`${directory}/`)
}

function disallowedImports(file: string, source: string): string[] {
  const base = new URL(file, 'file:///src/render/')
  return ts
    .preProcessFile(source, true, true)
    .importedFiles.map((reference) => reference.fileName)
    .filter((specifier) => {
      if (!specifier.startsWith('./') && !specifier.startsWith('../')) return true
      const resolved = new URL(specifier, base).pathname
      return (
        !isInside(resolved, '/src/render') && !isInside(resolved, '/src/engines') && !isInside(resolved, '/src/schema')
      )
    })
}

describe('render import allowlist', () => {
  it('flags every import that leaves render/, engines/ and schema/', () => {
    const source = [
      "import { hashInputs } from '../engines/inputs-hash'",
      "import type { Engagement } from '../schema/engagement'",
      "import { text } from './nodes'",
      "import { load } from '../storage/repository'",
      "import { useEngagement } from '../hooks/useEngagement'",
      "import React from 'react'",
    ].join('\n')
    expect(disallowedImports('./template.ts', source).sort()).toEqual(
      ['../storage/repository', '../hooks/useEngagement', 'react'].sort(),
    )
  })

  it('holds for every render module', () => {
    for (const [file, source] of Object.entries(renderSources)) {
      expect(disallowedImports(file, source), file).toEqual([])
    }
  })
})
