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

test('agent-main creates multiple duty-based worker agents for long tasks and keeps them until finish', async () => {
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
  const breakdownTask = snapshotAfterDispatch.tasks.find((task) => task.id === `${dispatchResult.taskId}:task-breakdown`)
  const mainAgent = snapshotAfterDispatch.agents.find((agent) => agent.id === 'agent-main')
  const breakdownAgent = snapshotAfterDispatch.workflowAgents.find((agent) => agent.stageId === 'task-breakdown')

  assert.ok(parentTask, 'expected parent task to appear in snapshot')
  assert.equal(parentTask.status, 'planning')
  assert.deepEqual(parentTask.subTasks, [`${dispatchResult.taskId}:task-breakdown`])
  assert.ok(breakdownTask, 'expected breakdown task to be created')
  assert.equal(breakdownTask.status, 'executing')
  assert.equal(breakdownTask.stageId, 'task-breakdown')
  assert.deepEqual(snapshotAfterDispatch.agents.map((agent) => agent.id).sort(), ['agent-main'])
  assert.equal(mainAgent?.status, 'working')
  assert.equal(mainAgent?.currentTask, 'Build onboarding checklist')
  assert.equal(breakdownAgent?.name, 'Task Breakdown')
  assert.match(breakdownAgent?.role || '', /execution plan/i)
  assert.equal(breakdownAgent?.status, 'working')

  await orchestrator.handleNotification({
    method: 'turn/completed',
    params: {
      threadId: breakdownAgent.threadId,
      turnId: breakdownAgent.activeTurnId,
      turn: {
        outputText: 'Plan ready'
      }
    }
  })

  const snapshotAfterBreakdown = sessionStore.getSessionSnapshot('default')
  const workerAgents = snapshotAfterBreakdown.workflowAgents.filter((agent) => {
    return agent.stageId !== 'task-breakdown' && agent.stageId !== 'quality-gate'
  })

  assert.equal(snapshotAfterBreakdown.tasks.find((task) => task.id === dispatchResult.taskId)?.status, 'executing')
  assert.equal(snapshotAfterBreakdown.workflowAgents.find((agent) => agent.stageId === 'task-breakdown')?.status, 'waiting')
  assert.ok(workerAgents.length >= 2, 'expected at least two concurrent worker agents for a long task')
  assert.equal(workerAgents.filter((agent) => agent.status === 'working').length, workerAgents.length)
  assert.ok(workerAgents.some((agent) => /frontend|ui/i.test(agent.name)))
  assert.ok(workerAgents.some((agent) => /backend|integration|data/i.test(agent.name)))
  assert.equal(snapshotAfterBreakdown.workflowAgents.find((agent) => agent.stageId === 'quality-gate'), undefined)
  assert.deepEqual(
    snapshotAfterBreakdown.tasks.find((task) => task.id === dispatchResult.taskId)?.subTasks,
    [`${dispatchResult.taskId}:task-breakdown`, ...workerAgents.map((agent) => `${dispatchResult.taskId}:${agent.stageId}`)]
  )

  for (const workerAgent of workerAgents) {
    await orchestrator.handleNotification({
      method: 'turn/completed',
      params: {
        threadId: workerAgent.threadId,
        turnId: workerAgent.activeTurnId,
        turn: {
          outputText: `${workerAgent.name} ready`
        }
      }
    })
  }

  const snapshotAfterWorkers = sessionStore.getSessionSnapshot('default')
  const reviewerTask = snapshotAfterWorkers.tasks.find((task) => task.id === `${dispatchResult.taskId}:quality-gate`)
  const reviewerRuntime = snapshotAfterWorkers.workflowAgents.find((agent) => agent.stageId === 'quality-gate')
  assert.equal(snapshotAfterWorkers.tasks.find((task) => task.id === dispatchResult.taskId)?.status, 'reviewing')
  assert.ok(reviewerTask, 'expected quality gate task to be created after workers finish')
  assert.equal(reviewerTask.status, 'executing')
  assert.equal(reviewerRuntime?.name, 'Quality Gate')
  assert.equal(reviewerRuntime?.status, 'working')
  assert.ok(snapshotAfterWorkers.workflowAgents.filter((agent) => agent.status === 'waiting').length >= 3)

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

  assert.equal(completedParentTask?.status, 'awaiting_finish')
  assert.match(completedParentTask?.result || '', /Plan ready/)
  assert.match(completedParentTask?.result || '', /ready/)
  assert.match(completedParentTask?.result || '', /Review approved/)
  assert.equal(snapshotAfterReview.agents.find((agent) => agent.id === 'agent-main')?.status, 'waiting')
  assert.ok(snapshotAfterReview.workflowAgents.length >= 4)
  assert.equal(snapshotAfterReview.workflowAgents.find((agent) => agent.stageId === 'task-breakdown')?.status, 'waiting')
  assert.equal(snapshotAfterReview.workflowAgents.find((agent) => agent.stageId === 'quality-gate')?.status, 'waiting')

  await orchestrator.finishTask('default', dispatchResult.taskId)
  const snapshotAfterFinish = sessionStore.getSessionSnapshot('default')
  const finishedParentTask = snapshotAfterFinish.tasks.find((task) => task.id === dispatchResult.taskId)
  assert.equal(finishedParentTask?.status, 'completed')
  assert.equal(snapshotAfterFinish.agents.find((agent) => agent.id === 'agent-main')?.status, 'idle')
  assert.equal(snapshotAfterFinish.workflowAgents.length, 0)

  await orchestrator.stop()
})

test('simple team tasks create a single primary worker before quality gate', async () => {
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

  const breakdownRuntime = sessionStore.getSessionSnapshot('default').workflowAgents.find((agent) => agent.stageId === 'task-breakdown')
  await orchestrator.handleNotification({
    method: 'turn/completed',
    params: {
      threadId: breakdownRuntime.threadId,
      turnId: breakdownRuntime.activeTurnId,
      turn: {
        outputText: 'Plan ready'
      }
    }
  })

  const snapshotAfterBreakdown = sessionStore.getSessionSnapshot('default')
  const workerRuntimes = snapshotAfterBreakdown.workflowAgents.filter((agent) => {
    return agent.stageId !== 'task-breakdown' && agent.stageId !== 'quality-gate'
  })
  assert.equal(workerRuntimes.length, 1)
  const executorRuntime = workerRuntimes[0]
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
  assert.equal(snapshotAfterExecution.workflowAgents.find((agent) => agent.stageId === executorRuntime.stageId)?.status, 'waiting')
  assert.equal(snapshotAfterExecution.workflowAgents.find((agent) => agent.stageId === 'quality-gate')?.status, 'working')
  assert.deepEqual(snapshotAfterExecution.tasks.find((task) => task.id === dispatchResult.taskId)?.subTasks, [
    `${dispatchResult.taskId}:task-breakdown`,
    `${dispatchResult.taskId}:${executorRuntime.stageId}`,
    `${dispatchResult.taskId}:quality-gate`,
  ])

  await orchestrator.stop()
})

test('awaiting-finish team tasks can be finished after orchestrator restart', async () => {
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
    title: 'Restart-safe finish flow',
    prompt: 'Use the team to plan, implement, support, and review a restart-safe finish flow.'
  })

  const breakdownRuntime = sessionStore.getSessionSnapshot('default').workflowAgents.find((agent) => agent.stageId === 'task-breakdown')
  await orchestrator.handleNotification({
    method: 'turn/completed',
    params: {
      threadId: breakdownRuntime.threadId,
      turnId: breakdownRuntime.activeTurnId,
      turn: {
        outputText: 'task-breakdown ready'
      }
    }
  })

  const workerRuntimes = sessionStore.getSessionSnapshot('default').workflowAgents.filter((agent) => {
    return agent.stageId !== 'task-breakdown' && agent.stageId !== 'quality-gate'
  })
  for (const runtime of workerRuntimes) {
    await orchestrator.handleNotification({
      method: 'turn/completed',
      params: {
        threadId: runtime.threadId,
        turnId: runtime.activeTurnId,
        turn: {
          outputText: `${runtime.stageId} ready`
        }
      }
    })
  }

  const reviewerRuntime = sessionStore.getSessionSnapshot('default').workflowAgents.find((agent) => agent.stageId === 'quality-gate')
  await orchestrator.handleNotification({
    method: 'turn/completed',
    params: {
      threadId: reviewerRuntime.threadId,
      turnId: reviewerRuntime.activeTurnId,
      turn: {
        outputText: 'quality gate ready'
      }
    }
  })

  const snapshotBeforeRestart = sessionStore.getSessionSnapshot('default')
  assert.equal(snapshotBeforeRestart.tasks.find((task) => task.id === dispatchResult.taskId)?.status, 'awaiting_finish')

  await orchestrator.stop()

  const restartedSessionStore = new SessionStore()
  for (const task of snapshotBeforeRestart.tasks) {
    restartedSessionStore.syncTask(task)
  }
  for (const agent of snapshotBeforeRestart.agents) {
    restartedSessionStore.syncAgent('default', agent)
  }

  const restartedOrchestrator = new CodexOrchestrator({
    client: new FakeCodexClient(),
    registry: new AgentRegistry(),
    blackboard: new FakeBlackboardStore(),
    sessionStore: restartedSessionStore,
    broadcast: () => {}
  })

  await restartedOrchestrator.start()

  const finishResult = await restartedOrchestrator.finishTask('default', dispatchResult.taskId)
  assert.equal(finishResult.status, 'completed')

  const snapshotAfterFinish = restartedSessionStore.getSessionSnapshot('default')
  assert.equal(snapshotAfterFinish.tasks.find((task) => task.id === dispatchResult.taskId)?.status, 'completed')
  assert.equal(snapshotAfterFinish.agents.find((agent) => agent.id === 'agent-main')?.status, 'idle')
  assert.equal(snapshotAfterFinish.workflowAgents.length, 0)

  await restartedOrchestrator.stop()
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
    return event.type === 'task_assigned' && event.task?.taskId?.endsWith(':task-breakdown')
  })

  assert.ok(plannerAssignment, 'expected planner task assignment event to exist')
  assert.match(plannerAssignment.payload?.prompt || '', /not a full design or spec exercise/i)
  assert.match(plannerAssignment.payload?.prompt || '', /do not read skill documents/i)
  assert.match(plannerAssignment.payload?.prompt || '', /hard cap of 3 directly relevant files or commands/i)
  assert.match(plannerAssignment.payload?.prompt || '', /exactly these sections: Scope, Workstreams, Risks, Handoff/i)

  await orchestrator.stop()
})

test('team workflows cannot stack while another root workflow is still active', async () => {
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
    title: 'First workflow',
    prompt: 'Use the agent team to execute the first workflow.'
  })

  await assert.rejects(
    orchestrator.dispatchTask('default', 'agent-main', {
      title: 'Second workflow',
      prompt: 'Use the agent team to execute the second workflow.'
    }),
    /Finish or resolve the current team task first/
  )

  await orchestrator.stop()
})
