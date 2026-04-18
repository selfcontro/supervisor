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
  assert.ok(payload.agents.length > 0)
  assert.ok(payload.agents.some((agent) => agent.id === 'agent-main'))
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
