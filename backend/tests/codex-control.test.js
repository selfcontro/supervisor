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
    this.threadCounter = 0
    this.turnCounter = 0
  }

  async start() {
    this.started = true
  }

  async stop() {
    this.started = false
  }

  async startThread() {
    this.threadCounter += 1
    return { threadId: `thread_test_${this.threadCounter}` }
  }

  async startTurn() {
    this.turnCounter += 1
    return { turnId: `turn_test_${this.turnCounter}` }
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

function getWorkflowAgent(registry, sessionId, parentTaskId, stageId) {
  return registry.getAgent(sessionId, `${parentTaskId}::${stageId}`)
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

test('renders swarm duty tasks in session blackboard markdown', async () => {
  const harness = await createHarness()

  const dispatch = await harness.orchestrator.dispatchTask('sessionC', 'agent-main', {
    title: 'Tiny onboarding checklist',
    prompt: 'Create a tiny onboarding checklist card, verify it across frontend and backend surfaces, and run it through the agent team.'
  })

  let markdown = await harness.orchestrator.getSessionMarkdown('sessionC')
  assert.match(markdown, /# Session Blackboard: sessionC/)
  assert.match(markdown, /Tiny onboarding checklist/)
  assert.match(markdown, /task-breakdown/)

  const breakdownAgent = getWorkflowAgent(harness.orchestrator.registry, 'sessionC', dispatch.taskId, 'task-breakdown')
  await harness.orchestrator.handleNotification({
    method: 'turn/completed',
    params: {
      threadId: breakdownAgent.threadId,
      turnId: breakdownAgent.activeTurnId,
      turn: {
        outputText: 'Plan ready'
      }
    }
  })

  markdown = await harness.orchestrator.getSessionMarkdown('sessionC')
  assert.match(markdown, /Task Breakdown/)
  assert.match(markdown, /ui-build|backend-integration|primary-build/)

  const workerAgents = harness.orchestrator
    .listAgents('sessionC')
    .filter((agent) => agent.workflowParentTaskId === dispatch.taskId && agent.stageId !== 'task-breakdown' && agent.stageId !== 'quality-gate')

  for (const workerAgent of workerAgents) {
    await harness.orchestrator.handleNotification({
      method: 'turn/completed',
      params: {
        threadId: workerAgent.threadId,
        turnId: workerAgent.activeTurnId,
        turn: {
          outputText: `${workerAgent.stageId} done`
        }
      }
    })
  }

  markdown = await harness.orchestrator.getSessionMarkdown('sessionC')
  assert.match(markdown, /quality-gate/)

  const reviewerAgent = getWorkflowAgent(harness.orchestrator.registry, 'sessionC', dispatch.taskId, 'quality-gate')
  await harness.orchestrator.handleNotification({
    method: 'turn/completed',
    params: {
      threadId: reviewerAgent.threadId,
      turnId: reviewerAgent.activeTurnId,
      turn: {
        outputText: 'Review approved'
      }
    }
  })

  markdown = await harness.orchestrator.getSessionMarkdown('sessionC')
  assert.match(markdown, /Review approved/)
  assert.match(markdown, /quality-gate/)

  await harness.orchestrator.stop()
  await fs.rm(harness.tmpDir, { recursive: true, force: true })
})

test('session blackboard checklist cards track modern swarm stage ids', async () => {
  const harness = await createHarness()

  const dispatch = await harness.orchestrator.dispatchTask('sessionChecklist', 'agent-main', {
    title: 'Verify long task',
    prompt: 'Design and verify a long task across frontend and backend surfaces, including UI behavior, backend integration, and validation checks using the agent team.'
  })

  const breakdownAgent = getWorkflowAgent(harness.orchestrator.registry, 'sessionChecklist', dispatch.taskId, 'task-breakdown')
  await harness.orchestrator.handleNotification({
    method: 'turn/completed',
    params: {
      threadId: breakdownAgent.threadId,
      turnId: breakdownAgent.activeTurnId,
      turn: {
        outputText: 'Plan ready'
      }
    }
  })

  let markdown = await harness.orchestrator.getSessionMarkdown('sessionChecklist')
  assert.match(markdown, /Verify long task/)
  assert.match(markdown, /task-breakdown/)
  assert.match(markdown, /ui-build|backend-integration|primary-build|validation-sweep/)

  const workerAgents = harness.orchestrator
    .listAgents('sessionChecklist')
    .filter((agent) => agent.workflowParentTaskId === dispatch.taskId && agent.stageId !== 'task-breakdown' && agent.stageId !== 'quality-gate')

  for (const workerAgent of workerAgents) {
    await harness.orchestrator.handleNotification({
      method: 'turn/completed',
      params: {
        threadId: workerAgent.threadId,
        turnId: workerAgent.activeTurnId,
        turn: {
          outputText: `${workerAgent.stageId} done`
        }
      }
    })
  }

  markdown = await harness.orchestrator.getSessionMarkdown('sessionChecklist')
  assert.match(markdown, /quality-gate/)
  assert.match(markdown, /Primary Build|UI Build|Backend Integration|Validation Sweep/)

  markdown = await harness.orchestrator.getSessionMarkdown('sessionChecklist')
  assert.match(markdown, /quality-gate/)
  assert.match(markdown, /task_assigned/)

  const reviewerAgent = getWorkflowAgent(harness.orchestrator.registry, 'sessionChecklist', dispatch.taskId, 'quality-gate')
  await harness.orchestrator.handleNotification({
    method: 'turn/completed',
    params: {
      threadId: reviewerAgent.threadId,
      turnId: reviewerAgent.activeTurnId,
      turn: {
        outputText: 'Review approved'
      }
    }
  })

  markdown = await harness.orchestrator.getSessionMarkdown('sessionChecklist')
  assert.match(markdown, /Review approved/)

  await harness.orchestrator.stop()
  await fs.rm(harness.tmpDir, { recursive: true, force: true })
})
