import { Context } from '@deepseek-ai/cordis'
import { apply } from './lib/index.js'
process.on('unhandledRejection', (e) => { console.log('UNHANDLED:', e instanceof Error ? e.message : String(e)) })
const fs = await import('node:fs/promises')
const statePath = process.env.USERPROFILE + '/.dsh/update-check-plus/state.json'
const ctx = new Context()
apply(ctx, { intervalHours: 9999, desktopRepoPath: 'D:/Claude_Design/deepseek-harness-desktop' })
console.log('plugin applied, waiting 30s...')
setTimeout(async () => {
  try { console.log((await fs.readFile(statePath, 'utf8')).slice(0, 2000)) } catch (e) { console.log('read fail', e.message) }
  process.exit(0)
}, 30000)
