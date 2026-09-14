// Formula strings and warnings are for reading, not for arithmetic: two decimals, no trailing zeros.
export function fmt(value: number): string {
  return String(Number(value.toFixed(2)))
}
