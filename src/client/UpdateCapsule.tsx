/**
 * UpdateCapsule: status pill plus a detail panel. Primary surface is the
 * DSH Desktop update channel (real installers via dshdesktop.cn); secondary
 * is the GitHub source channel. State comes from the host route
 * (/dsh-update-check-plus/state.json); when unreachable it falls back to a direct
 * GitHub query so latest-version info still shows.
 */

import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'

interface CapsuleProps { wide?: boolean }

interface DesktopDownloadState {
  version: string | null
  status: 'idle' | 'downloading' | 'downloaded' | 'installing' | 'error'
  received: number
  total: number
  path: string | null
  error: string | null
}

interface ClientState {
  currentVersion: string | null
  latestTag: string | null
  latestName: string | null
  latestPublishedAt: string | null
  latestBody: string | null
  latestUrl: string | null
  updateAvailable: boolean
  lastCheckedAt: string | null
  lastError: string | null
  downloads: Array<{ tag: string; path: string; bytes: number; at: string }>
  desktopVersion: string | null
  desktopUpdateAvailable: boolean
  desktopLastCheckedAt: string | null
  desktopError: string | null
  desktopDownload: DesktopDownloadState
}

const STATE_ROUTE = '/dsh-update-check-plus/state.json'
const CHECK_ACTION = '/dsh-update-check-plus/actions/check'
const DOWNLOAD_ACTION = '/dsh-update-check-plus/actions/download'
const DESKTOP_UPDATE_ACTION = '/dsh-update-check-plus/actions/desktop-update'
const UPGRADE_ACTION = '/dsh-update-check-plus/actions/upgrade'
const OFFICIAL_PAGE = 'https://www.dshdesktop.cn/'

const AMBER = 'var(--dsw-alias-state-warn-primary)'
const GREEN = 'var(--dsw-alias-state-success-primary)'
const RED = 'var(--dsw-alias-state-error-primary)'
const GRAY = 'var(--dsw-alias-label-tertiary)'

const capsuleStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '3px 10px',
  borderRadius: 999,
  border: '1px solid var(--dsw-alias-border-l3)',
  background: 'var(--dsw-alias-bg-overlay)',
  color: 'var(--dsw-alias-label-secondary)',
  font: 'inherit',
  fontSize: 12,
  lineHeight: 1.3,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  userSelect: 'none',
}

const panelStyle: CSSProperties = {
  position: 'fixed',
  left: 0,
  right: 0,
  bottom: 0,
  margin: '0 auto',
  maxWidth: 640,
  boxSizing: 'border-box',
  zIndex: 1000,
  width: 'auto',
  padding: 14,
  borderRadius: '12px 12px 0 0',
  border: '1px solid var(--dsw-alias-border-l3)',
  borderBottom: 'none',
  background: 'var(--dsw-specific-menu)',
  color: 'var(--dsw-alias-label-primary)',
  boxShadow: '0 -8px 24px var(--dsw-alias-bg-mask-1)',
  fontSize: 12.5,
  lineHeight: 1.5,
  maxHeight: '70vh',
  overflowY: 'auto',
}

const rowStyle: CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '2px 0' }
const labelStyle: CSSProperties = { color: 'var(--dsw-alias-label-secondary)' }
const valueStyle: CSSProperties = { fontVariantNumeric: 'tabular-nums', color: 'var(--dsw-alias-label-primary)' }
const mutedStyle: CSSProperties = { color: 'var(--dsw-alias-label-tertiary)', padding: '2px 0' }
const notesStyle: CSSProperties = {
  margin: '6px 0 0',
  maxHeight: 150,
  overflowY: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  fontSize: 11.5,
  color: 'var(--dsw-alias-label-secondary)',
  borderTop: '1px solid var(--dsw-alias-border-l2)',
  paddingTop: 8,
}
const btnRowStyle: CSSProperties = { display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }
const btnStyle: CSSProperties = {
  padding: '4px 10px',
  borderRadius: 8,
  border: '1px solid var(--dsw-alias-border-l3)',
  background: 'var(--dsw-alias-bg-overlay)',
  color: 'var(--dsw-alias-label-primary)',
  cursor: 'pointer',
  fontSize: 12,
}
const primaryBtnStyle: CSSProperties = {
  ...btnStyle,
  background: 'var(--dsw-alias-state-warn-primary)',
  borderColor: 'var(--dsw-alias-state-warn-primary)',
  color: '#fff',
  fontWeight: 600,
}
const sectionTitleStyle: CSSProperties = {
  margin: '8px 0 4px',
  fontSize: 11,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--dsw-alias-label-caption)',
}
const progressTrack: CSSProperties = { height: 6, borderRadius: 3, background: 'var(--dsw-alias-border-l2)', overflow: 'hidden', margin: '4px 0' }
const progressFill: CSSProperties = { height: '100%', background: AMBER, transition: 'width 0.3s' }

async function fetchJson<T>(url: string, timeoutMs = 8000, method: 'GET' | 'POST' = 'GET'): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { method, signal: controller.signal, headers: { Accept: 'application/json' } })
    if (!res.ok) {
      let detail = ''
      try { detail = String(((await res.json()) as { error?: unknown })?.error ?? '') } catch { /* body not json */ }
      throw new Error('HTTP ' + res.status + (detail.length > 0 ? ': ' + detail : ''))
    }
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

function Row({ label, value, valueColor }: { label: string; value: string; valueColor?: string }): ReactElement {
  return (
    <div style={rowStyle}>
      <span style={labelStyle}>{label}</span>
      <span style={valueColor !== undefined ? { ...valueStyle, color: valueColor } : valueStyle}>{value}</span>
    </div>
  )
}

export function UpdateCapsule(props: CapsuleProps): ReactElement | null {
  const { wide } = props
  const [state, setState] = useState<ClientState | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [upgrading, setUpgrading] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const host = await fetchJson<ClientState>(STATE_ROUTE)
      setState(host)
      return
    } catch {
      // route unreachable: fall through to the GitHub direct query
    }
    try {
      const res = await fetch('https://api.github.com/repos/deepseek-ai/deepseek-harness/releases?per_page=1', {
        headers: { Accept: 'application/json' },
      })
      const data = (await res.json()) as Array<{ tag_name?: string; name?: string; published_at?: string | null; body?: string | null; html_url?: string }>
      const first = data[0]
      setState({
        currentVersion: null,
        latestTag: first?.tag_name ?? null,
        latestName: first?.name ?? '',
        latestPublishedAt: first?.published_at ?? null,
        latestBody: (first?.body ?? '').slice(0, 2000),
        latestUrl: first?.html_url ?? null,
        updateAvailable: false,
        lastCheckedAt: null,
        lastError: null,
        downloads: [],
        desktopVersion: null,
        desktopUpdateAvailable: false,
        desktopLastCheckedAt: null,
        desktopError: null,
        desktopDownload: { version: null, status: 'idle', received: 0, total: 0, path: null, error: null },
      })
    } catch {
      setState(null)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => { void refresh() }, 10 * 1000)
    return () => clearInterval(timer)
  }, [refresh])

  if (state === null) return null

  const dd = state.desktopDownload
  const desktopUpdating = dd.status === 'downloading' || dd.status === 'installing'
  const hasDesktopUpdate = state.desktopUpdateAvailable || desktopUpdating || dd.status === 'error' || dd.status === 'downloaded'

  const checking = state.lastCheckedAt === null
  const capsuleColor = checking ? GRAY : state.desktopUpdateAvailable ? AMBER : desktopUpdating ? AMBER : state.updateAvailable ? AMBER : GREEN
  const label = desktopUpdating
    ? '⏳ 更新 ' + (dd.version ?? '')
    : state.desktopUpdateAvailable
      ? '⬆ ' + state.desktopVersion
      : state.updateAvailable
        ? '⬆ ' + state.latestTag
        : state.currentVersion !== null
          ? '✓ ' + state.currentVersion
          : checking
            ? '检查中…'
            : 'dsh'

  const trigger = async (action: string, timeoutMs = 8000): Promise<void> => {
    setBusy(true)
    setActionError(null)
    try {
      await fetchJson<{ ok?: boolean }>(action, timeoutMs, 'POST')
      await refresh()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const doUpgrade = async (): Promise<void> => {
    setBusy(true)
    setActionError(null)
    try {
      await fetchJson<{ ok?: boolean }>(UPGRADE_ACTION, 600000, 'POST')
      setUpgrading(true)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const pct = dd.total > 0 ? Math.min(100, Math.round((dd.received / dd.total) * 100)) : 0

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        style={{ ...capsuleStyle, color: capsuleColor }}
        onClick={() => setOpen(!open)}
        title="DSH 更新检查"
      >
        <span style={{ width: 6, height: 6, borderRadius: 999, background: capsuleColor, display: 'inline-block' }} />
        {wide === false ? null : label}
      </button>
      {open && (
        <div style={panelStyle}>
          {hasDesktopUpdate && (
            <>
              <div style={sectionTitleStyle}>桌面端更新</div>
              <Row
                label="当前版本"
                value={state.currentVersion ?? '未知'}
              />
              <Row
                label="最新版本"
                value={state.desktopVersion ?? '—'}
                valueColor={state.desktopUpdateAvailable ? AMBER : undefined}
              />
              {dd.status === 'downloading' && (
                <>
                  <div style={progressTrack}>
                    <div style={{ ...progressFill, width: pct + '%' }} />
                  </div>
                  <div style={mutedStyle}>
                    下载中 {dd.total > 0 ? ((dd.received / 1048576).toFixed(1) + ' / ' + (dd.total / 1048576).toFixed(1) + ' MB') : '…'}
                  </div>
                </>
              )}
              {dd.status === 'installing' && <div style={mutedStyle}>安装器已启动，应用即将重启完成安装…</div>}
              {dd.status === 'error' && <div style={{ ...mutedStyle, color: RED }}>下载失败：{dd.error}</div>}
              {state.desktopUpdateAvailable && dd.status !== 'downloading' && dd.status !== 'installing' && (
                <div style={btnRowStyle}>
                  <button
                    type="button"
                    style={primaryBtnStyle}
                    disabled={busy}
                    onClick={() => { void trigger(DESKTOP_UPDATE_ACTION, 15000) }}
                  >
                    {busy ? '启动中…' : '下载并更新（约 160MB）'}
                  </button>
                  <button type="button" style={btnStyle} onClick={() => { window.open(OFFICIAL_PAGE, '_blank') }}>
                    官网
                  </button>
                </div>
              )}
              {state.desktopUpdateAvailable && dd.status === 'downloaded' && (
                <div style={mutedStyle}>安装器已就绪：{dd.path}</div>
              )}
              {!state.desktopUpdateAvailable && dd.status !== 'error' && dd.status !== 'installing' && (
                <div style={mutedStyle}>桌面端已是最新版本。</div>
              )}
            </>
          )}
          <div style={sectionTitleStyle}>源码更新（GitHub）</div>
          {state.updateAvailable && state.latestTag !== null && !upgrading && (
            <div style={btnRowStyle}>
              <button
                type="button"
                style={primaryBtnStyle}
                disabled={busy}
                onClick={() => { void doUpgrade() }}
              >
                {busy ? '准备中…' : '一键更新到 ' + state.latestTag + '（自动重启）'}
              </button>
            </div>
          )}
          {upgrading && (
            <div style={{ ...mutedStyle, color: AMBER }}>
              升级已启动：应用将在几秒后自动关闭并重启，请稍候…（引擎将替换为最新版）
            </div>
          )}
          <Row label="最新 tag" value={state.latestTag ?? '—'} />
          {state.latestPublishedAt !== null && <Row label="发布时间" value={state.latestPublishedAt.slice(0, 10)} />}
          {state.lastCheckedAt !== null && <Row label="上次检查" value={state.lastCheckedAt.slice(0, 16).replace('T', ' ')} />}
          {state.lastError !== null && <div style={mutedStyle}>检查异常：{state.lastError}</div>}
          {state.downloads.length > 0 && (
            <div style={mutedStyle}>
              已下载源码：{state.downloads[state.downloads.length - 1].tag}（
              {(state.downloads[state.downloads.length - 1].bytes / 1048576).toFixed(1)} MB）
            </div>
          )}
          {state.latestBody !== null && state.latestBody.length > 0 && (
            <div style={notesStyle}>{state.latestBody.slice(0, 600)}</div>
          )}
          <div style={btnRowStyle}>
            <button type="button" style={btnStyle} disabled={busy} onClick={() => { void trigger(CHECK_ACTION) }}>
              {busy ? '…' : '立即检查'}
            </button>
            <button type="button" style={btnStyle} disabled={busy} onClick={() => { void trigger(DOWNLOAD_ACTION) }}>
              下载源码
            </button>
            {state.latestUrl !== null && (
              <button type="button" style={btnStyle} onClick={() => { window.open(state.latestUrl!, '_blank') }}>
                打开 Release
              </button>
            )}
          </div>
          {actionError !== null && <div style={{ ...mutedStyle, color: RED }}>操作失败：{actionError}</div>}
        </div>
      )}
    </div>
  )
}
