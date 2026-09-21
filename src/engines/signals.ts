import type { DetectedTool } from '../schema/company'
import { PAIN_RULES, TOOL_RULES } from './signal-rules'

// Signal extraction (ENGINES §6): deterministic matching over text Alex pastes. No network requests, no
// scraping, no fetching. Alex pastes; this matches.
//
// Output is suggestions with visible evidence, never conclusions. Every tool comes back unconfirmed and
// counts for nothing until Alex confirms it on the Company tab.

// DetectedTool.evidence is at most 80, counted in UTF-16 units as the schema counts them.
const EVIDENCE_LIMIT = 80

// A cut lands between code points: splitting a surrogate pair would leave half a character that still
// validates and renders as a replacement glyph.
export function evidenceFrom(match: string): string {
  if (match.length <= EVIDENCE_LIMIT) return match
  const cut = match.slice(0, EVIDENCE_LIMIT)
  const last = cut.charCodeAt(EVIDENCE_LIMIT - 1)
  const splitsAPair = last >= 0xd800 && last <= 0xdbff
  return splitsAPair ? cut.slice(0, EVIDENCE_LIMIT - 1) : cut
}

export interface PainSignal {
  id: string
  label: string
  // What matched, so the suggestion can be judged rather than taken on trust.
  evidence: string
  questionSetIds: readonly string[]
  patternIds: readonly string[]
}

export interface ExtractedSignals {
  tools: DetectedTool[]
  pains: PainSignal[]
}

// The first pattern of a rule that the text contains, or null. Patterns carry no `g` flag, so `exec`
// starts at the beginning every time and a rule reads the same on every call.
function firstMatch(patterns: readonly RegExp[], text: string): string | null {
  for (const pattern of patterns) {
    const found = pattern.exec(text)
    if (found !== null) return found[0]
  }
  return null
}

// Matches in table order, so the same text always gives the same list in the same order.
export function extractSignals(text: string): ExtractedSignals {
  const tools: DetectedTool[] = []
  for (const rule of TOOL_RULES) {
    const match = firstMatch(rule.patterns, text)
    if (match !== null) {
      tools.push({ name: rule.name, category: rule.category, evidence: evidenceFrom(match), confidence: rule.confidence, confirmed: false })
    }
  }

  const pains: PainSignal[] = []
  for (const rule of PAIN_RULES) {
    const match = firstMatch(rule.patterns, text)
    if (match !== null) {
      pains.push({ id: rule.id, label: rule.label, evidence: evidenceFrom(match), questionSetIds: rule.questionSetIds, patternIds: rule.patternIds })
    }
  }

  return { tools, pains }
}

// Adds what the stack does not already hold, keyed on the name exactly as the schema's uniqueness rule
// is. An entry already there is never touched, so re-running extraction cannot un-confirm a tool Alex
// confirmed or overwrite the evidence he confirmed it on. Returns the same array when nothing is new,
// so a re-run that finds nothing leaves the record untouched.
export function mergeDetectedTools(existing: DetectedTool[], found: readonly DetectedTool[]): DetectedTool[] {
  const known = new Set(existing.map((tool) => tool.name))
  const added = found.filter((tool) => !known.has(tool.name))
  return added.length === 0 ? existing : [...existing, ...added]
}
