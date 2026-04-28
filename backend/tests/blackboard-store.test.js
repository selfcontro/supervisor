const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')

const { BlackboardStore } = require('../services/blackboardStore')

async function createStore() {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'blackboard-store-'))
  return {
    rootDir,
    store: new BlackboardStore({ rootDir })
  }
}

test('parses session markdown into fixed sections', async () => {
  const { rootDir, store } = await createStore()

  const markdown = [
    '# Session Blackboard',
    '',
    '## Objective',
    'Ship the blackboard view',
    '',
    '## Shared Memory',
    '- agent-main owns delegation',
    '',
    '## Proposed Memory',
    '- user approved summary pending',
    '',
    '## Current Plan',
    '1. expose backend',
    '2. render in frontend',
    ''
  ].join('\n')

  const detail = await store.saveSessionDocument('default', {
    markdown,
    source: 'user'
  })

  assert.equal(detail.scope, 'session')
  assert.equal(detail.sections[0].id, 'objective')
  assert.equal(detail.sections[0].content, 'Ship the blackboard view')
  assert.equal(detail.sections[1].id, 'shared_memory')
  assert.equal(detail.sections[2].id, 'proposed_memory')
  assert.match(detail.markdown, /## Current Plan/)

  await fs.rm(rootDir, { recursive: true, force: true })
})

test('parses agent markdown into fixed sections', async () => {
  const { rootDir, store } = await createStore()

  const detail = await store.saveAgentDocument('default', 'agent-main', {
    markdown: [
      '# Agent Blackboard',
      '',
      '## Role',
      'Coordinator',
      '',
      '## Findings',
      'Backend route exists',
      ''
    ].join('\n'),
    source: 'user'
  })

  assert.equal(detail.scope, 'agent')
  assert.equal(detail.agentId, 'agent-main')
  assert.equal(detail.sections[0].id, 'role')
  const findings = detail.sections.find((section) => section.id === 'findings')
  assert.equal(findings?.content, 'Backend route exists')

  await fs.rm(rootDir, { recursive: true, force: true })
})
