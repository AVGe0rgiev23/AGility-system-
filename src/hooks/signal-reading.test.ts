import { describe, expect, it } from 'vitest'
import { detectedTool } from '../schema/__fixtures__/records'
import { readSignals } from './signal-reading'

const PAGE = '<script src="//js.hs-scripts.com/1234567.js"></script> Invoices are raised in Xero. Every order is entered manually.'

describe('readSignals', () => {
  it('reads every tool and pain in the text, and counts them all as new against an empty stack', () => {
    const reading = readSignals(PAGE, [])
    expect(reading.tools.map((tool) => tool.name)).toEqual(['HubSpot', 'Xero'])
    expect(reading.added).toBe(2)
    expect(reading.alreadyListed).toBe(0)
    expect(reading.pains.map((pain) => pain.id)).toEqual(['pain-manual'])
  })

  it('counts a tool the stack already holds as listed, not new, whether or not it was confirmed', () => {
    const held = { ...detectedTool(), name: 'HubSpot', confirmed: true }
    const reading = readSignals(PAGE, [held])
    expect(reading.added).toBe(1)
    expect(reading.alreadyListed).toBe(1)
    // The reading is what the text suggests; merging it is a separate step that never touches an entry.
    expect(reading.tools).toHaveLength(2)
  })

  it('reads nothing from text that names nothing, and says so with zeros', () => {
    expect(readSignals('We deliver pallets across the country.', [])).toEqual({ tools: [], added: 0, alreadyListed: 0, pains: [] })
    expect(readSignals('', [detectedTool()])).toEqual({ tools: [], added: 0, alreadyListed: 0, pains: [] })
  })
})
