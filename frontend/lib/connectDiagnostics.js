function deriveWebSocketUrl(endpoint) {
  if (typeof endpoint !== 'string') {
    return 'ws://localhost:3001/ws'
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
  const codexRuntimeState = bridgePayload?.runtime?.codexControl || payload?.codexControl
  const codexReady = codexRuntimeState === 'ready'
  const authReady = Boolean(bridgePayload?.auth?.configured ?? payload?.codexApiKeyConfigured)
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
      status: codexReady ? 'ok' : 'pending',
      detail: codexReady ? 'Codex control runtime is ready.' : 'Codex control is still starting.',
    },
    auth: {
      label: 'Authentication',
      status: authReady ? 'ok' : 'error',
      detail: authReady ? 'Backend reports an API key or local auth is configured.' : 'No local Codex/OpenAI auth detected yet.',
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

module.exports = {
  summarizeHealthPayload,
}
