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

test('clean sessions do not expose legacy workflow agents before Codex agents exist', async () => {
  const sessionStore = new SessionStore()
  sessionStore.ensureSession('clean-session')

  assert.deepEqual(sessionStore.getAgents('clean-session'), [])

  sessionStore.syncAgent('clean-session', {
    id: 'agent-main',
    name: 'agent-main',
    role: 'Codex controlled agent',
    status: 'idle',
    currentTask: null
  })

  const agentsAfterSync = sessionStore.getAgents('clean-session')
  assert.deepEqual(agentsAfterSync.map((agent) => agent.id), ['agent-main'])
})

test('agent-main lazily creates and removes task-scoped workflow agents through staged task flow', async () => {
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
    prompt: 'Use the team to plan, implement, support, and review an onboarding checklist feature across frontend and backend surfaces.'
  })

  const snapshotAfterDispatch = sessionStore.getSessionSnapshot('default')
  const parentTask = snapshotAfterDispatch.tasks.find((task) => task.id === dispatchResult.taskId)
  const plannerTask = snapshotAfterDispatch.tasks.find((task) => task.id === `${dispatchResult.taskId}:planner`)
  const mainAgent = snapshotAfterDispatch.agents.find((agent) => agent.id === 'agent-main')
  const plannerAgent = snapshotAfterDispatch.workflowAgents.find((agent) => agent.stageId === 'planner')
  const executorAgent = snapshotAfterDispatch.workflowAgents.find((agent) => agent.stageId === 'executor')
  const subagentAgent = snapshotAfterDispatch.workflowAgents.find((agent) => agent.stageId === 'subagent')
  const reviewerAgent = snapshotAfterDispatch.workflowAgents.find((agent) => agent.stageId === 'reviewer')

  assert.ok(parentTask, 'expected parent task to appear in snapshot')
  assert.equal(parentTask.status, 'planning')
  assert.deepEqual(parentTask.subTasks, [`${dispatchResult.taskId}:planner`])
  assert.ok(plannerTask, 'expected planner task to be created')
  assert.equal(plannerTask.status, 'executing')
  assert.equal(plannerTask.stageId, 'planner')
  assert.deepEqual(snapshotAfterDispatch.agents.map((agent) => agent.id).sort(), ['agent-main'])
  assert.equal(mainAgent?.status, 'working')
  assert.equal(mainAgent?.currentTask, 'Build onboarding checklist')
  assert.equal(plannerAgent?.name, 'Task Breakdown')
  assert.match(plannerAgent?.role || '', /execution plan/i)
  assert.equal(plannerAgent?.status, 'working')
  assert.equal(executorAgent, undefined)
  assert.equal(subagentAgent, undefined)
  assert.equal(reviewerAgent, undefined)

  await orchestrator.handleNotification({
    method: 'turn/completed',
    params: {
      threadId: plannerAgent.threadId,
      turnId: plannerAgent.activeTurnId,
      turn: {
        outputText: 'Plan ready'
      }
    }
  })

  const snapshotAfterPlanning = sessionStore.getSessionSnapshot('default')
  const executorTask = snapshotAfterPlanning.tasks.find((task) => task.id === `${dispatchResult.taskId}:executor`)
  assert.equal(snapshotAfterPlanning.tasks.find((task) => task.id === dispatchResult.taskId)?.status, 'executing')
  assert.equal(snapshotAfterPlanning.workflowAgents.find((agent) => agent.stageId === 'planner'), undefined)
  assert.equal(snapshotAfterPlanning.workflowAgents.find((agent) => agent.stageId === 'executor')?.status, 'working')
  assert.equal(snapshotAfterPlanning.workflowAgents.find((agent) => agent.stageId === 'reviewer'), undefined)
  assert.ok(executorTask, 'expected executor task to be created after planning')
  assert.equal(executorTask.status, 'executing')
  assert.deepEqual(snapshotAfterPlanning.tasks.find((task) => task.id === dispatchResult.taskId)?.subTasks, [
    `${dispatchResult.taskId}:planner`,
    `${dispatchResult.taskId}:executor`,
  ])

  const executorRuntime = snapshotAfterPlanning.workflowAgents.find((agent) => agent.stageId === 'executor')
  await orchestrator.handleNotification({
    method: 'turn/completed',
    params: {
      threadId: executorRuntime.threadId,
      turnId: executorRuntime.activeTurnId,
      turn: {
        outputText: 'Implementation ready'
      }
    }
  })

  const snapshotAfterExecution = sessionStore.getSessionSnapshot('default')
  const subagentTask = snapshotAfterExecution.tasks.find((task) => task.id === `${dispatchResult.taskId}:subagent`)
  assert.equal(snapshotAfterExecution.tasks.find((task) => task.id === dispatchResult.taskId)?.status, 'executing')
  assert.equal(snapshotAfterExecution.workflowAgents.find((agent) => agent.stageId === 'executor'), undefined)
  assert.equal(snapshotAfterExecution.workflowAgents.find((agent) => agent.stageId === 'subagent')?.status, 'working')
  assert.equal(snapshotAfterExecution.workflowAgents.find((agent) => agent.stageId === 'reviewer'), undefined)
  assert.ok(subagentTask, 'expected subagent task to be created after execution')
  assert.equal(subagentTask.status, 'executing')
  assert.match(snapshotAfterExecution.workflowAgents.find((agent) => agent.stageId === 'subagent')?.name || '', /support/i)
  assert.deepEqual(snapshotAfterExecution.tasks.find((task) => task.id === dispatchResult.taskId)?.subTasks, [
    `${dispatchResult.taskId}:planner`,
    `${dispatchResult.taskId}:executor`,
    `${dispatchResult.taskId}:subagent`,
  ])

  const subagentRuntime = snapshotAfterExecution.workflowAgents.find((agent) => agent.stageId === 'subagent')
  await orchestrator.handleNotification({
    method: 'turn/completed',
    params: {
      threadId: subagentRuntime.threadId,
      turnId: subagentRuntime.activeTurnId,
      turn: {
        outputText: 'Subagent support ready'
      }
    }
  })

  const snapshotAfterSubagent = sessionStore.getSessionSnapshot('default')
  const reviewerTask = snapshotAfterSubagent.tasks.find((task) => task.id === `${dispatchResult.taskId}:reviewer`)
  assert.equal(snapshotAfterSubagent.tasks.find((task) => task.id === dispatchResult.taskId)?.status, 'reviewing')
  assert.equal(snapshotAfterSubagent.workflowAgents.find((agent) => agent.stageId === 'subagent'), undefined)
  assert.equal(snapshotAfterSubagent.workflowAgents.find((agent) => agent.stageId === 'reviewer')?.status, 'working')
  assert.ok(reviewerTask, 'expected reviewer task to be created after execution')
  assert.equal(reviewerTask.status, 'executing')
  assert.equal(snapshotAfterSubagent.workflowAgents.find((agent) => agent.stageId === 'reviewer')?.name, 'Quality Gate')
  assert.deepEqual(snapshotAfterSubagent.tasks.find((task) => task.id === dispatchResult.taskId)?.subTasks, [
    `${dispatchResult.taskId}:planner`,
    `${dispatchResult.taskId}:executor`,
    `${dispatchResult.taskId}:subagent`,
    `${dispatchResult.taskId}:reviewer`,
  ])

  const reviewerRuntime = snapshotAfterSubagent.workflowAgents.find((agent) => agent.stageId === 'reviewer')
  await orchestrator.handleNotification({
    method: 'turn/completed',
    params: {
      threadId: reviewerRuntime.threadId,
      turnId: reviewerRuntime.activeTurnId,
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
  assert.match(completedParentTask?.result || '', /Subagent support ready/)
  assert.match(completedParentTask?.result || '', /Review approved/)
  assert.equal(snapshotAfterReview.agents.find((agent) => agent.id === 'agent-main')?.status, 'idle')
  assert.equal(snapshotAfterReview.workflowAgents.length, 0)

  await orchestrator.stop()
})

test('simple team tasks skip the support workflow agent entirely', async () => {
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
    title: 'Summarize changelog',
    prompt: 'Summarize the latest changelog updates and review the final wording.'
  })

  const plannerRuntime = sessionStore.getSessionSnapshot('default').workflowAgents.find((agent) => agent.stageId === 'planner')
  await orchestrator.handleNotification({
    method: 'turn/completed',
    params: {
      threadId: plannerRuntime.threadId,
      turnId: plannerRuntime.activeTurnId,
      turn: {
        outputText: 'Plan ready'
      }
    }
  })

  const executorRuntime = sessionStore.getSessionSnapshot('default').workflowAgents.find((agent) => agent.stageId === 'executor')
  await orchestrator.handleNotification({
    method: 'turn/completed',
    params: {
      threadId: executorRuntime.threadId,
      turnId: executorRuntime.activeTurnId,
      turn: {
        outputText: 'Draft summary ready'
      }
    }
  })

  const snapshotAfterExecution = sessionStore.getSessionSnapshot('default')
  assert.equal(snapshotAfterExecution.workflowAgents.find((agent) => agent.stageId === 'subagent'), undefined)
  assert.equal(snapshotAfterExecution.workflowAgents.find((agent) => agent.stageId === 'reviewer')?.status, 'working')
  assert.deepEqual(snapshotAfterExecution.tasks.find((task) => task.id === dispatchResult.taskId)?.subTasks, [
    `${dispatchResult.taskId}:planner`,
    `${dispatchResult.taskId}:executor`,
    `${dispatchResult.taskId}:reviewer`,
  ])

  await orchestrator.stop()
})

test('planner prompt stays constrained to a short orchestration step', async () => {
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

  await orchestrator.dispatchTask('default', 'agent-main', {
    title: 'Constrained planner prompt',
    prompt: 'Plan, implement, and review a small workspace refinement.'
  })

  const plannerAssignment = blackboard.events.find((event) => {
    return event.type === 'task_assigned' && event.task?.taskId?.endsWith(':planner')
  })

  assert.ok(plannerAssignment, 'expected planner task assignment event to exist')
  assert.match(plannerAssignment.payload?.prompt || '', /not a full design or spec exercise/i)
  assert.match(plannerAssignment.payload?.prompt || '', /do not read skill documents/i)
  assert.match(plannerAssignment.payload?.prompt || '', /hard cap of 3 directly relevant files or commands/i)
  assert.match(plannerAssignment.payload?.prompt || '', /exactly these sections: Scope, Plan, Risks, Handoff/i)

  await orchestrator.stop()
})
