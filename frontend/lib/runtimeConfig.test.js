const test = require('node:test')
const assert = require('node:assert/strict')

const {
  resolveApiUrl,
  resolveWsUrl,
  classifySessionSnapshotFailure,
} = require('./runtimeConfig')

test('resolveApiUrl prefers NEXT_PUBLIC_API_URL when provided', () => {
  const apiUrl = resolveApiUrl({
    NEXT_PUBLIC_API_URL: 'http://127.0.0.1:4001/',
    NEXT_PUBLIC_API_BASE: 'http://127.0.0.1:3001/',
  })

  assert.equal(apiUrl, 'http://127.0.0.1:4001')
})

test('resolveApiUrl falls back to NEXT_PUBLIC_API_BASE for backward compatibility', () => {
  const apiUrl = resolveApiUrl({
    NEXT_PUBLIC_API_BASE: 'http://127.0.0.1:3001/',
  })

  assert.equal(apiUrl, 'http://127.0.0.1:3001')
})

test('resolveWsUrl derives from api url when explicit websocket url is missing', () => {
  const wsUrl = resolveWsUrl({
    NEXT_PUBLIC_API_BASE: 'https://example.com/internal-api/',
  })

  assert.equal(wsUrl, 'wss://example.com/internal-api')
})

test('classifySessionSnapshotFailure marks explicit session misses as not_found', () => {
  const kind = classifySessionSnapshotFailure({
    status: 404,
    message: 'Session not found',
  })

  assert.equal(kind, 'not_found')
})

test('classifySessionSnapshotFailure marks generic 404 responses as backend_mismatch', () => {
  const kind = classifySessionSnapshotFailure({
    status: 404,
    message: 'Cannot GET /api/sessions/default',
  })

  assert.equal(kind, 'backend_mismatch')
})
