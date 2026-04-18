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
  assert.match(copy.localAuthNote, /local Codex setup/i)
  assert.match(copy.publicSiteWarning, /public Vercel domain/i)
  assert.equal(copy.prerequisitesTitle, 'Prerequisites')
  assert.equal(copy.authSetupTitle, 'Local Auth Setup')
  assert.equal(copy.diagnosisTitle, 'Failure Diagnosis')
  assert.ok(Array.isArray(copy.prerequisites))
  assert.ok(Array.isArray(copy.authSetup))
  assert.ok(Array.isArray(copy.diagnosis))
  assert.match(copy.authSetup[0], /OPENAI_API_KEY/i)
})
