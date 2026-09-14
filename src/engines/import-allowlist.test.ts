import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// Lint only bans the layers and globals it names, so an engine could still import a new
// package or a utils folder and pass. This test is the allowlist behind it: an engine
// module may import other engine files and schema/, nothing else.
const engineSources = import.meta.glob<string>(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}'], {
  eager: true,
  query: '?raw',
  import: 'default',
})

function isInside(path: string, directory: string): boolean {
  return path === directory || path.startsWith(`${directory}/`)
}

// TypeScript's own scanner, so type-only, re-exported, multi-line and dynamic imports all count,
// and specifiers inside comments or strings do not.
function disallowedImports(file: string, source: string): string[] {
  const base = new URL(file, 'file:///src/engines/')
  return ts
    .preProcessFile(source, true, true)
    .importedFiles.map((reference) => reference.fileName)
    .filter((specifier) => {
      if (!specifier.startsWith('./') && !specifier.startsWith('../')) return true
      const resolved = new URL(specifier, base).pathname
      return !isInside(resolved, '/src/engines') && !isInside(resolved, '/src/schema')
    })
}

describe('engines import allowlist', () => {
  it('flags every import that leaves engines/ and schema/', () => {
    const source = [
      "import type { Opportunity } from '../schema/opportunity'",
      "import { CurrencySchema } from '../schema'",
      "import 'lodash'",
      "import { roi } from './roi'",
      "import { round,",
      "  floor } from '../utils/math'",
      "const lazy = import('zod')",
      "export * from './calibration'",
      "export { db } from '../storage/db'",
      "import pkg from '../../package.json'",
      "// import 'commented-out'",
      'const text = "import \'in-a-string\'"',
    ].join('\n')
    expect(disallowedImports('./scoring.ts', source).sort()).toEqual(
      ['lodash', '../utils/math', 'zod', '../storage/db', '../../package.json'].sort(),
    )
  })

  it('resolves specifiers from nested engine folders', () => {
    const source = [
      "import { roi } from '../roi'",
      "import { CurrencySchema } from '../../schema/traced'",
      "import { useConfig } from '../../hooks/useConfig'",
    ].join('\n')
    expect(disallowedImports('./nested/helper.ts', source)).toEqual(['../../hooks/useConfig'])
  })

  it('holds for every engine module', () => {
    for (const [file, source] of Object.entries(engineSources)) {
      expect(disallowedImports(file, source), file).toEqual([])
    }
  })
})
