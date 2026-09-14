// Test-only helpers for the engine suites. No vitest import: the import allowlist scans this file.

// mulberry32: a tiny seeded generator, so a property test that fails does so on every run
// with the same case index, and Math.random stays out of the engines folder entirely.
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type Random = () => number

export function randomInt(random: Random, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1))
}

export function randomNumber(random: Random, min: number, max: number): number {
  return min + random() * (max - min)
}

export function pick<T>(random: Random, options: readonly T[]): T {
  const index = Math.floor(random() * options.length)
  const chosen = options[index]
  if (chosen === undefined) throw new Error('pick needs a non-empty list')
  return chosen
}

// Plain JSON-shaped data of bounded depth, for hashing and serialisation tests.
export function randomPlainValue(random: Random, depth = 0): unknown {
  const kind = depth >= 3 ? randomInt(random, 0, 4) : randomInt(random, 0, 6)
  switch (kind) {
    case 0:
      return null
    case 1:
      return random() < 0.5
    case 2:
      return Math.round(randomNumber(random, -1e6, 1e6) * 100) / 100
    case 3:
      return randomInt(random, -1000, 1000)
    case 4:
      return `s${randomInt(random, 0, 999)}`
    case 5:
      return Array.from({ length: randomInt(random, 0, 4) }, () => randomPlainValue(random, depth + 1))
    default: {
      const object: Record<string, unknown> = {}
      for (let i = randomInt(random, 0, 4); i > 0; i--) {
        object[`k${randomInt(random, 0, 9)}`] = randomPlainValue(random, depth + 1)
      }
      return object
    }
  }
}
