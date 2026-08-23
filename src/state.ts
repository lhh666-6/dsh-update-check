/**
 * Persistent check state, stored under the DSH home so both the host route
 * and the web client can read one consistent snapshot.
 */

export interface DownloadRecord {
  tag: string
  path: string
  bytes: number
  at: string
}

export interface DesktopDownloadState {
  version: string | null
  status: 'idle' | 'downloading' | 'downloaded' | 'installing' | 'error'
  received: number
  total: number
  path: string | null
  error: string | null
}

export interface UpdateCheckState {
  currentVersion: string | null
  latestTag: string | null
  latestName: string | null
  latestPublishedAt: string | null
  latestBody: string | null
  latestUrl: string | null
  updateAvailable: boolean
  lastCheckedAt: string | null
  lastCheckOk: boolean
  lastError: string | null
  downloads: DownloadRecord[]
  desktopVersion: string | null
  desktopUpdateAvailable: boolean
  desktopLastCheckedAt: string | null
  desktopError: string | null
  desktopDownload: DesktopDownloadState
}

export function emptyState(): UpdateCheckState {
  return {
    currentVersion: null,
    latestTag: null,
    latestName: null,
    latestPublishedAt: null,
    latestBody: null,
    latestUrl: null,
    updateAvailable: false,
    lastCheckedAt: null,
    lastCheckOk: false,
    lastError: null,
    downloads: [],
    desktopVersion: null,
    desktopUpdateAvailable: false,
    desktopLastCheckedAt: null,
    desktopError: null,
    desktopDownload: {
      version: null,
      status: 'idle',
      received: 0,
      total: 0,
      path: null,
      error: null,
    },
  }
}

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { dirname } from 'node:path'

export async function loadState(path: string): Promise<UpdateCheckState> {
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw) as Partial<UpdateCheckState>
    return { ...emptyState(), ...parsed, downloads: parsed.downloads ?? [] }
  } catch {
    return emptyState()
  }
}

export async function saveState(path: string, state: UpdateCheckState): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const body = JSON.stringify(state, null, 2)
  // Direct write with retry: Windows can transiently fail a tmp+rename
  // (AV scanning / slow NTFS flush), and a torn state file is non-fatal.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await writeFile(path, body, 'utf8')
      return
    } catch (err) {
      if (attempt === 2) throw err
      await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)))
    }
  }
}
