const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')

const { SessionStore } = require('../services/sessionStore')
const { AgentRegistry } = require('../services/agentRegistry')
const { CodexOrchestrator } = require('../services/codexOrchestrator')

class FakeCodexClient extends EventEmitter {
  async start() {}
  async stop() {}

  async startThread() {
    return { threadId: 'thread-test-1' }
  }

  async startTurn() {
    return { turnId: 'turn-test-1' }
  }

  async unsubscribeThread() {}
  respond() {}
}

class FakeBlackboardStore {
  constructor() {
    this.events = []
  }

  async appendEvent(event) {
    this.events.push(event)
  }
}

test('codex tasks are included in session snapshots and update through completion', async () => {
  const sessionStore = new SessionStore()
  const registry = new AgentRegistry()
  const client = new FakeCodexClient()
  const blackboard = new FakeBlackboardStore()
  const broadcasts = []

  const orchestrator = new CodexOrchestrator({
    client,
    registry,
    blackboard,
    sessionStore,
    broadcast: (event) => broadcasts.push(event)
  })

  await orchestrator.start()

  const dispatchResult = await orchestrator.dispatchTask('default', 'agent-main', {
    title: 'Create login prototype',
    prompt: 'Create a login prototype and implementation outline.'
  })

  const snapshotAfterDispatch = sessionStore.getSessionSnapshot('default')
  const dispatchedTask = snapshotAfterDispatch.tasks.find((task) => task.id === dispatchResult.taskId)
  const runtimeAgentAfterDispatch = snapshotAfterDispatch.agents.find((agent) => agent.id === 'agent-main')

  assert.ok(dispatchedTask, 'expected codex task to appear in session snapshot after dispatch')
  assert.equal(dispatchedTask.status, 'executing')
  assert.equal(dispatchedTask.agentId, 'agent-main')
  assert.equal(dispatchedTask.description, 'Create login prototype')
  assert.ok(runtimeAgentAfterDispatch, 'expected codex agent to appear in session snapshot after dispatch')
  assert.equal(runtimeAgentAfterDispatch.status, 'working')
  assert.equal(runtimeAgentAfterDispatch.currentTask, 'Create login prototype')

  await orchestrator.handleNotification({
    method: 'turn/completed',
    params: {
      threadId: 'thread-test-1',
      turnId: 'turn-test-1',
      turn: {
        outputText: 'done'
      }
    }
  })

  const snapshotAfterCompletion = sessionStore.getSessionSnapshot('default')
  const completedTask = snapshotAfterCompletion.tasks.find((task) => task.id === dispatchResult.taskId)
  const runtimeAgentAfterCompletion = snapshotAfterCompletion.agents.find((agent) => agent.id === 'agent-main')

  assert.ok(completedTask, 'expected codex task to remain in session snapshot after completion')
  assert.equal(completedTask.status, 'completed')
  assert.equal(completedTask.result, 'done')
  assert.ok(runtimeAgentAfterCompletion, 'expected codex agent to remain in session snapshot after completion')
  assert.equal(runtimeAgentAfterCompletion.status, 'idle')
  assert.equal(runtimeAgentAfterCompletion.currentTask, null)

  await orchestrator.stop()
})
