const test = require('node:test')
const assert = require('node:assert/strict')

const { createServer } = require('../server')

test('layout overlap verification mock endpoint returns explicit stub data', async (t) => {
  const runtime = createServer({ port: 0, host: '127.0.0.1', startProcessing: false })

  t.after(async () => {
    await runtime.stop().catch(() => {})
  })

  await runtime.start()

  const address = runtime.server.address()
  const baseUrl = `http://127.0.0.1:${address.port}`

  const response = await fetch(`${baseUrl}/api/layout-overlap-verification/mock`)
  assert.equal(response.status, 200)

  const payload = await response.json()
  assert.equal(payload.stub, true)
  assert.equal(payload.dataSource, 'static-mock')
  assert.equal(payload.endpoint, '/api/layout-overlap-verification/mock')
  assert.equal(payload.status, 'not-run')
  assert.match(payload.generatedAt, /\d{4}-\d{2}-\d{2}T/)
  assert.equal(payload.verification.scope, 'layout-overlap')
  assert.equal(payload.verification.version, 'mock-v1')
  assert.equal(payload.verification.summary.checkedLayoutCount, 3)
  assert.equal(payload.verification.summary.overlapCount, 2)
  assert.equal(payload.verification.summary.unresolvedCount, 1)
  assert.ok(Array.isArray(payload.verification.records))
  assert.equal(payload.verification.records.length, 2)
  assert.equal(payload.verification.records[0].id, 'overlap-001')
  assert.equal(payload.verification.records[0].status, 'needs-review')
})
