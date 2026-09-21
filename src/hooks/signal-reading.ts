import { extractSignals, type PainSignal } from '../engines/signals'
import type { DetectedTool } from '../schema/company'

export interface SignalReading {
  // Everything the text suggests, in table order, unconfirmed.
  tools: DetectedTool[]
  // Of those tools, how many the stack does not hold yet and how many it already does, so a re-run says
  // it found nothing new rather than seeming to have done nothing.
  added: number
  alreadyListed: number
  pains: PainSignal[]
}

// What pasted text suggests, set against what the engagement already lists. A pure reading: merging it
// into the stack is a separate step (mergeDetectedTools), which never touches an entry already there.
export function readSignals(text: string, stack: readonly DetectedTool[]): SignalReading {
  const { tools, pains } = extractSignals(text)
  const known = new Set(stack.map((tool) => tool.name))
  const added = tools.filter((tool) => !known.has(tool.name)).length
  return { tools, added, alreadyListed: tools.length - added, pains }
}
