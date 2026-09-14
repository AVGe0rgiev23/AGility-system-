// Engine results are cached on the record and recomputed when their inputsHash no longer
// matches (ARCHITECTURE, Derived data policy). The hash therefore has to be identical across
// sessions and machines for the same data, and it has to be synchronous: crypto.subtle is
// async and a browser API, both banned in engines. A 53-bit non-cryptographic hash over a
// canonical serialisation is enough to detect drift; it does not need to resist an adversary.

// JSON.stringify with object keys sorted at every depth, so that two records holding the
// same data in a different key order hash identically. Scalars, undefined and non-finite
// numbers serialise exactly as JSON.stringify would.
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null'
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
  return `{${entries.join(',')}}`
}

// cyrb53 (public domain, bryc). Two 32-bit lanes folded into one 53-bit integer.
function cyrb53(text: string): number {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ code, 2654435761)
    h2 = Math.imul(h2 ^ code, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

export function hashInputs(value: unknown): string {
  return cyrb53(canonicalJson(value)).toString(16).padStart(14, '0')
}
