import type { RenderScalar, SectionOverride } from '../schema/scope'
import { el, text, type RenderNode } from './nodes'
import type { RenderedDocument, RenderedSection } from './template'

// Section-level edits that survive regeneration. An override is pinned to the hash of exactly
// the values its section read when it was edited (RenderedSection.inputs), so a change to any
// other field of the engagement leaves it applied, and a change to a value the section shows
// makes it a conflict. A conflict is never resolved here: the fresh body is rendered, the edit
// is returned with what drifted, and Alex chooses. No edit is dropped and no stale edit is
// rendered over fresh data.

// Above this many read paths the snapshot is left out (baseInputs: null) and the override keeps
// only its hash, so a section that iterates a long list does not bloat the record. Its conflicts
// then carry no per-path diff.
export const MAX_SNAPSHOT_PATHS = 200

export interface Drift {
  path: string
  // Undefined when the path was not read on that side: added or removed since the edit.
  oldValue: RenderScalar | undefined
  newValue: RenderScalar | undefined
}

export interface Conflict {
  sectionId: string
  override: SectionOverride
  // The section as freshly generated from the current data: the new value.
  generated: RenderedSection
  // Every read path whose value differs between the edit's snapshot and the current render.
  // Null when the override carries no snapshot, so old values are unknown.
  drifted: Drift[] | null
}

export interface ReconciledSection extends RenderedSection {
  // The override applied to this section, when its hash matched. The body is then the edit.
  override: SectionOverride | null
}

export interface Reconciled {
  templateId: string
  sections: ReconciledSection[]
  applied: string[]
  conflicts: Conflict[]
  // Overrides naming a section the template no longer has. Kept, never dropped.
  orphaned: SectionOverride[]
}

// Override content is Alex's plain text: paragraphs on blank lines, every character literal.
export function overrideBody(content: string): RenderNode[] {
  return content
    .split(/\n[ \t]*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== '')
    .map((paragraph) => el('p', {}, [text(paragraph)]))
}

function snapshot(section: RenderedSection): Record<string, RenderScalar> | null {
  return Object.keys(section.inputs).length > MAX_SNAPSHOT_PATHS ? null : { ...section.inputs }
}

// A fresh edit of a section as it was just rendered.
export function createOverride(section: RenderedSection, content: string, now: string): SectionOverride {
  return {
    sectionId: section.id,
    content,
    editedAt: now,
    baseInputsHash: section.inputsHash,
    baseInputs: snapshot(section),
    rebasedFrom: null,
  }
}

export function diffInputs(
  before: Record<string, RenderScalar>,
  after: Record<string, RenderScalar>,
): Drift[] {
  const paths = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
  return paths.flatMap((path) => {
    const oldValue = Object.hasOwn(before, path) ? before[path] : undefined
    const newValue = Object.hasOwn(after, path) ? after[path] : undefined
    return Object.is(oldValue, newValue) ? [] : [{ path, oldValue, newValue }]
  })
}

export function reconcileOverrides(rendered: RenderedDocument, overrides: SectionOverride[]): Reconciled {
  const byId = new Map(rendered.sections.map((section) => [section.id, section]))
  const appliedById = new Map<string, SectionOverride>()
  const applied: string[] = []
  const conflicts: Conflict[] = []
  const orphaned: SectionOverride[] = []

  for (const override of overrides) {
    const section = byId.get(override.sectionId)
    if (section === undefined) {
      orphaned.push(override)
    } else if (override.baseInputsHash === section.inputsHash) {
      // Two overrides for one section: the later in the list wins the body, both are reported.
      appliedById.set(section.id, override)
      applied.push(section.id)
    } else {
      conflicts.push({
        sectionId: section.id,
        override,
        generated: section,
        drifted: override.baseInputs === null ? null : diffInputs(override.baseInputs, section.inputs),
      })
    }
  }

  const sections = rendered.sections.map((section): ReconciledSection => {
    const override = appliedById.get(section.id)
    if (override === undefined) return { ...section, override: null }
    // A hidden section stays hidden: the edit is kept, not shown, until the section returns.
    return { ...section, override, body: section.visible ? overrideBody(override.content) : [] }
  })

  return { templateId: rendered.templateId, sections, applied, conflicts, orphaned }
}

// Alex keeps the edit over changed data. The override is pinned to the fresh render, and
// rebasedFrom records the hash it was kept over, so the trail shows an edit that outlived a data
// change without being rewritten. Keeping the generated version is just dropping the override.
export function acceptEdit(conflict: Conflict, now: string): SectionOverride {
  return {
    ...createOverride(conflict.generated, conflict.override.content, now),
    rebasedFrom: conflict.override.baseInputsHash,
  }
}
