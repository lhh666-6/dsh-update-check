/**
 * DSH Desktop update channel (dshdesktop.cn): the update service that
 * distributes this desktop application family. The version endpoint reports
 * the latest stable desktop version; the download endpoint 302-redirects to
 * the current installer (GitCode / ModelScope CDN). Installation mirrors the
 * app's own coordinator: spawn the NSIS installer with --updated --force-run,
 * then release the host so the shell quits and the installer takes over.
 */

import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const UA = 'dsh-update-check-plus/0.1.0'

/** Fetch the latest desktop version from the service: {"version":"2.0.0"}. */
export async function fetchDesktopVersion(endpoint: string): Promise<string | null> {
  const res = await fetch(endpoint, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
    redirect: 'error',
  })
  if (!res.ok) return null
  const body = (await res.text()).slice(0, 4096)
  try {
    const j = JSON.parse(body) as { version?: unknown }
    return typeof j.version === 'string' && j.version.length > 0 ? j.version : null
  } catch {
    return null
  }
}

export interface DownloadProgress {
  received: number
  total: number
}

/**
 * Download the current installer, following the service's redirect chain,
 * streaming to disk and reporting progress.
 * @returns the local artifact path.
 */
export async function downloadInstaller(
  endpoint: string,
  destDir: string,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<string> {
  await mkdir(destDir, { recursive: true })
  const res = await fetch(endpoint, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(30 * 60_000),
    redirect: 'follow',
  })
  if (!res.ok) throw new Error('installer download HTTP ' + res.status)
  const total = Number(res.headers.get('content-length') ?? 0) || 0
  const disposition = res.headers.get('content-disposition') ?? ''
  const nameMatch = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)
  const fileName = nameMatch !== null ? nameMatch[1].replace(/"/g, '') : 'dsh-desktop-setup.exe'
  const dest = join(destDir, fileName)
  const tmp = dest + '.tmp'
  const file = createWriteStream(tmp)
  const reader = res.body?.getReader()
  if (reader === undefined) throw new Error('installer response has no body')
  let received = 0
  let lastReport = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value !== undefined) {
        received += value.byteLength
        file.write(Buffer.from(value))
        if (received - lastReport >= 2 * 1024 * 1024) {
          lastReport = received
          onProgress?.({ received, total })
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
  await new Promise<void>((resolve, reject) => {
    file.end((err?: Error | null) => (err !== undefined && err !== null ? reject(err) : resolve()))
  })
  await rename(tmp, dest)
  onProgress?.({ received, total })
  return dest
}

/**
 * Launch the NSIS installer the way the app's own update coordinator does,
 * then release this host process so the shell quits and the installer can
 * replace the running files.
 */
export function launchInstallerAndExit(installerPath: string, hostExitDelayMs = 3000): void {
  const child = spawn(installerPath, ['--updated', '--force-run'], {
    detached: true,
    stdio: 'ignore',
    shell: false,
    windowsHide: false,
  })
  child.unref()
  setTimeout(() => {
    try {
      process.exit(0)
    } catch {
      // the host may already be winding down
    }
  }, hostExitDelayMs)
}

export { dirname, join }
