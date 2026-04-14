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
})
