const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')

const { SessionStore } = require('../services/sessionStore')
const { AgentRegistry } = require('../services/agentRegistry')
const { CodexOrchestrator } = require('../services/codexOrchestrator')

class FakeCodexClient extends EventEmitter {
  constructor() {
    super()
    this.threadCounter = 0
    this.turnCounter = 0
  }

  async start() {}
  async stop() {}

  async startThread() {
    this.threadCounter += 1
    return { threadId: `thread-test-${this.threadCounter}` }
  }

  async startTurn() {
    this.turnCounter += 1
    return { turnId: `turn-test-${this.turnCounter}` }
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

  const dispatchResult = await orchestrator.dispatchTask('default', 'agent-standalone', {
    title: 'Create login prototype',
    prompt: 'Create a login prototype and implementation outline.'
  })

  const snapshotAfterDispatch = sessionStore.getSessionSnapshot('default')
  const dispatchedTask = snapshotAfterDispatch.tasks.find((task) => task.id === dispatchResult.taskId)
  const runtimeAgentAfterDispatch = snapshotAfterDispatch.agents.find((agent) => agent.id === 'agent-standalone')

  assert.ok(dispatchedTask, 'expected codex task to appear in session snapshot after dispatch')
  assert.equal(dispatchedTask.status, 'executing')
  assert.equal(dispatchedTask.agentId, 'agent-standalone')
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
  const runtimeAgentAfterCompletion = snapshotAfterCompletion.agents.find((agent) => agent.id === 'agent-standalone')

  assert.ok(completedTask, 'expected codex task to remain in session snapshot after completion')
  assert.equal(completedTask.status, 'completed')
  assert.equal(completedTask.result, 'done')
  assert.ok(runtimeAgentAfterCompletion, 'expected codex agent to remain in session snapshot after completion')
  assert.equal(runtimeAgentAfterCompletion.status, 'idle')
  assert.equal(runtimeAgentAfterCompletion.currentTask, null)

  await orchestrator.stop()
})

test('agent-main orchestrates planner, executor, and reviewer subagents through staged task flow', async () => {
  const sessionStore = new SessionStore()
  const registry = new AgentRegistry()
  const client = new FakeCodexClient()
  const blackboard = new FakeBlackboardStore()

  const orchestrator = new CodexOrchestrator({
    client,
    registry,
    blackboard,
    sessionStore,
    broadcast: () => {}
  })

  await orchestrator.start()

  const dispatchResult = await orchestrator.dispatchTask('default', 'agent-main', {
    title: 'Build onboarding checklist',
    prompt: 'Use the team to plan, implement, and review an onboarding checklist feature.'
  })

  const snapshotAfterDispatch = sessionStore.getSessionSnapshot('default')
  const parentTask = snapshotAfterDispatch.tasks.find((task) => task.id === dispatchResult.taskId)
  const plannerTask = snapshotAfterDispatch.tasks.find((task) => task.id === `${dispatchResult.taskId}:planner`)
  const plannerAgent = snapshotAfterDispatch.agents.find((agent) => agent.id === 'planner')
  const executorAgent = snapshotAfterDispatch.agents.find((agent) => agent.id === 'executor')
  const reviewerAgent = snapshotAfterDispatch.agents.find((agent) => agent.id === 'reviewer')
  const mainAgent = snapshotAfterDispatch.agents.find((agent) => agent.id === 'agent-main')

  assert.ok(parentTask, 'expected parent task to appear in snapshot')
  assert.equal(parentTask.status, 'planning')
  assert.deepEqual(parentTask.subTasks, [
    `${dispatchResult.taskId}:planner`,
    `${dispatchResult.taskId}:executor`,
    `${dispatchResult.taskId}:reviewer`,
  ])
  assert.ok(plannerTask, 'expected planner task to be created')
  assert.equal(plannerTask.status, 'executing')
  assert.equal(plannerTask.agentId, 'planner')
  assert.equal(mainAgent?.status, 'working')
  assert.equal(mainAgent?.currentTask, 'Build onboarding checklist')
  assert.equal(plannerAgent?.status, 'working')
  assert.equal(executorAgent?.status, 'idle')
  assert.equal(reviewerAgent?.status, 'idle')

  await orchestrator.handleNotification({
    method: 'turn/completed',
    params: {
      threadId: registry.getAgent('default', 'planner').threadId,
      turnId: registry.getAgent('default', 'planner').activeTurnId,
      turn: {
        outputText: 'Plan ready'
      }
    }
  })

  const snapshotAfterPlanning = sessionStore.getSessionSnapshot('default')
  const executorTask = snapshotAfterPlanning.tasks.find((task) => task.id === `${dispatchResult.taskId}:executor`)
  assert.equal(snapshotAfterPlanning.tasks.find((task) => task.id === dispatchResult.taskId)?.status, 'executing')
  assert.equal(snapshotAfterPlanning.agents.find((agent) => agent.id === 'planner')?.status, 'idle')
  assert.equal(snapshotAfterPlanning.agents.find((agent) => agent.id === 'executor')?.status, 'working')
  assert.ok(executorTask, 'expected executor task to be created after planning')
  assert.equal(executorTask.status, 'executing')

  await orchestrator.handleNotification({
    method: 'turn/completed',
    params: {
      threadId: registry.getAgent('default', 'executor').threadId,
      turnId: registry.getAgent('default', 'executor').activeTurnId,
      turn: {
        outputText: 'Implementation ready'
      }
    }
  })

  const snapshotAfterExecution = sessionStore.getSessionSnapshot('default')
  const reviewerTask = snapshotAfterExecution.tasks.find((task) => task.id === `${dispatchResult.taskId}:reviewer`)
  assert.equal(snapshotAfterExecution.tasks.find((task) => task.id === dispatchResult.taskId)?.status, 'reviewing')
  assert.equal(snapshotAfterExecution.agents.find((agent) => agent.id === 'executor')?.status, 'idle')
  assert.equal(snapshotAfterExecution.agents.find((agent) => agent.id === 'reviewer')?.status, 'working')
  assert.ok(reviewerTask, 'expected reviewer task to be created after execution')
  assert.equal(reviewerTask.status, 'executing')

  await orchestrator.handleNotification({
    method: 'turn/completed',
    params: {
      threadId: registry.getAgent('default', 'reviewer').threadId,
      turnId: registry.getAgent('default', 'reviewer').activeTurnId,
      turn: {
        outputText: 'Review approved'
      }
    }
  })

  const snapshotAfterReview = sessionStore.getSessionSnapshot('default')
  const completedParentTask = snapshotAfterReview.tasks.find((task) => task.id === dispatchResult.taskId)

  assert.equal(completedParentTask?.status, 'completed')
  assert.match(completedParentTask?.result || '', /Plan ready/)
  assert.match(completedParentTask?.result || '', /Implementation ready/)
  assert.match(completedParentTask?.result || '', /Review approved/)
  assert.equal(snapshotAfterReview.agents.find((agent) => agent.id === 'agent-main')?.status, 'idle')
  assert.equal(snapshotAfterReview.agents.find((agent) => agent.id === 'reviewer')?.status, 'idle')

  await orchestrator.stop()
})
