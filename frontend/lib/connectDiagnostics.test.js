const test = require('node:test')
const assert = require('node:assert/strict')

const { summarizeHealthPayload } = require('./connectDiagnostics')

test('summarizeHealthPayload marks codex and auth as ready when backend health is fully ready', () => {
  const summary = summarizeHealthPayload('http://127.0.0.1:3001', {
    status: 'ok',
    codexControl: 'ready',
    codexApiKeyConfigured: true,
    sessions: 2,
  })

  assert.equal(summary.overallStatus, 'ready')
  assert.equal(summary.checks.http.status, 'ok')
  assert.equal(summary.checks.codex.status, 'ok')
  assert.equal(summary.checks.auth.status, 'ok')
  assert.equal(summary.checks.websocket.url, 'ws://127.0.0.1:3001/ws')
})

test('summarizeHealthPayload marks codex as pending when app-server is starting', () => {
  const summary = summarizeHealthPayload('http://127.0.0.1:3001', {
    status: 'ok',
    codexControl: 'starting',
    codexApiKeyConfigured: false,
    sessions: 0,
  })

  assert.equal(summary.overallStatus, 'degraded')
  assert.equal(summary.checks.codex.status, 'pending')
  assert.equal(summary.checks.auth.status, 'error')
})

test('summarizeHealthPayload handles invalid payloads defensively', () => {
  const summary = summarizeHealthPayload('https://bridge.example.com', null)

  assert.equal(summary.overallStatus, 'degraded')
  assert.equal(summary.checks.http.status, 'ok')
  assert.equal(summary.checks.websocket.url, 'wss://bridge.example.com/ws')
  assert.equal(summary.checks.codex.status, 'pending')
})

test('summarizeHealthPayload prefers bridge transport and auth fields when present', () => {
  const summary = summarizeHealthPayload('http://127.0.0.1:3001', {
    status: 'ok',
    bridge: {
      transport: {
        ws: 'ws://127.0.0.1:4010/ws',
      },
      auth: {
        configured: true,
      },
      runtime: {
        codexControl: 'ready',
      },
    },
  })

  assert.equal(summary.checks.websocket.url, 'ws://127.0.0.1:4010/ws')
  assert.equal(summary.checks.auth.status, 'ok')
  assert.equal(summary.checks.codex.status, 'ok')
})
