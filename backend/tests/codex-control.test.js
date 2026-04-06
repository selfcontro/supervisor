const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')
const { EventEmitter } = require('node:events')

const { SessionStore } = require('../services/sessionStore')
const { AgentRegistry } = require('../services/agentRegistry')
const { BlackboardStore } = require('../services/blackboardStore')
const { CodexOrchestrator } = require('../services/codexOrchestrator')

class FakeCodexClient extends EventEmitter {
  constructor() {
    super()
    this.started = false
    this.responses = {
      thread: { threadId: 'thread_test_1' },
      turn: { turnId: 'turn_test_1' }
    }
  }

  async start() {
    this.started = true
  }

  async stop() {
    this.started = false
  }

  async startThread() {
    return this.responses.thread
  }

  async startTurn() {
    return this.responses.turn
  }

  async interruptTurn() {
    return { ok: true }
  }

  async unsubscribeThread() {
    return { ok: true }
  }

  respond() {
    return undefined
  }
}

async function createHarness() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-blackboard-'))
  const sessionStore = new SessionStore()
  const registry = new AgentRegistry()
  const blackboard = new BlackboardStore({
    rootDir: tmpDir
  })
  const client = new FakeCodexClient()
  const events = []

  const orchestrator = new CodexOrchestrator({
    client,
    registry,
    blackboard,
    sessionStore,
    broadcast(data) {
      events.push(data)
    }
  })

  await orchestrator.start()

  return {
    orchestrator,
    blackboard,
    events,
    tmpDir
  }
}

test('creates agent and dispatches task with blackboard records', async () => {
  const harness = await createHarness()

  const agent = await harness.orchestrator.createOrActivateAgent('sessionA', 'agentA', {
    harness: {
      model: 'gpt-5'
    }
  })

  assert.equal(agent.threadId, 'thread_test_1')

  const dispatch = await harness.orchestrator.dispatchTask('sessionA', 'agentA', {
    title: 'Run diagnostics',
    prompt: 'Run diagnostics and report result.'
  })

  assert.equal(dispatch.status, 'accepted')
  assert.equal(dispatch.threadId, 'thread_test_1')
  assert.equal(dispatch.turnId, 'turn_test_1')

  const summary = await harness.orchestrator.getSessionBlackboard('sessionA')
  assert.equal(summary.tasks.length, 1)
  assert.equal(summary.tasks[0].taskId, dispatch.taskId)

  const markdown = await harness.orchestrator.getSessionMarkdown('sessionA')
  assert.match(markdown, /Session Blackboard: sessionA/)
  assert.match(markdown, /Run diagnostics/)

  await harness.orchestrator.stop()
  await fs.rm(harness.tmpDir, { recursive: true, force: true })
})

test('captures command execution from notifications', async () => {
  const harness = await createHarness()

  const dispatch = await harness.orchestrator.dispatchTask('sessionB', 'agentB', {
    prompt: 'echo test'
  })

  harness.orchestrator.handleNotification({
    method: 'item/started',
    params: {
      threadId: dispatch.threadId,
      turnId: dispatch.turnId,
      item: {
        id: 'item_1',
        type: 'commandExecution',
        command: 'echo test',
        cwd: '/tmp',
        startedAt: new Date().toISOString()
      }
    }
  })

  harness.orchestrator.handleNotification({
    method: 'item/commandExecution/outputDelta',
    params: {
      threadId: dispatch.threadId,
      turnId: dispatch.turnId,
      itemId: 'item_1',
      delta: 'test\\n'
    }
  })

  await harness.orchestrator.handleNotification({
    method: 'item/completed',
    params: {
      threadId: dispatch.threadId,
      turnId: dispatch.turnId,
      item: {
        id: 'item_1',
        type: 'commandExecution',
        command: 'echo test',
        cwd: '/tmp',
        status: 'completed',
        exitCode: 0,
        durationMs: 12
      }
    }
  })

  const detail = await harness.orchestrator.getAgentBlackboard('sessionB', 'agentB')
  assert.ok(detail.events.some(event => event.type === 'command_execution'))

  const emitted = harness.events.filter(event => event.type === 'command_execution')
  assert.equal(emitted.length, 1)
  assert.equal(emitted[0].payload.command, 'echo test')

  await harness.orchestrator.stop()
  await fs.rm(harness.tmpDir, { recursive: true, force: true })
})
