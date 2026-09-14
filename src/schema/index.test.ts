import { describe, expect, it } from 'vitest'
import * as barrel from './index'

// Globbed rather than listed, so a new schema module left out of index.ts fails here.
const modules = import.meta.glob<Record<string, unknown>>(['./*.ts', '!./*.test.ts', '!./index.ts'], {
  eager: true,
})

describe('schema barrel', () => {
  it('finds the schema modules', () => {
    expect(Object.keys(modules).length).toBeGreaterThanOrEqual(15)
  })

  it('re-exports every export of every schema module, unchanged', () => {
    const exported: Record<string, unknown> = barrel
    for (const [path, module] of Object.entries(modules)) {
      for (const [name, value] of Object.entries(module)) {
        expect(exported[name], `${name} from ${path}`).toBe(value)
      }
    }
  })
})
