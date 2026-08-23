/**
 * Version parsing and comparison for dsh release tags.
 * Tags look like `dsh-v0.1.0-rc.7`; the installed desktop reports
 * FileVersion like `0.1.0-rc.5`. A stable `0.1.0` beats any `0.1.0-rc.N`.
 */

export interface ParsedVersion {
  major: number
  minor: number
  patch: number
  /** null means stable (no prerelease). */
  pre: number | null
}

export function parseVersion(raw: string): ParsedVersion | null {
  const v = raw.trim().replace(/^dsh-/, '')
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/i.exec(v)
  if (m === null) return null
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    pre: m[4] !== undefined ? Number(m[4]) : null,
  }
}

/** -1 when a < b, 0 when equal, 1 when a > b. */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1
  }
  const ap = a.pre ?? Number.MAX_SAFE_INTEGER
  const bp = b.pre ?? Number.MAX_SAFE_INTEGER
  return ap === bp ? 0 : ap < bp ? -1 : 1
}
