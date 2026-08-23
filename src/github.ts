/**
 * Release discovery with a multi-source cascade so the plugin works from
 * shared/NAT IPs and networks that only reach part of GitHub:
 *   1. REST API  (rich body/date; unauthenticated quota 60/h per IP)
 *   2. atom feed (no quota, but github.com itself may be unreachable)
 *   3. raw master version (apps/web/package.json on the default branch)
 */

export interface GitHubRelease {
  tag: string
  name: string
  publishedAt: string | null
  prerelease: boolean
  body: string
  htmlUrl: string
  /** Which source produced this entry: 'api' | 'atom' | 'master'. */
  source: string
}

const UA = 'dsh-update-check-plus/0.1.0'

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

interface AtomEntry {
  title: string
  updated: string
  link: string
  summary: string
}

function parseAtom(xml: string): AtomEntry[] {
  const entries: AtomEntry[] = []
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g
  let m: RegExpExecArray | null
  while ((m = entryRe.exec(xml)) !== null) {
    const block = m[1]
    const grab = (name: string): string => {
      const re = new RegExp('<' + name + '(?:[^>]*)?>([\s\S]*?)<\/' + name + '>')
      const mm = re.exec(block)
      return mm !== null ? decodeXml(mm[1].trim()) : ''
    }
    const linkRe = /<link[^>]*href="([^"]+)"/.exec(block)
    entries.push({
      title: grab('title'),
      updated: grab('updated'),
      link: linkRe !== null ? decodeXml(linkRe[1]) : '',
      summary: grab('summary'),
    })
  }
  return entries
}

async function fetchFromApi(repo: string, limit: number): Promise<GitHubRelease[]> {
  const url = 'https://api.github.com/repos/' + repo + '/releases?per_page=' + limit
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error('GitHub API HTTP ' + res.status)
  const data = (await res.json()) as Array<{
    tag_name?: string
    name?: string
    published_at?: string | null
    prerelease?: boolean
    body?: string | null
    html_url?: string
  }>
  return data.map((r) => ({
    tag: r.tag_name ?? '',
    name: r.name ?? '',
    publishedAt: r.published_at ?? null,
    prerelease: Boolean(r.prerelease),
    body: r.body ?? '',
    htmlUrl: r.html_url ?? 'https://github.com/' + repo + '/releases',
    source: 'api',
  })).filter((r) => r.tag.length > 0)
}

async function fetchFromAtom(repo: string, limit: number): Promise<GitHubRelease[]> {
  const feedUrl = 'https://github.com/' + repo + '/releases.atom'
  const feedRes = await fetch(feedUrl, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(5000),
  })
  if (!feedRes.ok) throw new Error('atom HTTP ' + feedRes.status)
  const xml = await feedRes.text()
  const releases = parseAtom(xml).slice(0, limit).map((entry) => ({
    tag: entry.title,
    name: entry.title,
    publishedAt: entry.updated.length > 0 ? entry.updated : null,
    prerelease: /-rc\./i.test(entry.title),
    body: stripTags(entry.summary),
    htmlUrl: entry.link.length > 0 ? entry.link : 'https://github.com/' + repo + '/releases',
    source: 'atom',
  }))
  if (releases.length === 0) throw new Error('atom: no entries')
  return releases.filter((r) => r.tag.length > 0)
}

/** Last-resort signal: the version on the default branch, read via raw. */
async function fetchFromMaster(repo: string): Promise<GitHubRelease> {
  const url = 'https://raw.githubusercontent.com/' + repo + '/master/apps/web/package.json'
  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error('raw HTTP ' + res.status)
  const pkg = (await res.json()) as { version?: string }
  const version = pkg.version
  if (version === undefined || version.length === 0) throw new Error('raw: no version')
  return {
    tag: version,
    name: 'master 分支最新版本',
    publishedAt: null,
    prerelease: true,
    body: 'GitHub API 配额受限，本次检查来自 master 分支的版本号（apps/web/package.json）。',
    htmlUrl: 'https://github.com/' + repo + '/releases',
    source: 'master',
  }
}

/**
 * Fetch the newest releases. Tries API, then atom, then master-version.
 * Never throws when at least the master fallback produced a signal.
 */
export async function fetchReleases(repo: string, limit = 5): Promise<GitHubRelease[]> {
  try {
    return await fetchFromApi(repo, limit)
  } catch {
    // fall through
  }
  // API failed (quota/network): race the atom feed and the master-version
  // signal so a slow or blocked github.com cannot stall the whole check.
  try {
    return await Promise.any([
      fetchFromAtom(repo, limit),
      fetchFromMaster(repo).then((r) => [r]),
    ])
  } catch {
    return [await fetchFromMaster(repo)]
  }
}

export async function downloadZipball(repo: string, tag: string, dest: string): Promise<number> {
  const url = 'https://codeload.github.com/' + repo + '/zip/refs/tags/' + encodeURIComponent(tag)
  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(300000),
    redirect: 'follow',
  })
  if (!res.ok) throw new Error('codeload HTTP ' + res.status)
  const buf = Buffer.from(await res.arrayBuffer())
  const tmp = dest + '.tmp'
  await writeFile(tmp, buf)
  await rename(tmp, dest)
  return buf.length
}

import { rename, writeFile } from 'node:fs/promises'
