import type { z } from 'zod'
import { parseNumberText, VALUE_REQUIRED } from './use-traced-draft'

// What the path-addressed forms (Settings, the engagement detail) share. A field is addressed by its
// dotted path, e.g. 'pricing.bands.1.floor' or 'contacts.0.email': the same string the schema reports
// an issue at, so every issue lands at the control that fixes it.

export interface FormIssue {
  path: string
  message: string
}

export function valueAt(root: unknown, path: string): unknown {
  let current = root
  for (const segment of path.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function replaceSegments(container: unknown, segments: readonly string[], next: unknown): unknown {
  const [head, ...rest] = segments
  if (head === undefined) return next
  if (Array.isArray(container)) {
    const copy: unknown[] = [...(container as unknown[])]
    copy[Number(head)] = replaceSegments(copy[Number(head)], rest, next)
    return copy
  }
  const copy: Record<string, unknown> = { ...(container as Record<string, unknown>) }
  const value = replaceSegments(copy[head], rest, next)
  if (value === undefined) delete copy[head]
  else copy[head] = value
  return copy
}

// A copy with the value at the path replaced, or its key removed when `next` is undefined. The caller
// checks first that it replaces a value of the type already there, so the copy keeps the root's type.
export function replaceAt(root: unknown, path: string, next: unknown): unknown {
  return replaceSegments(root, path.split('.'), next)
}

export function leafPaths(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return prefix === '' ? [] : [prefix]
  const entries: [string, unknown][] = Array.isArray(value)
    ? (value as unknown[]).map((item, index) => [String(index), item])
    : Object.entries(value as Record<string, unknown>)
  return entries.flatMap(([key, item]) => leafPaths(item, prefix === '' ? key : `${prefix}.${key}`))
}

export function issuesByPath(issues: readonly FormIssue[]): ReadonlyMap<string, string[]> {
  const byPath = new Map<string, string[]>()
  for (const { path, message } of issues) byPath.set(path, [...(byPath.get(path) ?? []), message])
  return byPath
}

export function schemaIssues(error: z.ZodError | undefined): FormIssue[] {
  return error === undefined ? [] : error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message }))
}

// Issues in typed number text that never reached the draft: text that does not parse, and empty text
// where the field has no empty meaning.
export function textIssues(texts: Readonly<Record<string, string>>, emptyAllowed: (path: string) => boolean): FormIssue[] {
  return Object.entries(texts).flatMap(([path, text]) => {
    const parsed = parseNumberText(text)
    if (parsed.kind === 'invalid') return [{ path, message: parsed.message }]
    if (parsed.kind === 'empty' && !emptyAllowed(path)) return [{ path, message: VALUE_REQUIRED }]
    return []
  })
}

// At a field whose text does not parse, the schema would be judging the last number that did, not
// what is on screen, so only the text's own issue is kept there.
export function withTextIssuesFirst(typed: readonly FormIssue[], schema: readonly FormIssue[]): FormIssue[] {
  const typedPaths = new Set(typed.map((issue) => issue.path))
  return [...typed, ...schema.filter((issue) => !typedPaths.has(issue.path))]
}

export function numberWarnings(text: string): string[] {
  const parsed = parseNumberText(text)
  return parsed.kind === 'number' && parsed.warning !== null ? [parsed.warning] : []
}

// Adding, removing or moving an item shifts the indices under a list, so any typed text there would
// land on the wrong item. It is dropped, and each field shows its item's value again.
export function withoutTextsUnder(texts: Readonly<Record<string, string>>, prefix: string): Record<string, string> {
  return Object.fromEntries(Object.entries(texts).filter(([path]) => !path.startsWith(`${prefix}.`)))
}

export function moved<T>(items: readonly T[], index: number, offset: -1 | 1): T[] {
  const target = index + offset
  const copy = [...items]
  const [item] = copy.splice(index, 1)
  if (item === undefined || target < 0 || target > items.length - 1) return [...items]
  copy.splice(target, 0, item)
  return copy
}
