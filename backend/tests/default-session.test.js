const test = require('node:test')
const assert = require('node:assert/strict')

const { createServer } = require('../server')

test('default session snapshot is always available', async (t) => {
  const runtime = createServer({ port: 0, host: '127.0.0.1', startProcessing: false })

  t.after(async () => {
    await runtime.stop().catch(() => {})
  })

  await runtime.start()

  const address = runtime.server.address()
  const baseUrl = `http://127.0.0.1:${address.port}`

  const res = await fetch(`${baseUrl}/api/sessions/default`)
  assert.equal(res.status, 200)

  const payload = await res.json()
  assert.equal(payload.session.id, 'default')
  assert.ok(Array.isArray(payload.tasks))
  assert.ok(Array.isArray(payload.agents))
  assert.ok(Array.isArray(payload.workflowAgents))
  assert.ok(Array.isArray(payload.logs))
  assert.deepEqual(payload.settings, {
    autoDispatch: true,
    compactMode: false,
    reviewMode: 'balanced',
    backend: {
      kind: 'mock',
      status: 'connected',
      lastSyncedAt: payload.settings.backend.lastSyncedAt,
    },
  })
  assert.match(payload.settings.backend.lastSyncedAt, /\d{4}-\d{2}-\d{2}T/)
})

test('session settings can be updated through the mock backend integration route', async (t) => {
  const runtime = createServer({ port: 0, host: '127.0.0.1', startProcessing: false })

  t.after(async () => {
    await runtime.stop().catch(() => {})
  })

  await runtime.start()

  const address = runtime.server.address()
  const baseUrl = `http://127.0.0.1:${address.port}`

  const updateRes = await fetch(`${baseUrl}/api/sessions/default/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      autoDispatch: false,
      compactMode: true,
      reviewMode: 'strict',
    }),
  })
  assert.equal(updateRes.status, 200)

  const updated = await updateRes.json()
  assert.equal(updated.settings.autoDispatch, false)
  assert.equal(updated.settings.compactMode, true)
  assert.equal(updated.settings.reviewMode, 'strict')
  assert.equal(updated.settings.backend.kind, 'mock')
  assert.equal(updated.settings.backend.status, 'connected')
  assert.match(updated.settings.backend.lastSyncedAt, /\d{4}-\d{2}-\d{2}T/)

  const snapshotRes = await fetch(`${baseUrl}/api/sessions/default`)
  assert.equal(snapshotRes.status, 200)
  const snapshot = await snapshotRes.json()
  assert.equal(snapshot.settings.autoDispatch, false)
  assert.equal(snapshot.settings.compactMode, true)
  assert.equal(snapshot.settings.reviewMode, 'strict')
})

test('health endpoint exposes local bridge contract details', async (t) => {
  const runtime = createServer({ port: 0, host: '127.0.0.1', startProcessing: false })

  t.after(async () => {
    await runtime.stop().catch(() => {})
  })

  await runtime.start()

  const address = runtime.server.address()
  const baseUrl = `http://127.0.0.1:${address.port}`

  const res = await fetch(`${baseUrl}/health`)
  assert.equal(res.status, 200)

  const payload = await res.json()
  assert.equal(payload.status, 'ok')
  assert.equal(payload.bridge.kind, 'local_codex_bridge')
  assert.equal(payload.bridge.transport.http, baseUrl)
  assert.equal(payload.bridge.transport.ws, `ws://127.0.0.1:${address.port}/ws`)
  assert.equal(payload.bridge.capabilities.sessions, true)
  assert.equal(payload.bridge.capabilities.codexControl, true)
  assert.equal(payload.bridge.capabilities.realtime, true)
  assert.equal(typeof payload.bridge.auth.configured, 'boolean')
  assert.equal(typeof payload.bridge.auth.source, 'string')
  assert.equal(typeof payload.bridge.runtime.codexInstalled, 'boolean')
  assert.equal(typeof payload.bridge.runtime.codexControl, 'string')
  assert.equal(typeof payload.bridge.runtime.appServer, 'string')
})

test('health treats a ready local Codex runtime as authenticated even without api key env vars', async (t) => {
  const previousOpenAiApiKey = process.env.OPENAI_API_KEY
  const previousCodexApiKey = process.env.CODEX_API_KEY
  delete process.env.OPENAI_API_KEY
  delete process.env.CODEX_API_KEY

  const runtime = createServer({ port: 0, host: '127.0.0.1', startProcessing: false })

  t.after(async () => {
    if (previousOpenAiApiKey === undefined) {
      delete process.env.OPENAI_API_KEY
    } else {
      process.env.OPENAI_API_KEY = previousOpenAiApiKey
    }

    if (previousCodexApiKey === undefined) {
      delete process.env.CODEX_API_KEY
    } else {
      process.env.CODEX_API_KEY = previousCodexApiKey
    }

    await runtime.stop().catch(() => {})
  })

  await runtime.start()
  runtime.codexOrchestrator.started = true

  const address = runtime.server.address()
  const baseUrl = `http://127.0.0.1:${address.port}`

  const res = await fetch(`${baseUrl}/health`)
  assert.equal(res.status, 200)

  const payload = await res.json()
  assert.equal(payload.bridge.auth.configured, true)
  assert.equal(payload.bridge.auth.source, 'codex_login')
})

test('session summaries do not count interrupted tasks as active', async (t) => {
  const runtime = createServer({ port: 0, host: '127.0.0.1', startProcessing: false })

  t.after(async () => {
    await runtime.stop().catch(() => {})
  })

  await runtime.start()

  runtime.sessionStore.syncTask({
    id: 'task-interrupted',
    sessionId: 'summary-test',
    description: 'Interrupted task',
    status: 'interrupted',
    createdAt: '2026-04-20T10:00:00.000Z',
    updatedAt: '2026-04-20T10:00:00.000Z',
    agentId: 'agent-main',
  })

  const address = runtime.server.address()
  const baseUrl = `http://127.0.0.1:${address.port}`

  const res = await fetch(`${baseUrl}/api/sessions`)
  assert.equal(res.status, 200)

  const payload = await res.json()
  const summary = payload.sessions.find((session) => session.id === 'summary-test')
  assert.ok(summary)
  assert.equal(summary.taskCount, 1)
  assert.equal(summary.activeTaskCount, 0)
})
