function deriveWebSocketUrl(endpoint) {
  if (typeof endpoint !== 'string') {
    return 'ws://127.0.0.1:3101/ws'
  }

  const normalized = endpoint.replace(/\/+$/, '')
  if (normalized.startsWith('https://')) {
    return `wss://${normalized.slice('https://'.length)}/ws`
  }

  if (normalized.startsWith('http://')) {
    return `ws://${normalized.slice('http://'.length)}/ws`
  }

  return `${normalized}/ws`
}

function summarizeHealthPayload(endpoint, payload) {
  const bridgePayload = payload?.bridge || {}
  const runtimePayload = bridgePayload?.runtime || {}
  const authPayload = bridgePayload?.auth || {}
  const codexRuntimeState = runtimePayload?.codexControl || payload?.codexControl
  const appServerState = runtimePayload?.appServer || (codexRuntimeState === 'ready' ? 'ready' : 'starting')
  const codexInstalled = Boolean(runtimePayload?.codexInstalled ?? true)
  const codexReady = codexRuntimeState === 'ready' || appServerState === 'ready'
  const authReady = Boolean(authPayload?.configured ?? payload?.codexApiKeyConfigured)
  const authSource = authPayload?.source || (authReady ? 'local auth' : 'missing')
  const sessions = Number.isFinite(payload?.sessions) ? payload.sessions : 0
  const websocketUrl = bridgePayload?.transport?.ws || deriveWebSocketUrl(endpoint)

  const checks = {
    http: {
      label: 'HTTP health',
      status: 'ok',
      detail: payload?.status === 'ok' ? 'Backend responded to /health.' : 'Backend responded, but the health payload is incomplete.',
    },
    websocket: {
      label: 'WebSocket endpoint',
      status: 'pending',
      detail: 'Ready to probe from the browser.',
      url: websocketUrl,
    },
    codex: {
      label: 'Codex app-server',
      status: codexReady ? 'ok' : codexInstalled ? 'pending' : 'error',
      detail: codexReady
        ? 'Codex control runtime is ready.'
        : codexInstalled
          ? 'Codex bridge is reachable, but the local app-server is not ready yet.'
          : 'Codex CLI is not installed or not available on this machine.',
    },
    auth: {
      label: 'Authentication',
      status: authReady ? 'ok' : 'error',
      detail: authReady
        ? `Local auth detected via ${authSource}.`
        : 'No local Codex/OpenAI auth detected yet.',
    },
    sessions: {
      label: 'Session store',
      status: sessions > 0 ? 'ok' : 'pending',
      detail: sessions > 0 ? `${sessions} session(s) available.` : 'No active sessions reported yet.',
    },
  }

  return {
    overallStatus: codexReady && authReady ? 'ready' : 'degraded',
    checks,
  }
}

function summarizeConnectFailure(error, endpoint, browser = globalThis?.window) {
  const message = error instanceof Error ? error.message : 'Unable to reach the local bridge.'
  const protocol = browser?.location?.protocol || ''
  const normalizedEndpoint = typeof endpoint === 'string' ? endpoint.trim() : ''
  const isLocalInsecureEndpoint =
    /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(normalizedEndpoint)

  if (protocol === 'https:' && isLocalInsecureEndpoint) {
    return {
      detail:
        'This HTTPS page is trying to reach an insecure local bridge. Browsers often block https:// pages from calling http://127.0.0.1 or ws://127.0.0.1 directly.',
      hint:
        'Use the local frontend during development, or add a secure local bridge layer before connecting from the public Vercel site.',
    }
  }

  return {
    detail: message,
    hint: '',
  }
}

module.exports = {
  summarizeHealthPayload,
  summarizeConnectFailure,
}
