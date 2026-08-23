
import { fetchDesktopVersion, downloadInstaller } from './src/desktop.ts'

const version = await fetchDesktopVersion('https://www.dshdesktop.cn/api/desktop/version')
console.log('DESKTOP VERSION:', version)

const outDir = process.env.TEMP + '\\dsh-update-test'
console.log('downloading installer to ' + outDir + ' ...')
const t0 = Date.now()
const path = await downloadInstaller('https://www.dshdesktop.cn/api/downloads/windows', outDir, (p) => {
  const mb = (p.received / 1048576).toFixed(1)
  const total = p.total > 0 ? '/' + (p.total / 1048576).toFixed(1) + ' MB' : ' MB'
  console.log('progress: ' + mb + total)
})
const secs = ((Date.now() - t0) / 1000).toFixed(1)
const fs = await import('node:fs')
console.log('DONE: ' + path + ' (' + (fs.statSync(path).size / 1048576).toFixed(1) + ' MB in ' + secs + 's)')
