import type { CalibrationRecord } from '../schema/library'

// ENGINES §5. These encode the calibration model itself, so they live here rather than in
// Config: an operator tuning them would be tuning what "calibrated" means.
export const CALIBRATION_MIN_SAMPLES = 3
export const CALIBRATION_WINDOW = 10
export const CALIBRATION_MULTIPLIER_MIN = 0.5
export const CALIBRATION_MULTIPLIER_MAX = 3.0

export type CalibrationSample = CalibrationRecord['samples'][number]

export interface CalibrationEntry {
  multiplier: number
  // Every sample, as CalibrationRecord.sampleCount reports it.
  sampleCount: number
  // Samples with a positive estimate, the only ones with a ratio. Trust is keyed on these, so
  // three samples of which one is unusable are still only a hint.
  usableSampleCount: number
  trustworthy: boolean
}

export type CalibrationLookup = Record<string, CalibrationEntry>

// Median rather than mean, so one catastrophic project cannot permanently distort the estimate.
function median(sorted: readonly number[]): number {
  const middle = Math.floor(sorted.length / 2)
  const upper = sorted[middle]
  const lower = sorted[middle - 1]
  if (upper === undefined) throw new Error('median of an empty list')
  return sorted.length % 2 === 1 || lower === undefined ? upper : (lower + upper) / 2
}

export function computeCalibration(samples: readonly CalibrationSample[]): CalibrationEntry {
  // A sample with no positive estimate has no ratio, so it carries no calibration information.
  // The schema rejects one, but engines take plain data and may meet one unvalidated.
  const usable = samples.filter((sample) => sample.estimatedHours > 0)
  const sampleCount = samples.length
  const usableSampleCount = usable.length
  if (usableSampleCount < CALIBRATION_MIN_SAMPLES) {
    return { multiplier: 1.0, sampleCount, usableSampleCount, trustworthy: false }
  }
  const ratios = usable
    .slice(-CALIBRATION_WINDOW)
    .map((sample) => sample.actualHours / sample.estimatedHours)
    .sort((a, b) => a - b)
  // Clamped so a single data-entry error cannot make future quotes absurd.
  const multiplier = Math.min(CALIBRATION_MULTIPLIER_MAX, Math.max(CALIBRATION_MULTIPLIER_MIN, median(ratios)))
  return { multiplier, sampleCount, usableSampleCount, trustworthy: true }
}

// Recomputes every entry from its samples. The multiplier stored on a record is a cache
// (DATA-MODEL, CalibrationRecord), never the authority.
export function buildCalibrationLookup(records: readonly CalibrationRecord[]): CalibrationLookup {
  // Null prototype, so a pattern id such as 'constructor' is an ordinary key.
  const samplesByPattern: Record<string, CalibrationSample[]> = Object.create(null) as Record<string, CalibrationSample[]>
  for (const record of records) {
    const existing = Object.hasOwn(samplesByPattern, record.patternId) ? samplesByPattern[record.patternId] : undefined
    samplesByPattern[record.patternId] = [...(existing ?? []), ...record.samples]
  }
  const lookup: CalibrationLookup = Object.create(null) as CalibrationLookup
  for (const patternId of Object.keys(samplesByPattern)) {
    lookup[patternId] = computeCalibration(samplesByPattern[patternId] ?? [])
  }
  return lookup
}

// Own-key read, so a lookup that arrived as a plain object (from JSON, say) cannot answer
// 'constructor' with Object's constructor.
export function lookupCalibration(lookup: CalibrationLookup, patternId: string | null): CalibrationEntry | undefined {
  if (patternId === null || !Object.hasOwn(lookup, patternId)) return undefined
  return lookup[patternId]
}
