const test = require('node:test')
const assert = require('node:assert/strict')

const { getConnectCopy } = require('./connectContent')

test('getConnectCopy returns english UI labels', () => {
  const copy = getConnectCopy()

  assert.equal(copy.badge, 'Connect Local Codex')
  assert.equal(copy.primaryAction, 'Test Connection')
  assert.equal(copy.saveAction, 'Save Endpoint')
  assert.equal(copy.workspaceAction, 'Open Workspace')
  assert.equal(copy.redirecting, 'Connection verified. Opening workspace...')
  assert.match(copy.title, /Vercel frontend/i)
})
