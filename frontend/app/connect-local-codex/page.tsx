'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { buildBridgeGuide } from '@/lib/bridgeGuide'
import { summarizeHealthPayload } from '@/lib/connectDiagnostics'
import { shouldAutoEnterWorkspace } from '@/lib/connectFlow'
import {
  clearBrowserBackendOverride,
  readBrowserBackendOverride,
  resolveApiUrl,
  resolveBrowserWsUrl,
  saveBrowserBackendOverride,
} from '@/lib/runtimeConfig'

interface DiagnosticCheck {
  label: string
  status: string
  detail: string
  url?: string
}

type HealthState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'ok'; details: string; checks: Record<string, DiagnosticCheck> }
  | { status: 'error'; details: string; checks?: Record<string, DiagnosticCheck> }

const DEFAULT_LOCAL_ENDPOINT = 'http://127.0.0.1:3001'

function normalizeInput(value: string) {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed) {
    return ''
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed
  }

  return `http://${trimmed}`
}

export default function ConnectLocalCodexPage() {
  const router = useRouter()
  const [endpoint, setEndpoint] = useState(DEFAULT_LOCAL_ENDPOINT)
  const [savedEndpoint, setSavedEndpoint] = useState<string | null>(null)
  const [health, setHealth] = useState<HealthState>({ status: 'idle' })

  useEffect(() => {
    const existingOverride = readBrowserBackendOverride(window)
    const nextEndpoint = existingOverride || resolveApiUrl()
    setEndpoint(nextEndpoint)
    setSavedEndpoint(existingOverride || null)
  }, [])

  const guide = buildBridgeGuide(endpoint)

  async function checkEndpoint(nextEndpoint = endpoint) {
    const normalized = normalizeInput(nextEndpoint)
    if (!normalized) {
      setHealth({
        status: 'error',
        details: 'Enter a local backend URL first.',
      })
      return
    }

    setHealth({ status: 'checking' })

    try {
      const response = await fetch(`${normalized}/health`, {
        cache: 'no-store',
      })

      if (!response.ok) {
        setHealth({
          status: 'error',
          details: `Health check failed with status ${response.status}.`,
        })
        return
      }

      const payload = await response.json()
      const summary = summarizeHealthPayload(normalized, payload)
      const websocketStatus = await probeWebSocket(summary.checks.websocket.url || `${resolveBrowserWsUrl()}/ws`)
      const nextChecks = {
        ...summary.checks,
        websocket: websocketStatus,
      }
      setHealth({
        status: 'ok',
        details: `本地 bridge 已连接。Codex 控制状态：${payload?.codexControl || 'unknown'}。`,
        checks: nextChecks,
      })
      if (shouldAutoEnterWorkspace(nextChecks)) {
        saveBrowserBackendOverride(window, normalized)
        setSavedEndpoint(normalized)
        window.setTimeout(() => {
          router.push('/workspace/default')
        }, 500)
      }
    } catch (error) {
      setHealth({
        status: 'error',
        details: error instanceof Error ? error.message : '无法连接本地 bridge。',
      })
    }
  }

  function saveEndpoint() {
    const normalized = normalizeInput(endpoint)
    if (!normalized) {
      setHealth({
        status: 'error',
        details: '请先输入有效的本地地址。',
      })
      return
    }

    const persisted = saveBrowserBackendOverride(window, normalized)
    setSavedEndpoint(persisted || null)
    setEndpoint(persisted || DEFAULT_LOCAL_ENDPOINT)
    setHealth({
      status: 'ok',
      details: '已保存。当前浏览器会使用这个本地 bridge 地址。',
      checks: {},
    })
  }

  function resetEndpoint() {
    clearBrowserBackendOverride(window)
    const fallback = resolveApiUrl()
    setSavedEndpoint(null)
    setEndpoint(fallback)
    setHealth({
      status: 'idle',
    })
  }

  return (
    <main className="min-h-screen bg-[#04070d] px-6 py-12 text-[#e2e8f0]">
      <div className="mx-auto flex max-w-5xl flex-col gap-8">
        <div className="space-y-3">
          <p className="text-xs uppercase tracking-[0.28em] text-[rgba(103,232,249,0.72)]">连接本地 Codex</p>
          <h1 className="text-4xl font-semibold tracking-[-0.03em] text-white">从 Vercel 前端接入你自己的本地 Codex 运行时</h1>
          <p className="max-w-3xl text-sm leading-7 text-[rgba(148,163,184,0.84)]">
            这个公开站点只负责界面。你的任务、session 和 Codex harness 应该运行在你自己的机器上，通过本地 backend 或 bridge 提供给网页使用。
          </p>
        </div>

        <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-[32px] border border-[rgba(125,211,252,0.14)] bg-[rgba(8,15,28,0.88)] p-7 shadow-[0_28px_120px_rgba(2,8,23,0.45)]">
            <label className="block text-xs uppercase tracking-[0.24em] text-[rgba(148,163,184,0.72)]">本地 Bridge 地址</label>
            <input
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              placeholder={DEFAULT_LOCAL_ENDPOINT}
              className="mt-4 w-full rounded-2xl border border-[rgba(148,163,184,0.14)] bg-[rgba(2,6,23,0.82)] px-4 py-3 text-sm text-white outline-none transition focus:border-[rgba(103,232,249,0.55)]"
            />
            <p className="mt-3 text-xs leading-6 text-[rgba(148,163,184,0.76)]">
              示例：<span className="text-white">http://127.0.0.1:3001</span>
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                onClick={() => void checkEndpoint()}
                className="rounded-full bg-[rgba(8,145,178,0.18)] px-5 py-2.5 text-sm text-cyan-100 transition hover:bg-[rgba(8,145,178,0.28)]"
              >
                检测连接
              </button>
              <button
                onClick={saveEndpoint}
                className="rounded-full bg-[#e2e8f0] px-5 py-2.5 text-sm text-[#020617] transition hover:bg-white"
              >
                保存地址
              </button>
              <button
                onClick={resetEndpoint}
                className="rounded-full border border-[rgba(148,163,184,0.18)] px-5 py-2.5 text-sm text-[rgba(226,232,240,0.82)] transition hover:border-[rgba(148,163,184,0.34)] hover:text-white"
              >
                重置
              </button>
            </div>

            <div className="mt-5 rounded-2xl border border-[rgba(148,163,184,0.12)] bg-[rgba(2,6,23,0.68)] px-4 py-4 text-sm leading-7">
              {health.status === 'idle' ? (
                <p className="text-[rgba(148,163,184,0.76)]">还没有执行连接检测。</p>
              ) : null}
              {health.status === 'checking' ? (
                <p className="text-[rgba(125,211,252,0.9)]">正在检测本地 bridge 状态...</p>
              ) : null}
              {health.status === 'ok' ? (
                <div className="space-y-4">
                  <p className="text-[rgba(134,239,172,0.9)]">{health.details}</p>
                  {Object.entries(health.checks).length > 0 ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      {Object.entries(health.checks).map(([key, check]) => (
                        <DiagnosticTile key={key} check={check} />
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {health.status === 'error' ? (
                <div className="space-y-4">
                  <p className="text-[rgba(252,165,165,0.9)]">{health.details}</p>
                  {health.checks && Object.entries(health.checks).length > 0 ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      {Object.entries(health.checks).map(([key, check]) => (
                        <DiagnosticTile key={key} check={check} />
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          <aside className="rounded-[32px] border border-[rgba(148,163,184,0.12)] bg-[rgba(7,10,19,0.92)] p-7">
            <p className="text-xs uppercase tracking-[0.24em] text-[rgba(148,163,184,0.68)]">快速开始</p>
            <ol className="mt-4 space-y-3 text-sm leading-7 text-[rgba(226,232,240,0.82)]">
              <li>1. 在这个仓库里启动本地 Codex bridge。</li>
              <li>2. 确认它暴露 `/health`、`/api/sessions/:id` 和 `WS /ws`。</li>
              <li>3. 在这里检测地址。</li>
              <li>4. 保存后进入工作台。</li>
            </ol>
            <div className="mt-6 rounded-2xl border border-[rgba(148,163,184,0.1)] bg-[rgba(2,6,23,0.72)] px-4 py-4 font-mono text-xs leading-6 text-[rgba(148,163,184,0.88)]">
              {guide.startCommand}
            </div>
            <div className="mt-4 rounded-2xl border border-[rgba(148,163,184,0.1)] bg-[rgba(2,6,23,0.72)] px-4 py-4 font-mono text-xs leading-6 text-[rgba(148,163,184,0.88)]">
              {guide.verifyCommand}
            </div>
            <div className="mt-6 rounded-2xl border border-[rgba(148,163,184,0.1)] bg-[rgba(2,6,23,0.72)] px-4 py-4 font-mono text-xs leading-6 text-[rgba(148,163,184,0.88)]">
              {savedEndpoint ? `已保存地址：\n${savedEndpoint}` : '当前浏览器还没有保存 bridge 地址。'}
            </div>
            <div className="mt-4 rounded-2xl border border-[rgba(148,163,184,0.1)] bg-[rgba(2,6,23,0.72)] px-4 py-4 font-mono text-xs leading-6 text-[rgba(148,163,184,0.88)]">
              {guide.healthUrl}
              <br />
              {guide.sessionUrl}
              <br />
              {guide.wsUrl}
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/workspace/default"
                className="rounded-full bg-[rgba(103,232,249,0.14)] px-5 py-2.5 text-sm text-cyan-100 transition hover:bg-[rgba(103,232,249,0.24)]"
              >
                进入工作台
              </Link>
              <Link
                href="/"
                className="rounded-full border border-[rgba(148,163,184,0.16)] px-5 py-2.5 text-sm text-[rgba(226,232,240,0.82)] transition hover:border-[rgba(148,163,184,0.32)] hover:text-white"
              >
                返回首页
              </Link>
            </div>
          </aside>
        </section>
      </div>
    </main>
  )
}

function DiagnosticTile({ check }: { check: DiagnosticCheck }) {
  const tone =
    check.status === 'ok'
      ? 'border-[rgba(74,222,128,0.2)] bg-[rgba(20,83,45,0.2)] text-[rgba(134,239,172,0.92)]'
      : check.status === 'error'
        ? 'border-[rgba(248,113,113,0.18)] bg-[rgba(127,29,29,0.18)] text-[rgba(252,165,165,0.92)]'
        : 'border-[rgba(125,211,252,0.14)] bg-[rgba(8,47,73,0.18)] text-[rgba(125,211,252,0.92)]'

  return (
    <div className={`rounded-2xl border px-4 py-3 ${tone}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-[0.18em]">{check.label}</p>
        <p className="text-[10px] uppercase tracking-[0.22em]">{check.status}</p>
      </div>
      <p className="mt-2 text-xs leading-6">{check.detail}</p>
      {check.url ? <p className="mt-2 font-mono text-[11px] leading-5 opacity-80">{check.url}</p> : null}
    </div>
  )
}

function probeWebSocket(url: string): Promise<DiagnosticCheck> {
  return new Promise((resolve) => {
    try {
      const socket = new WebSocket(url)
      const timeoutId = window.setTimeout(() => {
        socket.close()
        resolve({
          label: 'WebSocket endpoint',
          status: 'pending',
          detail: 'WebSocket 检测超时，连接没有在预期时间内建立。',
          url,
        })
      }, 2500)

      socket.onopen = () => {
        window.clearTimeout(timeoutId)
        socket.close()
        resolve({
          label: 'WebSocket endpoint',
          status: 'ok',
          detail: 'WebSocket 握手成功。',
          url,
        })
      }

      socket.onerror = () => {
        window.clearTimeout(timeoutId)
        resolve({
          label: 'WebSocket endpoint',
          status: 'error',
          detail: 'WebSocket 握手失败。',
          url,
        })
      }
    } catch {
      resolve({
        label: 'WebSocket endpoint',
        status: 'error',
        detail: '当前浏览器无法启动 WebSocket 检测。',
        url,
      })
    }
  })
}
