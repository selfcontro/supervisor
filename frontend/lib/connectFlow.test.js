const test = require('node:test')
const assert = require('node:assert/strict')

const { shouldAutoEnterWorkspace } = require('./connectFlow')

test('shouldAutoEnterWorkspace returns true when http, websocket, codex and auth are ready', () => {
  const result = shouldAutoEnterWorkspace({
    http: { status: 'ok' },
    websocket: { status: 'ok' },
    codex: { status: 'ok' },
    auth: { status: 'ok' },
  })

  assert.equal(result, true)
})

test('shouldAutoEnterWorkspace returns false when websocket is not ready', () => {
  const result = shouldAutoEnterWorkspace({
    http: { status: 'ok' },
    websocket: { status: 'pending' },
    codex: { status: 'ok' },
    auth: { status: 'ok' },
  })

  assert.equal(result, false)
})

test('shouldAutoEnterWorkspace returns false for missing checks', () => {
  const result = shouldAutoEnterWorkspace(null)
  assert.equal(result, false)
})
