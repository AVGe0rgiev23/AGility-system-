import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  company,
  contact,
  detectedTool,
  issuePaths,
  roundTrip,
  timestampedNote,
} from './__fixtures__/records'
import {
  CompanySchema,
  ContactSchema,
  DeliveryModelSchema,
  DetectedToolSchema,
  TimestampedNoteSchema,
  type Company,
  type DeliveryModel,
} from './company'
import type { Currency, TracedValue } from './traced'

describe('DeliveryModelSchema', () => {
  it('accepts exactly the three delivery models', () => {
    expect(DeliveryModelSchema.options).toEqual(['fully-managed', 'client-owned', 'hybrid'])
    expect(DeliveryModelSchema.safeParse('self-hosted').success).toBe(false)
  })
})

describe('DetectedToolSchema', () => {
  it('accepts a valid detection', () => {
    expect(DetectedToolSchema.parse(detectedTool())).toEqual(detectedTool())
  })

  it('caps evidence at 80 characters', () => {
    expect(issuePaths(DetectedToolSchema, { ...detectedTool(), evidence: 'x'.repeat(80) })).toEqual([])
    expect(issuePaths(DetectedToolSchema, { ...detectedTool(), evidence: 'x'.repeat(81) })).toEqual([
      'evidence',
    ])
  })

  it('requires an explicit confirmed flag', () => {
    const { confirmed: _omitted, ...unconfirmed } = detectedTool()
    expect(issuePaths(DetectedToolSchema, unconfirmed)).toEqual(['confirmed'])
  })
})

describe('ContactSchema and TimestampedNoteSchema', () => {
  it('accept valid records', () => {
    expect(ContactSchema.parse(contact())).toEqual(contact())
    expect(TimestampedNoteSchema.parse(timestampedNote())).toEqual(timestampedNote())
  })

  it('require a contact name that is not blank', () => {
    expect(issuePaths(ContactSchema, { ...contact(), name: ' ' })).toEqual(['name'])
  })

  it('accept a contact email only as a valid address, when present', () => {
    expect(issuePaths(ContactSchema, { ...contact(), email: 'marta@rila.bg' })).toEqual([])
    for (const email of ['', 'marta@', 'marta rila.bg']) {
      expect(issuePaths(ContactSchema, { ...contact(), email }), email).toEqual(['email'])
    }
  })

  it('require isDecisionMaker and tags', () => {
    const { isDecisionMaker: _a, ...noDecisionFlag } = contact()
    const { tags: _b, ...noTags } = timestampedNote()
    expect(issuePaths(ContactSchema, noDecisionFlag)).toEqual(['isDecisionMaker'])
    expect(issuePaths(TimestampedNoteSchema, noTags)).toEqual(['tags'])
  })
})

describe('CompanySchema', () => {
  it('accepts a full company', () => {
    expect(CompanySchema.parse(company())).toEqual(company())
  })

  it('accepts a null blendedHourlyCost but not a missing one', () => {
    expect(issuePaths(CompanySchema, { ...company(), blendedHourlyCost: null })).toEqual([])
    const { blendedHourlyCost: _omitted, ...withoutCost } = company()
    expect(issuePaths(CompanySchema, withoutCost)).toEqual(['blendedHourlyCost'])
  })

  it('propagates the money-unit currency rule into nested traced values', () => {
    const cost = { value: 30, unit: 'EUR/hour', source: 'client-stated' }
    expect(issuePaths(CompanySchema, { ...company(), blendedHourlyCost: cost })).toEqual([
      'blendedHourlyCost.currency',
    ])
  })

  it('requires a supported company currency', () => {
    expect(issuePaths(CompanySchema, { ...company(), currency: 'JPY' })).toEqual(['currency'])
  })

  it('accepts a company with only the required fields', () => {
    const minimal = {
      name: 'Solo Bakery',
      industry: 'food',
      currency: 'EUR',
      blendedHourlyCost: null,
      detectedStack: [],
      statedTools: [],
      constraints: { compliance: [] },
    }
    expect(issuePaths(CompanySchema, minimal)).toEqual([])
  })

  it('survives a JSON round trip unchanged', () => {
    expect(CompanySchema.parse(roundTrip(company()))).toEqual(company())
  })

  it('requires a name that is not blank', () => {
    for (const name of ['', '   ']) {
      expect(issuePaths(CompanySchema, { ...company(), name }), JSON.stringify(name)).toEqual(['name'])
    }
    expect(CompanySchema.safeParse({ ...company(), name: '' }).error?.issues.map((issue) => issue.message)).toEqual(['The company needs a name'])
  })

  it('accepts a website only as an http:// or https:// URL with a domain, when present', () => {
    for (const website of ['https://rila.bg', 'http://solo-bakery.bg/menu']) {
      expect(issuePaths(CompanySchema, { ...company(), website }), website).toEqual([])
    }
    for (const website of ['', 'rila.bg', 'ftp://rila.bg', 'https://localhost', ' https://rila.bg', 'javascript:alert(1)']) {
      expect(issuePaths(CompanySchema, { ...company(), website }), website).toEqual(['website'])
    }
  })

  it('accepts an employee count only as a whole number of at least 0, when present', () => {
    for (const employeeCount of [0, 1, 250]) {
      expect(issuePaths(CompanySchema, { ...company(), employeeCount }), String(employeeCount)).toEqual([])
    }
    for (const employeeCount of [-1, 2.5]) {
      expect(issuePaths(CompanySchema, { ...company(), employeeCount }), String(employeeCount)).toEqual(['employeeCount'])
    }
  })

  it('infers the spec types', () => {
    expectTypeOf<Company['currency']>().toEqualTypeOf<Currency>()
    expectTypeOf<Company['blendedHourlyCost']>().toEqualTypeOf<TracedValue | null>()
    expectTypeOf<Company['preferredDeliveryModel']>().toEqualTypeOf<DeliveryModel | undefined>()
    expectTypeOf<Company['constraints']['compliance']>().toEqualTypeOf<string[]>()
  })
})
