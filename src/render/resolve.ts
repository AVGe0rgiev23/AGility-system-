import type { RenderScalar } from '../schema/scope'

// Path resolution against a view model, recording every value it hands out. A section's
// inputsHash is computed over exactly these reads, keyed by absolute path, so an edit to a
// field a section never read can never put it into conflict, and an edit to one it did read
// always does. Resolution never returns an empty string for a path it cannot find: a missing
// key is a typo in the template and is reported with the full path and the section.

export class RenderError extends Error {
  override readonly name = 'RenderError'
  readonly sectionId: string
  readonly path: string

  constructor(message: string, sectionId: string, path: string) {
    super(`Section "${sectionId}": ${message}`)
    this.sectionId = sectionId
    this.path = path
  }
}

const SEGMENT = /^(?:[A-Za-z_$][A-Za-z0-9_$]*|\d+)$/

// The current repeat item is spelled '.', as in mustache, and parses to no segments.
export function parsePath(expression: string, sectionId: string): string[] {
  const trimmed = expression.trim()
  if (trimmed === '.') return []
  if (trimmed === '') throw new RenderError('an empty path has nothing to resolve', sectionId, expression)
  const segments = trimmed.split('.')
  for (const segment of segments) {
    if (!SEGMENT.test(segment)) {
      throw new RenderError(`path "${trimmed}" is not a dotted path of names and indices`, sectionId, trimmed)
    }
  }
  return segments
}

// A context to resolve against: the root model, or one repeated item with its absolute base path.
export interface Frame {
  base: string
  value: unknown
}

export interface Resolved {
  // Absolute path from the root of the model, so reads inside a repeat are keyed by index.
  path: string
  value: unknown
  // The absolute path of the first null met on the way, when the walk stopped early there.
  nullAt: string | null
}

function join(base: string, segments: string[]): string {
  return [base, ...segments].filter((part) => part !== '').join('.')
}

function hasOwnKey(value: unknown, key: string): value is Record<string, unknown> {
  // Own keys only, so a path such as "constructor" or "__proto__" cannot reach an inherited property.
  return typeof value === 'object' && value !== null && Object.hasOwn(value, key)
}

function isScalar(value: unknown): value is RenderScalar {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

export class Resolver {
  readonly reads = new Map<string, RenderScalar>()
  private readonly sectionId: string

  constructor(sectionId: string) {
    this.sectionId = sectionId
  }

  // Frames are searched innermost first; a name the item frame lacks falls back to the root,
  // as in mustache. Only the frame that holds the first segment is walked.
  resolve(expression: string, frames: Frame[]): Resolved {
    const segments = parsePath(expression, this.sectionId)
    const innermost = frames[frames.length - 1]
    if (innermost === undefined) throw new RenderError('nothing to resolve against', this.sectionId, expression)
    if (segments.length === 0) {
      if (frames.length < 2) {
        throw new RenderError('"." names the current item, and this section has no repeatOver', this.sectionId, '.')
      }
      return { path: innermost.base, value: innermost.value, nullAt: null }
    }
    const [first] = segments
    if (first === undefined) throw new RenderError('an empty path has nothing to resolve', this.sectionId, expression)
    const frame = [...frames].reverse().find((candidate) => hasOwnKey(candidate.value, first)) ?? frames[0]
    if (frame === undefined) throw new RenderError('nothing to resolve against', this.sectionId, expression)
    return this.walk(frame, segments)
  }

  // Records a scalar read so it becomes part of the section's inputs.
  record(path: string, value: RenderScalar): void {
    this.reads.set(path, value)
  }

  inputs(): Record<string, RenderScalar> {
    return Object.fromEntries(this.reads)
  }

  private walk(frame: Frame, segments: string[]): Resolved {
    let current: unknown = frame.value
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]
      if (segment === undefined) break
      const soFar = join(frame.base, segments.slice(0, i))
      if (current === null) return { path: join(frame.base, segments), value: null, nullAt: soFar }
      if (!hasOwnKey(current, segment)) {
        const full = join(frame.base, segments)
        throw new RenderError(
          `path "${full}" does not exist in the view model (no key "${segment}" at "${soFar === '' ? 'root' : soFar}")`,
          this.sectionId,
          full,
        )
      }
      current = current[segment]
      if (current === undefined) {
        const full = join(frame.base, segments)
        throw new RenderError(`path "${full}" does not exist in the view model`, this.sectionId, full)
      }
    }
    return { path: join(frame.base, segments), value: current, nullAt: null }
  }
}

export { isScalar }
