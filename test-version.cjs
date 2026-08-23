function parseVersion(raw) {
  const v = raw.trim().replace(/^dsh-/, '')
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/i.exec(v)
  if (!m) return null
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] !== undefined ? +m[4] : null }
}
function cmp(a, b) {
  for (const k of ['major','minor','patch']) { if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1 }
  const ap = a.pre ?? Number.MAX_SAFE_INTEGER, bp = b.pre ?? Number.MAX_SAFE_INTEGER
  return ap === bp ? 0 : ap < bp ? -1 : 1
}
const cases = [
  ['dsh-v0.1.0-rc.7', '0.1.0-rc.5', 1],
  ['dsh-v0.1.0-rc.7', '0.1.0-rc.7', 0],
  ['dsh-v0.1.0-rc.5', '0.1.0-rc.7', -1],
  ['dsh-v0.1.0', '0.1.0-rc.7', 1],
  ['dsh-v0.2.0-rc.1', '0.1.0-rc.9', 1],
  ['dsh-v0.1.0-rc.10', '0.1.0-rc.9', 1],
]
let fail = 0
for (const [x, y, want] of cases) {
  const px = parseVersion(x), py = parseVersion(y)
  const got = cmp(px, py)
  const ok = got === want
  if (!ok) fail++
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + x + ' vs ' + y + ' = ' + got + ' (want ' + want + ')')
}
console.log(fail === 0 ? 'ALL PASS' : fail + ' FAILED')
process.exit(fail === 0 ? 0 : 1)
