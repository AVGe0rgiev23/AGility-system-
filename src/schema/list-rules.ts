// Rules shared by every list of typed-in entries in the schema. The wording is here rather than in each
// schema so a stated tool, a system and a compliance flag are all refused in the same words.

// What a Zod refinement context provides, named structurally so this file does not depend on the shape
// of Zod's own context type.
interface IssueSink {
  addIssue: (issue: { code: 'custom'; path: (string | number)[]; message: string }) => void
}

// Lists are filtered on, counted and printed, so a blank entry stands for nothing and a repeat counts
// twice. Compared exactly, as a person typing two spellings means two things.
export function addListEntryIssues(ctx: IssueSink, list: readonly string[], path: (string | number)[], noun: string): void {
  const seen = new Set<string>()
  for (const [index, entry] of list.entries()) {
    if (entry.trim() === '') ctx.addIssue({ code: 'custom', path: [...path, index], message: `A ${noun} cannot be blank` })
    else if (seen.has(entry)) ctx.addIssue({ code: 'custom', path: [...path, index], message: `The ${noun} '${entry}' is already listed` })
    seen.add(entry)
  }
}
