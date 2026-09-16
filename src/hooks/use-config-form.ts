import { useState } from 'react'
import { canonicalJson } from '../engines/inputs-hash'
import { ConfigSchema, defaultConfig, type Config } from '../schema/config'
import type { RunCostLineItem } from '../schema/run-cost'
import { parseNumberText, VALUE_REQUIRED } from './use-traced-draft'

// The editing model behind the Settings screen, as pure functions like use-traced-draft, so it can be
// tested without a DOM.
//
// - Every field is addressed by its path, e.g. 'pricing.bands.1.floor'. The same string is the
//   control's data-config-path and the path ConfigSchema reports an issue at, so an issue always
//   lands at the control that can fix it.
// - Number fields keep the text as typed. Text that does not parse never reaches the draft, so the
//   draft always has valid types and ConfigSchema's consistency rules always run on it.
// - Nothing here repeats a rule. ConfigSchema owns them; this only places their messages.

export interface ConfigIssue {
  path: string
  message: string
}

export interface ConfigFormState {
  // The Config as stored, or null when the stored record does not validate.
  saved: Config | null
  // Null only while the stored Config is unusable and nobody has chosen to start from defaults.
  draft: Config | null
  // Number fields typed into since the form was last reset, as typed, by path.
  texts: Readonly<Record<string, string>>
}

// Leaves that no control may change, each with the reason shown beside it.
export const READ_ONLY_PATHS: Readonly<Record<string, string>> = {
  agencyCurrency: 'All engine math happens in EUR; the schema allows no other agency currency.',
  'fxRates.rates.EUR': 'EUR is the agency currency, so its rate is exactly 1.',
  'storage.syncFolderHandleId': 'Set by connecting and disconnecting a folder.',
  'storage.lastSyncAt': 'Set by the folder mirror each time it writes.',
}

// Where a rule about a whole list reports, e.g. 'Exactly one band must have no max hours'.
export const LIST_PATHS: readonly string[] = ['industries', 'pricing.bands', 'runCostDefaults']

const NULLABLE_NUMBER = /^(pricing\.bands\.\d+\.(maxHours|floor|ceiling)|runCostDefaults\.\d+\.monthlyCost)$/
// Optional text: clearing it removes the key rather than storing an empty string.
const OPTIONAL_TEXT = /^(agency\.vatId|runCostDefaults\.\d+\.notes)$/
const FORMULA_KEYS = ['callsPerMonth', 'avgInputTokens', 'avgOutputTokens', 'inputPricePerMTok', 'outputPricePerMTok'] as const

export function initialConfigForm(saved: Config | null): ConfigFormState {
  return { saved, draft: saved, texts: {} }
}

// Only fills the draft. Nothing is written until Save.
export function startFromDefaults(state: ConfigFormState): ConfigFormState {
  return { ...state, draft: defaultConfig(), texts: {} }
}

export function discardChanges(state: ConfigFormState): ConfigFormState {
  return initialConfigForm(state.saved)
}

function segmentsOf(path: string): string[] {
  return path.split('.')
}

export function valueAt(config: Config, path: string): unknown {
  let current: unknown = config
  for (const segment of segmentsOf(path)) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

// A copy with one value replaced, or with its key removed when `next` is undefined.
function replaceAt(container: unknown, segments: readonly string[], next: unknown): unknown {
  const [head, ...rest] = segments
  if (head === undefined) return next
  if (Array.isArray(container)) {
    const copy: unknown[] = [...(container as unknown[])]
    copy[Number(head)] = replaceAt(copy[Number(head)], rest, next)
    return copy
  }
  const copy: Record<string, unknown> = { ...(container as Record<string, unknown>) }
  const value = replaceAt(copy[head], rest, next)
  if (value === undefined) delete copy[head]
  else copy[head] = value
  return copy
}

function replaceIn(config: Config, path: string, next: unknown): Config {
  // Every caller checks first that it replaces a value of the same type as the one already at the
  // path, so the result is still a Config.
  return replaceAt(config, segmentsOf(path), next) as Config
}

function writable(path: string): void {
  if (path in READ_ONLY_PATHS) throw new Error(`'${path}' is read-only in Settings`)
}

export function numberText(state: ConfigFormState, path: string): string {
  const typed = state.texts[path]
  if (typed !== undefined) return typed
  const value = state.draft === null ? undefined : valueAt(state.draft, path)
  return typeof value === 'number' ? String(value) : ''
}

// The number the field's text reads as now, or null while it is empty or does not parse.
export function numberReading(state: ConfigFormState, path: string): number | null {
  const parsed = parseNumberText(numberText(state, path))
  return parsed.kind === 'number' ? parsed.value : null
}

export function setNumberText(state: ConfigFormState, path: string, text: string): ConfigFormState {
  if (state.draft === null) return state
  writable(path)
  const nullable = NULLABLE_NUMBER.test(path)
  const current = valueAt(state.draft, path)
  if (!(typeof current === 'number' || (nullable && current === null))) throw new Error(`There is no number field at '${path}'`)
  const texts = { ...state.texts, [path]: text }
  const parsed = parseNumberText(text)
  if (parsed.kind === 'number') return { ...state, draft: replaceIn(state.draft, path, parsed.value), texts }
  // Empty is the stored meaning of 'no limit' or 'no price' on a band and of no monthly cost on a
  // run-cost item, and nothing else. Where null is not allowed, the schema says so at the field.
  if (parsed.kind === 'empty' && nullable) return { ...state, draft: replaceIn(state.draft, path, null), texts }
  return { ...state, texts }
}

export function setText(state: ConfigFormState, path: string, text: string): ConfigFormState {
  if (state.draft === null) return state
  writable(path)
  const current = valueAt(state.draft, path)
  const optional = OPTIONAL_TEXT.test(path)
  if (!(typeof current === 'string' || (optional && current === undefined))) throw new Error(`There is no text field at '${path}'`)
  return { ...state, draft: replaceIn(state.draft, path, optional && text === '' ? undefined : text) }
}

// For a select. The caller passes one of the schema's options; anything else fails validation at its path.
export const setChoice = setText

export function setFlag(state: ConfigFormState, path: string, on: boolean): ConfigFormState {
  if (state.draft === null) return state
  writable(path)
  if (typeof valueAt(state.draft, path) !== 'boolean') throw new Error(`There is no flag at '${path}'`)
  return { ...state, draft: replaceIn(state.draft, path, on) }
}

// ---- Lists ----------------------------------------------------------------------------------------

// Adding, removing or moving an item shifts the indices under the list, so any typed text there
// would land on the wrong item. It is dropped, and each field shows its item's value again.
function withoutTextsUnder(texts: Readonly<Record<string, string>>, prefix: string): Record<string, string> {
  return Object.fromEntries(Object.entries(texts).filter(([path]) => !path.startsWith(`${prefix}.`)))
}

function moved<T>(items: readonly T[], index: number, offset: -1 | 1): T[] {
  const target = index + offset
  const copy = [...items]
  const [item] = copy.splice(index, 1)
  if (item === undefined || target < 0 || target > items.length - 1) return [...items]
  copy.splice(target, 0, item)
  return copy
}

function editList(state: ConfigFormState, listPath: string, edit: (draft: Config) => Config): ConfigFormState {
  if (state.draft === null) return state
  return { ...state, draft: edit(state.draft), texts: withoutTextsUnder(state.texts, listPath) }
}

function withBands(draft: Config, bands: Config['pricing']['bands']): Config {
  return { ...draft, pricing: { ...draft.pricing, bands } }
}

// A new band starts empty, so it reads as a second unbounded band until its max hours are typed, and
// the band rules say so. It goes before a trailing unbounded band, where a priced band belongs.
export function addBand(state: ConfigFormState): ConfigFormState {
  return editList(state, 'pricing.bands', (draft) => {
    const bands = draft.pricing.bands
    const at = bands.at(-1)?.maxHours === null ? bands.length - 1 : bands.length
    const band = { id: '', name: '', maxHours: null, floor: null, ceiling: null }
    return withBands(draft, [...bands.slice(0, at), band, ...bands.slice(at)])
  })
}

export function removeBand(state: ConfigFormState, index: number): ConfigFormState {
  return editList(state, 'pricing.bands', (draft) => withBands(draft, draft.pricing.bands.filter((_, at) => at !== index)))
}

export function moveBand(state: ConfigFormState, index: number, offset: -1 | 1): ConfigFormState {
  return editList(state, 'pricing.bands', (draft) => withBands(draft, moved(draft.pricing.bands, index, offset)))
}

export function addIndustry(state: ConfigFormState): ConfigFormState {
  return editList(state, 'industries', (draft) => ({ ...draft, industries: [...draft.industries, ''] }))
}

export function removeIndustry(state: ConfigFormState, index: number): ConfigFormState {
  return editList(state, 'industries', (draft) => ({ ...draft, industries: draft.industries.filter((_, at) => at !== index) }))
}

export function moveIndustry(state: ConfigFormState, index: number, offset: -1 | 1): ConfigFormState {
  return editList(state, 'industries', (draft) => ({ ...draft, industries: moved(draft.industries, index, offset) }))
}

// The monthly cost starts empty, never a silent zero: the schema refuses it until a cost is typed or
// the item is made usage-based. Who pays follows each delivery model's meaning and is shown on the
// row to change.
export function addRunCostItem(state: ConfigFormState, id: string): ConfigFormState {
  return editList(state, 'runCostDefaults', (draft) => {
    const item: RunCostLineItem = {
      id,
      label: '',
      category: 'other',
      monthlyCost: null,
      paidBy: { 'fully-managed': 'agency', 'client-owned': 'client', hybrid: 'client' },
      usageBased: false,
    }
    return { ...draft, runCostDefaults: [...draft.runCostDefaults, item] }
  })
}

export function removeRunCostItem(state: ConfigFormState, index: number): ConfigFormState {
  return editList(state, 'runCostDefaults', (draft) => ({ ...draft, runCostDefaults: draft.runCostDefaults.filter((_, at) => at !== index) }))
}

export function moveRunCostItem(state: ConfigFormState, index: number, offset: -1 | 1): ConfigFormState {
  return editList(state, 'runCostDefaults', (draft) => ({ ...draft, runCostDefaults: moved(draft.runCostDefaults, index, offset) }))
}

// Turning usage pricing on adds a formula whose five fields start as empty text: each is a blocking
// 'value required', never a silent zero. Turning it off removes the formula, which the run-cost
// engine ignores on an item that is not usage-based.
export function setUsageBased(state: ConfigFormState, index: number, on: boolean): ConfigFormState {
  const item = state.draft?.runCostDefaults[index]
  if (state.draft === null || item === undefined) return state
  const formulaPath = `runCostDefaults.${index}.usageFormula`
  const texts = withoutTextsUnder(state.texts, formulaPath)
  let next: RunCostLineItem
  if (!on) {
    const { usageFormula: _removed, ...rest } = item
    next = { ...rest, usageBased: false }
  } else if (item.usageFormula === undefined) {
    next = { ...item, usageBased: true, usageFormula: { callsPerMonth: 0, avgInputTokens: 0, avgOutputTokens: 0, inputPricePerMTok: 0, outputPricePerMTok: 0 } }
    for (const key of FORMULA_KEYS) texts[`${formulaPath}.${key}`] = ''
  } else {
    next = { ...item, usageBased: true }
  }
  const runCostDefaults = state.draft.runCostDefaults.map((existing, at) => (at === index ? next : existing))
  return { ...state, draft: { ...state.draft, runCostDefaults }, texts }
}

// ---- Issues and saving ----------------------------------------------------------------------------

export function textIssues(state: ConfigFormState): ConfigIssue[] {
  return Object.entries(state.texts).flatMap(([path, text]) => {
    const parsed = parseNumberText(text)
    if (parsed.kind === 'invalid') return [{ path, message: parsed.message }]
    if (parsed.kind === 'empty' && !NULLABLE_NUMBER.test(path)) return [{ path, message: VALUE_REQUIRED }]
    return []
  })
}

export function schemaIssues(config: Config): ConfigIssue[] {
  const result = ConfigSchema.safeParse(config)
  return result.success ? [] : result.error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message }))
}

// Every issue that blocks saving. At a field whose text does not parse, the schema would be judging
// the last number that did, not what is on screen, so only the text's own issue is shown there.
export function formIssues(state: ConfigFormState): ConfigIssue[] {
  if (state.draft === null) return []
  const typed = textIssues(state)
  const typedPaths = new Set(typed.map((issue) => issue.path))
  return [...typed, ...schemaIssues(state.draft).filter((issue) => !typedPaths.has(issue.path))]
}

export function issuesByPath(issues: readonly ConfigIssue[]): ReadonlyMap<string, string[]> {
  const byPath = new Map<string, string[]>()
  for (const { path, message } of issues) byPath.set(path, [...(byPath.get(path) ?? []), message])
  return byPath
}

export function leafPaths(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return prefix === '' ? [] : [prefix]
  const entries: [string, unknown][] = Array.isArray(value)
    ? (value as unknown[]).map((item, index) => [String(index), item])
    : Object.entries(value as Record<string, unknown>)
  return entries.flatMap(([key, item]) => leafPaths(item, prefix === '' ? key : `${prefix}.${key}`))
}

// Every path the Settings screen shows issues at: each leaf, each list, and the formula as a whole of
// each run-cost item that is usage-based or has one. The every-field render test holds the screen to
// exactly this set.
export function locatedPaths(draft: Config): Set<string> {
  const formulas = draft.runCostDefaults.flatMap((item, index) =>
    item.usageBased || item.usageFormula !== undefined ? [`runCostDefaults.${index}.usageFormula`] : [],
  )
  return new Set([...leafPaths(draft), ...LIST_PATHS, ...formulas])
}

// Issues with nowhere else to show, listed at the top so none is ever hidden.
export function otherProblems(draft: Config | null, issues: readonly ConfigIssue[]): ConfigIssue[] {
  if (draft === null) return []
  const located = locatedPaths(draft)
  return issues.filter((issue) => !located.has(issue.path))
}

export function numberWarnings(state: ConfigFormState, path: string): string[] {
  const parsed = parseNumberText(numberText(state, path))
  return parsed.kind === 'number' && parsed.warning !== null ? [parsed.warning] : []
}

export function hasChanges(state: ConfigFormState): boolean {
  if (state.draft === null) return false
  return state.saved === null || canonicalJson(state.draft) !== canonicalJson(state.saved)
}

// Worth a warning before leaving: a changed draft, or typed text that has not reached it.
export function hasUnsavedEdits(state: ConfigFormState): boolean {
  return hasChanges(state) || textIssues(state).length > 0
}

export function canSave(state: ConfigFormState): boolean {
  return hasChanges(state) && formIssues(state).length === 0
}

// ---- Hook -----------------------------------------------------------------------------------------

type Update = (edit: (current: ConfigFormState) => ConfigFormState) => void

// What the Settings screen reads and calls, built from any state, so a render test can show a state
// that only typing could otherwise reach.
export function configFormView(state: ConfigFormState, update: Update) {
  const { draft } = state
  const issues = formIssues(state)
  const byPath = issuesByPath(issues)
  const at = (path: string) => (draft === null ? undefined : valueAt(draft, path))

  return {
    state,
    draft,
    issues,
    otherProblems: otherProblems(draft, issues),
    changed: hasUnsavedEdits(state),
    canSave: canSave(state),
    issuesAt: (path: string): readonly string[] => byPath.get(path) ?? [],
    numberText: (path: string) => numberText(state, path),
    numberReading: (path: string) => numberReading(state, path),
    numberWarnings: (path: string) => numberWarnings(state, path),
    textAt: (path: string): string => {
      const value = at(path)
      return typeof value === 'string' ? value : ''
    },
    flagAt: (path: string): boolean => at(path) === true,
    valueAt: at,
    setNumberText: (path: string, text: string) => update((current) => setNumberText(current, path, text)),
    setText: (path: string, text: string) => update((current) => setText(current, path, text)),
    setChoice: (path: string, value: string) => update((current) => setChoice(current, path, value)),
    setFlag: (path: string, on: boolean) => update((current) => setFlag(current, path, on)),
    addBand: () => update(addBand),
    removeBand: (index: number) => update((current) => removeBand(current, index)),
    moveBand: (index: number, offset: -1 | 1) => update((current) => moveBand(current, index, offset)),
    addIndustry: () => update(addIndustry),
    removeIndustry: (index: number) => update((current) => removeIndustry(current, index)),
    moveIndustry: (index: number, offset: -1 | 1) => update((current) => moveIndustry(current, index, offset)),
    addRunCostItem: () => {
      // Made outside the state update, which React may run twice.
      const id = `rc-${crypto.randomUUID().slice(0, 8)}`
      update((current) => addRunCostItem(current, id))
    },
    removeRunCostItem: (index: number) => update((current) => removeRunCostItem(current, index)),
    moveRunCostItem: (index: number, offset: -1 | 1) => update((current) => moveRunCostItem(current, index, offset)),
    setUsageBased: (index: number, on: boolean) => update((current) => setUsageBased(current, index, on)),
    startFromDefaults: () => update(startFromDefaults),
    discard: () => update(discardChanges),
  }
}

export type ConfigFormView = ReturnType<typeof configFormView>

export function useConfigForm(saved: Config | null): ConfigFormView {
  const [stored, setStored] = useState(() => initialConfigForm(saved))
  // A save, import or restore reloads the store and brings a new Config; the form starts again from it.
  const state = stored.saved === saved ? stored : initialConfigForm(saved)
  if (state !== stored) setStored(state)
  return configFormView(state, setStored)
}
