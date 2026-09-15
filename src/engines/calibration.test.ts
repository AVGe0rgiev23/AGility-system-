import { describe, expect, it } from 'vitest'
import { calibrationRecord } from '../schema/__fixtures__/records'
import type { CalibrationRecord } from '../schema/library'
import { mulberry32, randomInt, randomNumber, type Random } from './__fixtures__/engine-fixtures'
import {
  buildCalibrationLookup,
  CALIBRATION_MIN_SAMPLES,
  CALIBRATION_MULTIPLIER_MAX,
  CALIBRATION_MULTIPLIER_MIN,
  CALIBRATION_WINDOW,
  computeCalibration,
  lookupCalibration,
  type CalibrationSample,
} from './calibration'

// A sample whose actual/estimated ratio is exactly `ratio`.
function sample(ratio: number, index = 0): CalibrationSample {
  return {
    engagementId: `eng-${index}`,
    estimatedHours: 10,
    actualHours: 10 * ratio,
    completedAt: `2026-0${1 + (index % 9)}-01T00:00:00.000Z`,
  }
}

function samples(...ratios: number[]): CalibrationSample[] {
  return ratios.map((ratio, index) => sample(ratio, index))
}

function randomSample(random: Random, index: number): CalibrationSample {
  return {
    engagementId: `eng-${index}`,
    estimatedHours: randomNumber(random, 0.5, 80),
    actualHours: randomNumber(random, 0, 400),
    completedAt: '2026-06-01T00:00:00.000Z',
  }
}

describe('calibration constants', () => {
  it('match ENGINES §5', () => {
    expect(CALIBRATION_MIN_SAMPLES).toBe(3)
    expect(CALIBRATION_WINDOW).toBe(10)
    expect(CALIBRATION_MULTIPLIER_MIN).toBe(0.5)
    expect(CALIBRATION_MULTIPLIER_MAX).toBe(3)
  })
})

describe('computeCalibration', () => {
  it('yields exactly 1.0 and untrustworthy with no samples', () => {
    expect(computeCalibration([])).toEqual({ multiplier: 1, sampleCount: 0, usableSampleCount: 0, trustworthy: false })
  })

  it('yields exactly 1.0 and untrustworthy below the sample threshold', () => {
    expect(computeCalibration(samples(2.5, 2.5))).toEqual({ multiplier: 1, sampleCount: 2, usableSampleCount: 2, trustworthy: false })
  })

  it('takes the median ratio once the threshold is met', () => {
    expect(computeCalibration(samples(0.8, 1.5, 1.2))).toEqual({
      multiplier: 1.2,
      sampleCount: 3,
      usableSampleCount: 3,
      trustworthy: true,
    })
  })

  it('averages the two middle ratios for an even count', () => {
    expect(computeCalibration(samples(1.0, 2.0, 1.4, 1.6)).multiplier).toBeCloseTo(1.5, 12)
  })

  it('uses the median, so one catastrophic project does not distort the multiplier', () => {
    expect(computeCalibration(samples(1.1, 1.0, 1.2, 9.0)).multiplier).toBeCloseTo(1.15, 12)
  })

  it('clamps the multiplier to the allowed range', () => {
    expect(computeCalibration(samples(5, 6, 7)).multiplier).toBe(CALIBRATION_MULTIPLIER_MAX)
    expect(computeCalibration(samples(0.1, 0.2, 0.3)).multiplier).toBe(CALIBRATION_MULTIPLIER_MIN)
  })

  it('computes the ratio over the most recent window only, but counts every sample', () => {
    const old = Array.from({ length: 5 }, (_, i) => sample(3, i))
    const recent = Array.from({ length: CALIBRATION_WINDOW }, (_, i) => sample(1.1, 100 + i))
    const result = computeCalibration([...old, ...recent])
    expect(result.multiplier).toBeCloseTo(1.1, 12)
    expect(result.sampleCount).toBe(15)
    expect(result.usableSampleCount).toBe(15)
  })

  it('counts a sample whose estimate is not positive but neither uses nor trusts it, since its ratio is undefined', () => {
    const broken: CalibrationSample = { ...sample(1), estimatedHours: 0, actualHours: 12 }
    expect(computeCalibration([broken, ...samples(1.2, 1.2, 1.2)])).toEqual({
      multiplier: 1.2,
      sampleCount: 4,
      usableSampleCount: 3,
      trustworthy: true,
    })
    // Three samples, but only two usable: still below the threshold.
    expect(computeCalibration([broken, ...samples(2, 2)])).toEqual({
      multiplier: 1,
      sampleCount: 3,
      usableSampleCount: 2,
      trustworthy: false,
    })
    expect(computeCalibration([broken, broken, broken])).toEqual({
      multiplier: 1,
      sampleCount: 3,
      usableSampleCount: 0,
      trustworthy: false,
    })
  })

  it('does not mutate its input', () => {
    const input = samples(1.5, 1.0, 2.0)
    const copy = structuredClone(input)
    computeCalibration(input)
    expect(input).toEqual(copy)
  })
})

describe('computeCalibration invariants', () => {
  it('fewer than three usable samples always yields exactly 1.0 and untrustworthy, however many samples there are', () => {
    const random = mulberry32(21)
    for (let i = 0; i < 300; i++) {
      const usable = randomInt(random, 0, CALIBRATION_MIN_SAMPLES - 1)
      const unusable = randomInt(random, 0, 5)
      const input = [
        ...Array.from({ length: usable }, (_, index) => randomSample(random, index)),
        ...Array.from({ length: unusable }, (_, index) => ({ ...randomSample(random, 100 + index), estimatedHours: 0 })),
      ]
      expect(computeCalibration(input), `case ${i}`).toEqual({
        multiplier: 1,
        sampleCount: usable + unusable,
        usableSampleCount: usable,
        trustworthy: false,
      })
    }
  })

  it('the multiplier never leaves [0.5, 3.0]', () => {
    const random = mulberry32(22)
    for (let i = 0; i < 300; i++) {
      const count = randomInt(random, 0, 25)
      const input = Array.from({ length: count }, (_, index) => randomSample(random, index))
      const { multiplier } = computeCalibration(input)
      expect(multiplier, `case ${i}`).toBeGreaterThanOrEqual(CALIBRATION_MULTIPLIER_MIN)
      expect(multiplier, `case ${i}`).toBeLessThanOrEqual(CALIBRATION_MULTIPLIER_MAX)
    }
  })

  it('adding a sample identical to the current median does not change the multiplier', () => {
    // Below a full window: once the window is full, appending evicts the oldest sample,
    // so the window itself changes and the property no longer applies.
    const random = mulberry32(23)
    for (let i = 0; i < 300; i++) {
      const count = randomInt(random, CALIBRATION_MIN_SAMPLES, CALIBRATION_WINDOW - 1)
      const input = Array.from({ length: count }, (_, index) => randomSample(random, index))
      const ratios = input.map((s) => s.actualHours / s.estimatedHours).sort((a, b) => a - b)
      const middle = Math.floor(ratios.length / 2)
      const lower = ratios[middle - 1]
      const upper = ratios[middle]
      if (upper === undefined) throw new Error('unreachable: at least three ratios')
      const median = ratios.length % 2 === 1 || lower === undefined ? upper : (lower + upper) / 2
      const before = computeCalibration(input).multiplier
      const after = computeCalibration([...input, sample(median, 999)]).multiplier
      expect(after, `case ${i}`).toBeCloseTo(before, 12)
    }
  })
})

describe('buildCalibrationLookup', () => {
  it('returns an empty lookup for no records', () => {
    expect(buildCalibrationLookup([])).toEqual({})
  })

  it('keys entries by pattern id and recomputes them from the samples', () => {
    // The stored multiplier is a cache; the lookup must reflect the samples and the
    // current constants, never a stale or hand-edited figure.
    const record: CalibrationRecord = {
      ...calibrationRecord(),
      samples: samples(1.4, 1.2, 1.6),
      multiplier: 9,
      sampleCount: 99,
      trustworthy: false,
    }
    expect(buildCalibrationLookup([record])).toEqual({
      'pat-email-triage': { multiplier: 1.4, sampleCount: 3, usableSampleCount: 3, trustworthy: true },
    })
  })

  it('merges the samples of duplicate records in order', () => {
    const first = { ...calibrationRecord(), samples: samples(1.0) }
    const second = { ...calibrationRecord(), samples: samples(2.0, 1.5) }
    expect(buildCalibrationLookup([first, second])['pat-email-triage']).toEqual({
      multiplier: 1.5,
      sampleCount: 3,
      usableSampleCount: 3,
      trustworthy: true,
    })
  })

  it('stores prototype-named pattern ids as plain own keys', () => {
    const lookup = buildCalibrationLookup([
      { ...calibrationRecord(), patternId: '__proto__', samples: samples(2, 2, 2) },
      { ...calibrationRecord(), patternId: 'constructor', samples: samples(0.5, 0.5, 0.5) },
    ])
    expect(Object.getPrototypeOf(lookup)).toBeNull()
    expect(lookupCalibration(lookup, '__proto__')?.multiplier).toBe(2)
    expect(lookupCalibration(lookup, 'constructor')?.multiplier).toBe(0.5)
  })
})

describe('lookupCalibration', () => {
  it('returns the entry for a known pattern and undefined otherwise', () => {
    const lookup = buildCalibrationLookup([{ ...calibrationRecord(), samples: samples(1.3, 1.3, 1.3) }])
    expect(lookupCalibration(lookup, 'pat-email-triage')).toEqual({
      multiplier: 1.3,
      sampleCount: 3,
      usableSampleCount: 3,
      trustworthy: true,
    })
    expect(lookupCalibration(lookup, 'pat-unknown')).toBeUndefined()
    expect(lookupCalibration(lookup, null)).toBeUndefined()
  })

  it('never reads inherited properties off a plain-object lookup', () => {
    expect(lookupCalibration({}, 'constructor')).toBeUndefined()
    expect(lookupCalibration({}, 'toString')).toBeUndefined()
  })
})
