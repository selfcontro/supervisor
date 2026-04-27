const test = require('node:test')
const assert = require('node:assert/strict')

const { buildBridgeGuide } = require('./bridgeGuide')

test('buildBridgeGuide returns startup commands and verification paths for a local endpoint', () => {
  const guide = buildBridgeGuide('http://127.0.0.1:3001')

  assert.equal(guide.endpoint, 'http://127.0.0.1:3001')
  assert.equal(guide.healthUrl, 'http://127.0.0.1:3001/health')
  assert.equal(guide.sessionUrl, 'http://127.0.0.1:3001/api/sessions/default')
  assert.equal(guide.wsUrl, 'ws://127.0.0.1:3001/ws')
  assert.match(guide.startCommand, /npm run bridge/)
})

test('buildBridgeGuide normalizes host input without a protocol', () => {
  const guide = buildBridgeGuide('localhost:4010/')

  assert.equal(guide.endpoint, 'http://localhost:4010')
  assert.equal(guide.wsUrl, 'ws://localhost:4010/ws')
})
