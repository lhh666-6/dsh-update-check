/**
 * Host half of dsh-update-check-plus: detects the installed app version, polls
 * GitHub for the newest deepseek-harness release, persists one state file
 * under the DSH home, exposes it over the webServer route, and can
 * auto-download the latest source zipball. Everything stays local.
 *
 * @module dsh-update-check-plus
 */

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { downloadInstaller, fetchDesktopVersion, launchInstallerAndExit } from './desktop.ts'
import { buildUpgradeScript, launchUpgradeViaTaskScheduler } from './upgradeScript.ts'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { parseVersion, compareVersions } from './version.ts'
import { fetchReleases, downloadZipball, type GitHubRelease } from './github.ts'
import { emptyState, loadState, saveState, type UpdateCheckState } from './state.ts'

/** Cordis plugin name (also the row id in cordis.yml). */
export const name = 'update-check-plus'

/** No hard dependencies: settings/webserver registrations are optional children. */
export const inject: string[] = []

const NS = settingsNamespace('update-check-plus')

export interface UpdateCheckConfig {
  /** GitHub repo to watch, owner/name. */
  repo: string
  /** Check cadence in hours (>= 1). */
  intervalHours: number
  /** Automatically download the latest source zipball when an update exists. */
  autoDownload: boolean
  /** Directory for downloaded source zipballs. */
  downloadDir: string
  /** Staging directory holding a ready-to-deploy engine (node_modules layout). */
  engineStagingDir: string
  /** Optional path to a deepseek-harness-desktop checkout whose upstream.json supplies the installed version. */
  desktopRepoPath: string
  /**
   * Also check the DSH Desktop update service (dshdesktop.cn). OFF by default:
   * that channel serves "DSH Desktop" (anywhere-labs deepseek-harness-desktop,
   * renamed/redesigned product), which is NOT an update for the official
   * DeepSeek Harness desktop app (rc.5). Opt in only if you actually use it.
   */
  enableDesktopUpdate: boolean
  /** DSH Desktop version service endpoint. */
  desktopVersionEndpoint: string
  /** DSH Desktop installer download endpoint (302 -> CDN). */
  desktopDownloadEndpoint: string
}

export const Config: z<UpdateCheckConfig> = z.object({
  repo: z.string().default('deepseek-ai/deepseek-harness'),
  intervalHours: z.number().min(1).default(12),
  autoDownload: z.boolean().default(false),
  downloadDir: z.string().default(''),
  engineStagingDir: z.string().default(''),
  desktopRepoPath: z.string().default(''),
  enableDesktopUpdate: z.boolean().default(false),
  desktopVersionEndpoint: z.string().default('https://www.dshdesktop.cn/api/desktop/version'),
  desktopDownloadEndpoint: z.string().default('https://www.dshdesktop.cn/api/downloads/windows'),
})

function detectFromExecutable(): Promise<string | null> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve(null)
      return
    }
    const exe = process.execPath
    const escaped = exe.replace(/'/g, "''")
    const cmd = `(Get-Item -LiteralPath '${escaped}').VersionInfo.FileVersion`
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], {
      timeout: 10000,
      windowsHide: true,
      encoding: 'utf8',
    }, (err, stdout) => {
      if (err !== null) {
        resolve(null)
        return
      }
      const line = stdout.trim().split(/\r?\n/)[0]?.trim()
      resolve(line !== undefined && parseVersion(line) !== null ? line : null)
    })
  })
}

const require = createRequire(import.meta.url)

async function detectCurrentVersion(cfg: UpdateCheckConfig): Promise<string | null> {
  // 1) The host's own @deepseek-ai/dsh package version (matches the installed app).
  try {
    const pkg = require('@deepseek-ai/dsh/package.json') as { version?: string }
    if (pkg.version !== undefined && pkg.version.length > 0 && parseVersion(pkg.version) !== null) {
      return pkg.version
    }
  } catch {
    // not resolvable in this assembly: fall through
  }
  // 1b) The packaged host engine next to this executable (resources/host/...).
  // This is the real engine version even when the shell exe keeps its old
  // FileVersion after a host-only upgrade.
  try {
    const hostPkg = join(dirname(process.execPath), 'resources', 'host', 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
    const j = JSON.parse(await readFile(hostPkg, 'utf8')) as { version?: string }
    if (j.version !== undefined && j.version.length > 0 && parseVersion(j.version) !== null) {
      return j.version
    }
  } catch {
    // ignore
  }
  // 2) The desktop executable's FileVersion (e.g. 0.1.0-rc.5).
  try {
    const v = await detectFromExecutable()
    if (v !== null) return v
  } catch {
    // ignore
  }
  // 3) A desktop checkout's upstream.json pin.
  if (cfg.desktopRepoPath.length > 0) {
    try {
      const raw = await readFile(join(cfg.desktopRepoPath, 'upstream.json'), 'utf8')
      const j = JSON.parse(raw) as { sourceVersion?: string }
      if (j.sourceVersion !== undefined) return j.sourceVersion
    } catch {
      // ignore
    }
  }
  return null
}

/**
 * Run `npm install` in a directory and resolve when the dependency tree is ready.
 */
function runNpmInstall(cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const cmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    execFile(cmd, ['install', '--no-audit', '--no-fund', '--loglevel=error'], {
      cwd,
      windowsHide: true,
      shell: true,
      timeout: 600_000,
      maxBuffer: 16 * 1024 * 1024,
    }, (error, _stdout, stderr) => {
      if (error !== null) reject(new Error(`npm install failed: ${error.message}${stderr.length > 0 ? '\n' + stderr : ''}`))
      else resolve()
    })
  })
}

/**
 * Read the running desktop host's dependency-only deploy root package.json.
 */
async function readHostPackage(): Promise<{ version: string; description?: string; dependencies: Record<string, string> }> {
  const hostPkgPath = join(dirname(process.execPath), 'resources', 'host', 'package.json')
  const raw = await readFile(hostPkgPath, 'utf8')
  const pkg = JSON.parse(raw) as { version?: string; description?: string; dependencies?: Record<string, string> }
  if (pkg.version === undefined || pkg.dependencies === undefined) throw new Error('host package.json is missing version or dependencies')
  return { version: pkg.version, description: pkg.description, dependencies: pkg.dependencies }
}

/**
 * Make sure the staging engine directory contains a deploy-ready engine of
 * exactly `targetVersion`. If it does, returns immediately; otherwise it
 * regenerates the dependency-only host from the running app's package.json,
 * runs `npm install`, verifies the result, and swaps it into the staging dir.
 */
async function ensureStagingEngine(cfg: UpdateCheckConfig, targetVersion: string): Promise<void> {
  const stagingDir = (cfg.engineStagingDir ?? '').length > 0 ? cfg.engineStagingDir : dshHomePath('update-check-plus', 'engine')
  const stagedPkgPath = join(stagingDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
  try {
    const staged = JSON.parse(await readFile(stagedPkgPath, 'utf8')) as { version?: string }
    if (staged.version === targetVersion) return
  } catch {
    // missing or unreadable: rebuild below
  }
  const preparingDir = stagingDir + '.preparing'
  await rm(preparingDir, { recursive: true, force: true })
  await mkdir(preparingDir, { recursive: true })
  const hostPkg = await readHostPackage()
  const deps: Record<string, string> = {}
  for (const [name, range] of Object.entries(hostPkg.dependencies)) {
    deps[name] = name.startsWith('@deepseek-ai/dsh') && range.startsWith('^0.1.') ? '^' + targetVersion : range
  }
  const prepared = {
    name: '@deepseek-ai/dsh-desktop-runtime',
    description: `Dependency-only deploy root for the packaged desktop Host (upgraded to ${targetVersion})`,
    version: targetVersion,
    private: true,
    type: 'module',
    dependencies: deps,
  }
  await writeFile(join(preparingDir, 'package.json'), JSON.stringify(prepared, null, 2), 'utf8')
  await runNpmInstall(preparingDir)
  const installedPkgPath = join(preparingDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
  const installed = JSON.parse(await readFile(installedPkgPath, 'utf8')) as { version?: string }
  if (installed.version !== targetVersion) throw new Error(`staging engine install produced ${installed.version ?? 'unknown'}, expected ${targetVersion}`)
  const oldDir = stagingDir + '.old'
  await rm(oldDir, { recursive: true, force: true })
  if (existsSync(stagingDir)) await rename(stagingDir, oldDir)
  await rename(preparingDir, stagingDir)
  await rm(oldDir, { recursive: true, force: true })
}


function serveJson(res: ServerResponse, data: unknown, status = 200): void {
  const body = JSON.stringify(data)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.end(body)
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk: Buffer) => { data += chunk.toString('utf8') })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

/**
 * Compose the update-check-plus host capabilities for one plugin fiber.
 * @param ctx - Cordis context owning every effect below.
 * @param config - composition entry config (possibly partial).
 */
export function apply(ctx: Context, config: Partial<UpdateCheckConfig> = {}): void {
  const base: UpdateCheckConfig = {
    repo: config.repo ?? 'deepseek-ai/deepseek-harness',
    intervalHours: config.intervalHours ?? 12,
    autoDownload: config.autoDownload ?? false,
    downloadDir: config.downloadDir ?? dshHomePath('update-check-plus', 'downloads'),
    engineStagingDir: config.engineStagingDir ?? dshHomePath('update-check-plus', 'engine'),
    desktopRepoPath: config.desktopRepoPath ?? '',
    enableDesktopUpdate: config.enableDesktopUpdate ?? false,
    desktopVersionEndpoint: config.desktopVersionEndpoint ?? 'https://www.dshdesktop.cn/api/desktop/version',
    desktopDownloadEndpoint: config.desktopDownloadEndpoint ?? 'https://www.dshdesktop.cn/api/downloads/windows',
  }

  let current: () => UpdateCheckConfig = () => base
  installSettingsSection(ctx, NS, Config, base, {
    setSource: (source) => { current = source },
    onChange: () => {},
  })

  const logger = ctx.logger('update-check-plus')
  const statePath = dshHomePath('update-check-plus', 'state.json')
  let state: UpdateCheckState = emptyState()
  let versionPromise: Promise<string | null> | null = null

  const resolveCurrentVersion = (): Promise<string | null> => {
    versionPromise ??= detectCurrentVersion(current())
    return versionPromise
  }

  const downloadLatest = async (cfg: UpdateCheckConfig, tag: string): Promise<string | null> => {
    const dir = (cfg.downloadDir ?? '').length > 0 ? cfg.downloadDir : dshHomePath('update-check-plus', 'downloads')
    await mkdir(dir, { recursive: true })
    const dest = join(dir, tag + '.zip')
    if (existsSync(dest)) return dest
    const bytes = await downloadZipball(cfg.repo, tag, dest)
    state = {
      ...state,
      downloads: [...state.downloads, { tag, path: dest, bytes, at: new Date().toISOString() }].slice(-10),
    }
    await saveState(statePath, state)
    logger.info(`downloaded ${tag} -> ${dest} (${bytes} bytes)`)
    return dest
  }

  let retryTimer: ReturnType<typeof setTimeout> | null = null
  const scheduleRetry = (): void => {
    if (retryTimer !== null) return
    // The unauthenticated GitHub API quota resets hourly; retry shortly after.
    retryTimer = setTimeout(() => {
      retryTimer = null
      void check()
    }, 60 * 60_000)
  }

  let desktopFlowRunning = false
  let upgradeRunning = false
  const desktopUpdateFlow = async (cfg: UpdateCheckConfig): Promise<void> => {
    if (desktopFlowRunning) return
    desktopFlowRunning = true
    try {
      const target = state.desktopVersion
      if (target === null) throw new Error('desktop version unknown; run a check first')
      state = {
        ...state,
        desktopDownload: {
          version: target,
          status: 'downloading',
          received: 0,
          total: 0,
          path: null,
          error: null,
        },
      }
      await saveState(statePath, state)
      const destDir = (cfg.downloadDir ?? '').length > 0 ? cfg.downloadDir : dshHomePath('update-check-plus', 'downloads')
      const installerPath = await downloadInstaller(cfg.desktopDownloadEndpoint, destDir, (progress) => {
        state = {
          ...state,
          desktopDownload: {
            ...state.desktopDownload,
            status: 'downloading',
            received: progress.received,
            total: progress.total,
          },
        }
        void saveState(statePath, state)
      })
      state = {
        ...state,
        desktopDownload: {
          ...state.desktopDownload,
          status: 'downloaded',
          received: 0,
          total: 0,
          path: installerPath,
        },
      }
      await saveState(statePath, state)
      logger.info(`desktop update installer ready: ${installerPath}`)
      state = {
        ...state,
        desktopDownload: { ...state.desktopDownload, status: 'installing' },
      }
      await saveState(statePath, state)
      launchInstallerAndExit(installerPath)
    } catch (err) {
      state = {
        ...state,
        desktopDownload: {
          ...state.desktopDownload,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        },
      }
      await saveState(statePath, state)
      logger.warn(`desktop update flow failed: ${state.desktopDownload.error}`)
      desktopFlowRunning = false
    }
  }

  const check = async (): Promise<UpdateCheckState> => {
    try {
      const cfg = current()
      const currentVersion = await resolveCurrentVersion()
      // GitHub source channel and desktop installer channel run in parallel;
      // each one persists its own part as soon as it finishes, so the UI
      // never waits for the slower channel.
      const [ghResult] = await Promise.allSettled([
        (async (): Promise<void> => {
          const releases = await fetchReleases(cfg.repo, 5)
          if (releases.length === 0) throw new Error('no releases found')
      const candidates: Array<{ release: GitHubRelease; parsed: NonNullable<ReturnType<typeof parseVersion>> }> = []
      for (const release of releases) {
        const parsed = parseVersion(release.tag)
        if (parsed !== null) candidates.push({ release, parsed })
      }
      const latest = candidates[0] ?? null
      let updateAvailable = false
      if (currentVersion !== null && latest !== null) {
        const cur = parseVersion(currentVersion)
        if (cur !== null) updateAvailable = compareVersions(latest.parsed, cur) > 0
      }
      state = {
        ...state,
        currentVersion,
        latestTag: latest?.release.tag ?? null,
        latestName: latest?.release.name ?? null,
        latestPublishedAt: latest?.release.publishedAt ?? null,
        latestBody: latest !== null ? latest.release.body.slice(0, 2000) : null,
        latestUrl: latest?.release.htmlUrl ?? null,
        updateAvailable,
        lastCheckedAt: new Date().toISOString(),
        lastCheckOk: true,
        lastError: null,
      }
          await saveState(statePath, state)
        })(),
        (async (): Promise<void> => {
          if (!cfg.enableDesktopUpdate) return
          try {
            const desktopVersion = await fetchDesktopVersion(cfg.desktopVersionEndpoint)
            let desktopUpdateAvailable = false
            if (desktopVersion !== null && currentVersion !== null) {
              const cur = parseVersion(currentVersion)
              const latestDesktop = parseVersion(desktopVersion)
              if (cur !== null && latestDesktop !== null) {
                desktopUpdateAvailable = compareVersions(latestDesktop, cur) > 0
              }
            }
            state = {
              ...state,
              desktopVersion,
              desktopUpdateAvailable,
              desktopLastCheckedAt: new Date().toISOString(),
              desktopError: null,
            }
            await saveState(statePath, state)
          } catch (err) {
            state = {
              ...state,
              desktopError: err instanceof Error ? err.message : String(err),
              desktopLastCheckedAt: new Date().toISOString(),
            }
            await saveState(statePath, state)
          }
        })(),
      ])

      if (ghResult.status === 'rejected') {
        state = {
          ...state,
          lastCheckOk: false,
          lastError: ghResult.reason instanceof Error ? ghResult.reason.message : String(ghResult.reason),
          lastCheckedAt: new Date().toISOString(),
        }
        await saveState(statePath, state)
        logger.warn(`check failed: ${state.lastError}`)
        scheduleRetry()
      } else {
        if (state.updateAvailable && cfg.autoDownload && state.latestTag !== null) {
          await downloadLatest(cfg, state.latestTag)
        }
        logger.info(`check ok: current=${currentVersion} latest=${state.latestTag} update=${state.updateAvailable} desktop=${state.desktopVersion} desktopUpdate=${state.desktopUpdateAvailable}`)
      }
    } catch (err) {
      state = {
        ...state,
        lastCheckOk: false,
        lastError: err instanceof Error ? err.message : String(err),
        lastCheckedAt: new Date().toISOString(),
      }
      await saveState(statePath, state)
      logger.warn(`check failed: ${state.lastError}`)
      scheduleRetry()
    }
    return state
  }

  // First check shortly after boot, then on the configured cadence. The
  // persisted snapshot is loaded into memory first so the UI immediately
  // shows the last known result instead of an empty state.
  ctx.effect(() => {
    let disposed = false
    let boot: ReturnType<typeof setTimeout> | null = null
    let interval: ReturnType<typeof setInterval> | null = null
    void loadState(statePath).then((s) => {
      if (disposed) return
      state = s
      boot = setTimeout(() => { void check() }, 1000)
      const intervalMs = Math.min(Math.max(1, base.intervalHours) * 3600_000, 2147483647)
      interval = setInterval(() => { void check() }, intervalMs)
    })
    return () => {
      disposed = true
      if (boot !== null) clearTimeout(boot)
      if (interval !== null) clearInterval(interval)
    }
  }, 'update-check-plus: scheduler')

  // Web surface: state snapshot + two POST actions (re-check, download latest).
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.webServer.register({
      kind: 'exact',
      path: '/dsh-update-check-plus/state.json',
      handler: (_req, res) => { serveJson(res, state) },
    })
    webCtx.webServer.register({
      kind: 'exact',
      path: '/dsh-update-check-plus/actions/check',
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        await readBody(req)
        serveJson(res, await check())
      },
    })
    webCtx.webServer.register({
      kind: 'exact',
      path: '/dsh-update-check-plus/actions/download',
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        await readBody(req)
        try {
          const cfg = current()
          const tag = state.latestTag
          const path = tag !== null ? await downloadLatest(cfg, tag) : null
          serveJson(res, { ok: true, path })
        } catch (err) {
          serveJson(res, { ok: false, error: err instanceof Error ? err.message : String(err) }, 500)
        }
      },
    })
    webCtx.webServer.register({
      kind: 'exact',
      path: '/dsh-update-check-plus/actions/desktop-update',
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        await readBody(req)
        if (state.desktopUpdateAvailable && !desktopFlowRunning) {
          void desktopUpdateFlow(current())
        }
        serveJson(res, { ok: true, started: desktopFlowRunning || state.desktopDownload.status === 'installing' })
      },
    })

    webCtx.webServer.register({
      kind: 'exact',
      path: '/dsh-update-check-plus/actions/upgrade',
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        await readBody(req)
        if (upgradeRunning) {
          serveJson(res, { ok: false, error: 'upgrade already running' }, 409)
          return
        }
        try {
          const cfg = current()
          const want = state.latestTag !== null ? state.latestTag.replace(/^dsh-v/, '') : null
          if (want === null) throw new Error('no known latest version; run a check first')
          upgradeRunning = true
          const stagingDir = (cfg.engineStagingDir ?? '').length > 0 ? cfg.engineStagingDir : dshHomePath('update-check-plus', 'engine')
          await ensureStagingEngine(cfg, want)
          const enginePkgPath = join(stagingDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
          const pkg = JSON.parse(await readFile(enginePkgPath, 'utf8')) as { version?: string }
          const stagingVersion = pkg.version ?? ''
          if (stagingVersion !== want) throw new Error('staging engine is ' + stagingVersion + ', expected ' + want)
          const appDir = dirname(process.execPath)
          const scriptPath = join(stagingDir, 'upgrade.ps1')
          await writeFile(scriptPath, buildUpgradeScript(appDir, stagingDir, stagingVersion), 'utf8')
          launchUpgradeViaTaskScheduler(scriptPath)
          logger.info('one-click upgrade launched: ' + stagingVersion)
          serveJson(res, { ok: true, stagingVersion, upgrading: true })
        } catch (err) {
          upgradeRunning = false
          serveJson(res, { ok: false, error: err instanceof Error ? err.message : String(err) }, 500)
        }
      },
    })
  })
}
