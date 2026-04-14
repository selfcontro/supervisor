const { randomUUID } = require('node:crypto')
const { serializeAgent } = require('./agentRegistry')

class CodexOrchestrator {
  constructor(options) {
    this.client = options.client
    this.registry = options.registry
    this.blackboard = options.blackboard
    this.sessionStore = options.sessionStore
    this.broadcast = options.broadcast
    this.autoApprovalMode = process.env.CODEX_AUTO_APPROVAL_MODE || 'manual'
    this.commandRuns = new Map()
    this.teamWorkflows = new Map()
    this.teamTaskIndex = new Map()
    this.started = false

    if (this.sessionStore && typeof this.sessionStore.setRuntimeAgentProvider === 'function') {
      this.sessionStore.setRuntimeAgentProvider((sessionId) => this.listAgents(sessionId))
    }
  }

  async start() {
    if (this.started) {
      return
    }

    this.client.on('notification', message => {
      this.handleNotification(message).catch(error => {
        this.emitSystemLog('error', `Codex notification handling failed: ${error.message}`)
      })
    })

    this.client.on('server_request', message => {
      this.handleServerRequest(message).catch(error => {
        this.emitSystemLog('error', `Codex server request handling failed: ${error.message}`)
      })
    })

    this.client.on('stderr', output => {
      this.emitSystemLog('warning', output.trim())
    })

    this.client.on('close', info => {
      this.emitSystemLog('error', `Codex app-server closed (code=${info.code}, signal=${info.signal || 'none'})`)
    })

    await this.client.start()
    this.started = true
    this.emitSystemLog('info', 'Codex app-server connected')
  }

  async stop() {
    if (!this.started) {
      return
    }

    await this.client.stop()
    this.started = false
  }

  async createOrActivateAgent(sessionId, agentId, options = {}) {
    this.ensureStarted()

    const session = this.sessionStore.ensureSession(sessionId)
    const normalizedSessionId = session.id
    const agent = this.registry.ensureAgent(normalizedSessionId, agentId, {
      harness: options.harness || {},
      name: options.name,
      role: options.role,
      ephemeral: options.ephemeral,
      workflowParentTaskId: options.workflowParentTaskId,
      stageId: options.stageId
    })

    if (!agent.threadId) {
      const threadResult = await this.client.startThread(this.buildThreadStartParams(agent))
      const threadId = extractThreadId(threadResult)

      if (!threadId) {
        throw new Error('Codex did not return a threadId')
      }

      this.registry.setThread(normalizedSessionId, agent.agentId, threadId)
      await this.blackboard.appendEvent({
        sessionId: normalizedSessionId,
        agentId: agent.agentId,
        threadId,
        type: 'agent_state',
        payload: {
          state: 'ready',
          event: 'thread_started'
        }
      })
    }

    const publicAgent = serializeAgent(this.registry.getAgent(normalizedSessionId, agent.agentId))
    this.emitAgentStatus(publicAgent)
    return publicAgent
  }

  listAgents(sessionId) {
    return this.registry.listAgents(sessionId).map((agent) => {
      const activeTask = this.registry.getActiveTask(agent.sessionId, agent.agentId)
      return {
        ...agent,
        name: agent.name || readableAgentName(agent.agentId),
        role: agent.role || getAgentRole(agent.stageId || agent.agentId),
        currentTask: activeTask ? activeTask.title : null
      }
    })
  }

  async dispatchTask(sessionId, agentId, payload = {}) {
    if (agentId === 'agent-main') {
      return this.dispatchTeamTask(sessionId, payload)
    }

    return this.dispatchDirectTask(sessionId, agentId, payload)
  }

  async dispatchDirectTask(sessionId, agentId, payload = {}) {
    this.ensureStarted()
    const prompt = typeof payload.prompt === 'string' ? payload.prompt.trim() : ''
    if (!prompt) {
      throw new Error('Prompt is required')
    }

    const title = typeof payload.title === 'string' && payload.title.trim()
      ? payload.title.trim()
      : prompt.slice(0, 80)

    const agent = await this.createOrActivateAgent(sessionId, agentId, {
      harness: payload.harness || {}
    })

    const runtimeAgent = this.registry.getAgent(agent.sessionId, agent.agentId)
    const taskId = payload.taskId || `codex_task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    const task = {
      taskId,
      title,
      prompt,
      status: 'assigned',
      attempt: 1,
      priority: payload.priority || 'normal',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      turnHistory: []
    }

    this.registry.addTask(agent.sessionId, agent.agentId, task)
    this.syncRuntimeTaskToSession(agent.sessionId, agent.agentId, task)
    this.registry.setActiveTask(agent.sessionId, agent.agentId, taskId)

    await this.blackboard.appendEvent({
      sessionId: agent.sessionId,
      agentId: agent.agentId,
      threadId: runtimeAgent.threadId,
      type: 'task_assigned',
      task: {
        taskId,
        title,
        status: 'assigned',
        priority: task.priority
      },
      payload: {
        prompt
      },
      idempotencyKey: `${agent.sessionId}:${agent.agentId}:${taskId}:assigned`
    })

    const turnResult = await this.client.startTurn({
      threadId: runtimeAgent.threadId,
      input: [{
        type: 'text',
        text: prompt
      }]
    })

    const turnId = extractTurnId(turnResult)
    this.registry.updateAgentState(agent.sessionId, agent.agentId, 'working', turnId)
    this.registry.updateTask(agent.sessionId, agent.agentId, taskId, {
      status: 'executing',
      turnId,
      turnHistory: [...task.turnHistory, turnId].filter(Boolean)
    })
    this.syncRuntimeTaskToSession(agent.sessionId, agent.agentId, this.registry.getTask(agent.sessionId, agent.agentId, taskId))

    this.broadcast({
      type: 'task_update',
      sessionId: agent.sessionId,
      payload: {
        taskId,
        data: {
          status: 'executing',
          turnId,
          agentId: agent.agentId,
          updatedAt: new Date().toISOString()
        }
      }
    })

    this.emitAgentStatus(serializeAgent(this.registry.getAgent(agent.sessionId, agent.agentId)))

    return {
      taskId,
      turnId,
      threadId: runtimeAgent.threadId,
      status: 'accepted'
    }
  }

  async dispatchTeamTask(sessionId, payload = {}) {
    this.ensureStarted()
    const prompt = typeof payload.prompt === 'string' ? payload.prompt.trim() : ''
    if (!prompt) {
      throw new Error('Prompt is required')
    }

    const title = typeof payload.title === 'string' && payload.title.trim()
      ? payload.title.trim()
      : prompt.slice(0, 80)

    const coordinator = await this.createOrActivateAgent(sessionId, 'agent-main', {
      harness: payload.harness || {}
    })
    const parentTaskId = payload.taskId || `codex_task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const createdAt = new Date().toISOString()
    const parentTask = {
      taskId: parentTaskId,
      title,
      prompt,
      status: 'planning',
      attempt: 1,
      priority: payload.priority || 'normal',
      createdAt,
      updatedAt: createdAt,
      turnHistory: [],
      subTasks: []
    }

    this.registry.addTask(coordinator.sessionId, coordinator.agentId, parentTask)
    this.registry.setActiveTask(coordinator.sessionId, coordinator.agentId, parentTaskId)
    this.registry.updateAgentState(coordinator.sessionId, coordinator.agentId, 'working', null)
    this.syncRuntimeTaskToSession(coordinator.sessionId, coordinator.agentId, parentTask)
    this.emitAgentStatus(serializeAgent(this.registry.getAgent(coordinator.sessionId, coordinator.agentId)))

    await this.blackboard.appendEvent({
      sessionId: coordinator.sessionId,
      agentId: coordinator.agentId,
      threadId: this.registry.getAgent(coordinator.sessionId, coordinator.agentId)?.threadId,
      type: 'task_assigned',
      task: {
        taskId: parentTaskId,
        title,
        status: 'planning',
        priority: parentTask.priority
      },
      payload: {
        prompt,
        orchestration: 'agent_team'
      },
      idempotencyKey: `${coordinator.sessionId}:${coordinator.agentId}:${parentTaskId}:assigned`
    })

    const workflow = {
      sessionId: coordinator.sessionId,
      parentTaskId,
      parentAgentId: coordinator.agentId,
      title,
      prompt,
      priority: parentTask.priority,
      stages: BASE_WORKFLOW_STAGES,
      stageTaskIds: new Map(),
      stageResults: new Map(),
      needsSupportStage: null
    }

    this.trackWorkflow(workflow, parentTaskId)
    await this.startWorkflowStage(workflow, 'planner')

    return {
      taskId: parentTaskId,
      turnId: null,
      threadId: this.registry.getAgent(coordinator.sessionId, coordinator.agentId)?.threadId || null,
      status: 'accepted'
    }
  }

  async startWorkflowStage(workflow, stageId) {
    const stageRuntimeAgentId = workflowAgentId(workflow.parentTaskId, stageId)
    const descriptor = getStageDescriptor(stageId, workflow)
    const stageTitle = `${workflow.title} · ${descriptor.name}`
    const stageTaskId = `${workflow.parentTaskId}:${stageId}`
    const stagePrompt = this.buildStagePrompt(workflow, stageId)
    await this.createOrActivateAgent(workflow.sessionId, stageRuntimeAgentId, {
      name: descriptor.name,
      role: descriptor.role,
      ephemeral: true,
      workflowParentTaskId: workflow.parentTaskId,
      stageId
    })
    const runtimeAgent = this.registry.getAgent(workflow.sessionId, stageRuntimeAgentId)
    const parentStatus = parentStatusForStage(stageId)
    const createdAt = new Date().toISOString()
    const stageTask = {
      taskId: stageTaskId,
      title: stageTitle,
      prompt: stagePrompt,
      status: 'assigned',
      attempt: 1,
      priority: workflow.priority,
      createdAt,
      updatedAt: createdAt,
      turnHistory: [],
      parentTaskId: workflow.parentTaskId,
      stageId
    }

    workflow.stageTaskIds.set(stageId, stageTaskId)
    this.trackWorkflow(workflow, stageTaskId)
    this.registry.addTask(workflow.sessionId, stageRuntimeAgentId, stageTask)
    this.registry.setActiveTask(workflow.sessionId, stageRuntimeAgentId, stageTaskId)
    this.registry.updateTask(workflow.sessionId, workflow.parentAgentId, workflow.parentTaskId, {
      status: parentStatus,
      subTasks: getWorkflowSubTaskIds(workflow)
    })
    this.syncRuntimeTaskToSession(
      workflow.sessionId,
      workflow.parentAgentId,
      this.registry.getTask(workflow.sessionId, workflow.parentAgentId, workflow.parentTaskId)
    )

    await this.blackboard.appendEvent({
      sessionId: workflow.sessionId,
      agentId: stageRuntimeAgentId,
      threadId: runtimeAgent.threadId,
      type: 'task_assigned',
      task: {
        taskId: stageTaskId,
        title: stageTitle,
        status: 'assigned',
        priority: workflow.priority
      },
      payload: {
        prompt: stagePrompt,
        parentTaskId: workflow.parentTaskId,
        orchestration: 'agent_team',
        stageId
      },
      idempotencyKey: `${workflow.sessionId}:${stageRuntimeAgentId}:${stageTaskId}:assigned`
    })

    const turnResult = await this.client.startTurn({
      threadId: runtimeAgent.threadId,
      input: [{
        type: 'text',
        text: stagePrompt
      }]
    })

    const turnId = extractTurnId(turnResult)
    this.registry.updateAgentState(workflow.sessionId, stageRuntimeAgentId, 'working', turnId)
    this.registry.updateTask(workflow.sessionId, stageRuntimeAgentId, stageTaskId, {
      status: 'executing',
      turnId,
      turnHistory: [turnId].filter(Boolean)
    })

    const syncedStageTask = this.registry.getTask(workflow.sessionId, stageRuntimeAgentId, stageTaskId)
    this.syncRuntimeTaskToSession(workflow.sessionId, stageRuntimeAgentId, syncedStageTask)
    this.emitTaskUpdate(workflow.sessionId, workflow.parentTaskId, {
      status: parentStatus,
      stage: stageId,
      updatedAt: new Date().toISOString(),
      agentId: workflow.parentAgentId
    })
    this.emitTaskUpdate(workflow.sessionId, stageTaskId, {
      status: 'executing',
      turnId,
      updatedAt: new Date().toISOString(),
      agentId: stageRuntimeAgentId,
      parentTaskId: workflow.parentTaskId,
      stageId
    })
    this.emitAgentStatus(serializeAgent(this.registry.getAgent(workflow.sessionId, workflow.parentAgentId)))
    this.emitAgentStatus(serializeAgent(this.registry.getAgent(workflow.sessionId, stageRuntimeAgentId)))

    return {
      taskId: stageTaskId,
      threadId: runtimeAgent.threadId,
      turnId
    }
  }

  buildStagePrompt(workflow, stageAgentId) {
    const plan = workflow.stageResults.get('planner') || ''
    const execution = workflow.stageResults.get('executor') || ''
    const subagentOutput = workflow.stageResults.get('subagent') || ''
    const descriptor = getStageDescriptor(stageAgentId, workflow)

    if (stageAgentId === 'planner') {
      return [
        `You are ${descriptor.name}, responsible for ${descriptor.role.toLowerCase()}.`,
        `Parent task: ${workflow.title}`,
        `User request: ${workflow.prompt}`,
        'Produce a concise execution plan, success criteria, and handoff notes for the executor.'
      ].join('\n\n')
    }

    if (stageAgentId === 'executor') {
      return [
        `You are ${descriptor.name}, responsible for ${descriptor.role.toLowerCase()}.`,
        `Parent task: ${workflow.title}`,
        `User request: ${workflow.prompt}`,
        `Planner output:\n${plan || 'No planner output provided.'}`,
        'Carry out the implementation or analysis requested. End with a concise execution summary for the next specialist.'
      ].join('\n\n')
    }

    if (stageAgentId === 'subagent') {
      return [
        `You are ${descriptor.name}, responsible for ${descriptor.role.toLowerCase()}.`,
        `Parent task: ${workflow.title}`,
        `User request: ${workflow.prompt}`,
        `Planner output:\n${plan || 'No planner output provided.'}`,
        `Executor output:\n${execution || 'No executor output provided.'}`,
        'Provide focused support work that strengthens the implementation, then end with a concise handoff summary for the reviewer.'
      ].join('\n\n')
    }

    return [
      `You are ${descriptor.name}, responsible for ${descriptor.role.toLowerCase()}.`,
      `Parent task: ${workflow.title}`,
      `User request: ${workflow.prompt}`,
      `Planner output:\n${plan || 'No planner output provided.'}`,
      `Executor output:\n${execution || 'No executor output provided.'}`,
      `Subagent output:\n${subagentOutput || 'No subagent output provided.'}`,
      'Review the work, identify risks, and state whether the result is ready.'
    ].join('\n\n')
  }

  trackWorkflow(workflow, taskId) {
    this.teamWorkflows.set(workflowKey(workflow.sessionId, workflow.parentTaskId), workflow)
    this.teamTaskIndex.set(workflowTaskKey(workflow.sessionId, taskId), workflow.parentTaskId)
  }

  getWorkflowForTask(sessionId, taskId) {
    const parentTaskId = this.teamTaskIndex.get(workflowTaskKey(sessionId, taskId))
    if (!parentTaskId) {
      return null
    }

    return this.teamWorkflows.get(workflowKey(sessionId, parentTaskId)) || null
  }

  async advanceWorkflowOnCompletion(agent, task, result) {
    const workflow = this.getWorkflowForTask(agent.sessionId, task.taskId)
    if (!workflow || task.taskId === workflow.parentTaskId) {
      return
    }

    const stageId = task.stageId || parseStageId(task.taskId)
    workflow.stageResults.set(stageId, result || '')
    await this.closeWorkflowAgent(workflow, stageId)
    const nextStageId = this.getNextWorkflowStage(workflow, stageId, result || '')

    if (nextStageId) {
      await this.startWorkflowStage(workflow, nextStageId)
      return
    }

    const parentResult = getWorkflowSummaryStages(workflow)
      .map((stageId) => `${getStageDescriptor(stageId, workflow).name}\n${workflow.stageResults.get(stageId) || ''}`.trim())
      .join('\n\n')

    const updatedParentTask = this.registry.updateTask(workflow.sessionId, workflow.parentAgentId, workflow.parentTaskId, {
      status: 'completed',
      result: parentResult,
      subTasks: getWorkflowSubTaskIds(workflow)
    })

    if (updatedParentTask) {
      this.syncRuntimeTaskToSession(workflow.sessionId, workflow.parentAgentId, updatedParentTask)
      this.emitTaskUpdate(workflow.sessionId, workflow.parentTaskId, {
        status: 'completed',
        result: updatedParentTask.result,
        updatedAt: updatedParentTask.updatedAt,
        agentId: workflow.parentAgentId
      })
    }

    this.registry.setActiveTask(workflow.sessionId, workflow.parentAgentId, null)
    this.registry.updateAgentState(workflow.sessionId, workflow.parentAgentId, 'idle', null)
    this.emitAgentStatus(serializeAgent(this.registry.getAgent(workflow.sessionId, workflow.parentAgentId)))
    await this.closeWorkflowAgents(workflow)
    this.cleanupWorkflow(workflow)
  }

  async failWorkflow(agent, task, error) {
    const workflow = this.getWorkflowForTask(agent.sessionId, task.taskId)
    if (!workflow || task.taskId === workflow.parentTaskId) {
      return
    }

    const updatedParentTask = this.registry.updateTask(workflow.sessionId, workflow.parentAgentId, workflow.parentTaskId, {
      status: 'failed',
      error,
      subTasks: getWorkflowSubTaskIds(workflow)
    })

    if (updatedParentTask) {
      this.syncRuntimeTaskToSession(workflow.sessionId, workflow.parentAgentId, updatedParentTask)
      this.emitTaskUpdate(workflow.sessionId, workflow.parentTaskId, {
        status: 'failed',
        error,
        updatedAt: updatedParentTask.updatedAt,
        agentId: workflow.parentAgentId
      })
    }

    this.registry.setActiveTask(workflow.sessionId, workflow.parentAgentId, null)
    this.registry.updateAgentState(workflow.sessionId, workflow.parentAgentId, 'error', null)
    this.emitAgentStatus(serializeAgent(this.registry.getAgent(workflow.sessionId, workflow.parentAgentId)))
    await this.closeWorkflowAgent(workflow, task.stageId || parseStageId(task.taskId))
    await this.closeWorkflowAgents(workflow)
    this.cleanupWorkflow(workflow)
  }

  async closeWorkflowAgents(workflow) {
    for (const stageId of ALL_WORKFLOW_STAGES) {
      await this.closeWorkflowAgent(workflow, stageId)
    }
  }

  async closeWorkflowAgent(workflow, stageId) {
    if (!stageId) {
      return
    }

    const agentId = workflowAgentId(workflow.parentTaskId, stageId)
    const runtimeAgent = this.registry.getAgent(workflow.sessionId, agentId)
    if (!runtimeAgent || runtimeAgent.state === 'closed') {
      return
    }

    this.registry.closeAgent(workflow.sessionId, agentId)
    this.emitAgentStatus(serializeAgent(this.registry.getAgent(workflow.sessionId, agentId)))
  }

  getNextWorkflowStage(workflow, completedStageId, stageResult) {
    if (completedStageId === 'planner') {
      return 'executor'
    }

    if (completedStageId === 'executor') {
      const needsSupportStage = shouldUseSupportStage(workflow, stageResult)
      workflow.needsSupportStage = needsSupportStage
      return needsSupportStage ? 'subagent' : 'reviewer'
    }

    if (completedStageId === 'subagent') {
      return 'reviewer'
    }

    return null
  }

  cleanupWorkflow(workflow) {
    this.teamWorkflows.delete(workflowKey(workflow.sessionId, workflow.parentTaskId))
    this.teamTaskIndex.delete(workflowTaskKey(workflow.sessionId, workflow.parentTaskId))
    for (const stageTaskId of workflow.stageTaskIds.values()) {
      this.teamTaskIndex.delete(workflowTaskKey(workflow.sessionId, stageTaskId))
    }
  }

  async interrupt(sessionId, agentId) {
    this.ensureStarted()
    const agent = this.registry.getAgent(sessionId, agentId)

    if (!agent) {
      throw new Error('Agent not found')
    }

    if (!agent.threadId || !agent.activeTurnId) {
      throw new Error('Agent has no active turn')
    }

    await this.client.interruptTurn({
      threadId: agent.threadId,
      turnId: agent.activeTurnId
    })

    const activeTask = this.registry.getActiveTask(sessionId, agentId)
    if (activeTask) {
      const updatedTask = this.registry.updateTask(sessionId, agentId, activeTask.taskId, {
        status: 'interrupted'
      })
      if (updatedTask) {
        this.syncRuntimeTaskToSession(sessionId, agentId, updatedTask)
        this.emitTaskUpdate(sessionId, updatedTask.taskId, {
          status: updatedTask.status,
          updatedAt: updatedTask.updatedAt,
          agentId
        })
      }
    }

    this.registry.updateAgentState(sessionId, agentId, 'idle', null)
    await this.blackboard.appendEvent({
      sessionId,
      agentId,
      threadId: agent.threadId,
      turnId: agent.activeTurnId,
      type: 'task_progress',
      task: activeTask ? {
        taskId: activeTask.taskId,
        title: activeTask.title,
        status: 'interrupted',
        priority: activeTask.priority
      } : null,
      payload: {
        action: 'interrupt'
      }
    })

    this.emitAgentStatus(serializeAgent(this.registry.getAgent(sessionId, agentId)))
    return { ok: true }
  }

  async resume(sessionId, agentId, payload = {}) {
    this.ensureStarted()
    const agent = this.registry.getAgent(sessionId, agentId)

    if (!agent || !agent.threadId) {
      throw new Error('Agent not found')
    }

    const activeTask = this.registry.getActiveTask(sessionId, agentId)
    if (!activeTask) {
      throw new Error('No active task to resume')
    }

    const prompt = typeof payload.prompt === 'string' && payload.prompt.trim()
      ? payload.prompt.trim()
      : `Continue task ${activeTask.taskId}: ${activeTask.title}`

    const turnResult = await this.client.startTurn({
      threadId: agent.threadId,
      input: [{ type: 'text', text: prompt }]
    })

    const turnId = extractTurnId(turnResult)
    const turnHistory = Array.isArray(activeTask.turnHistory) ? activeTask.turnHistory : []

    this.registry.updateTask(sessionId, agentId, activeTask.taskId, {
      status: 'executing',
      turnId,
      turnHistory: [...turnHistory, turnId].filter(Boolean)
    })
    this.syncRuntimeTaskToSession(sessionId, agentId, this.registry.getTask(sessionId, agentId, activeTask.taskId))
    this.registry.updateAgentState(sessionId, agentId, 'working', turnId)
    this.emitTaskUpdate(sessionId, activeTask.taskId, {
      status: 'executing',
      turnId,
      updatedAt: new Date().toISOString(),
      agentId
    })

    await this.blackboard.appendEvent({
      sessionId,
      agentId,
      threadId: agent.threadId,
      turnId,
      type: 'task_progress',
      task: {
        taskId: activeTask.taskId,
        title: activeTask.title,
        status: 'executing',
        priority: activeTask.priority
      },
      payload: {
        action: 'resume',
        prompt
      }
    })

    this.emitAgentStatus(serializeAgent(this.registry.getAgent(sessionId, agentId)))
    return { ok: true, turnId }
  }

  async retry(sessionId, agentId, taskId) {
    this.ensureStarted()
    const agent = this.registry.getAgent(sessionId, agentId)

    if (!agent || !agent.threadId) {
      throw new Error('Agent not found')
    }

    const task = this.registry.getTask(sessionId, agentId, taskId)
    if (!task) {
      throw new Error('Task not found')
    }

    const nextAttempt = Number(task.attempt || 1) + 1
    const turnResult = await this.client.startTurn({
      threadId: agent.threadId,
      input: [{ type: 'text', text: task.prompt }]
    })

    const turnId = extractTurnId(turnResult)
    const history = Array.isArray(task.turnHistory) ? task.turnHistory : []

    this.registry.updateTask(sessionId, agentId, taskId, {
      status: 'executing',
      turnId,
      attempt: nextAttempt,
      turnHistory: [...history, turnId].filter(Boolean)
    })
    this.syncRuntimeTaskToSession(sessionId, agentId, this.registry.getTask(sessionId, agentId, taskId))
    this.registry.setActiveTask(sessionId, agentId, taskId)
    this.registry.updateAgentState(sessionId, agentId, 'working', turnId)
    this.emitTaskUpdate(sessionId, taskId, {
      status: 'executing',
      turnId,
      updatedAt: new Date().toISOString(),
      agentId
    })

    await this.blackboard.appendEvent({
      sessionId,
      agentId,
      threadId: agent.threadId,
      turnId,
      type: 'task_progress',
      task: {
        taskId,
        title: task.title,
        status: 'executing',
        priority: task.priority
      },
      payload: {
        action: 'retry',
        attempt: nextAttempt
      }
    })

    this.emitAgentStatus(serializeAgent(this.registry.getAgent(sessionId, agentId)))
    return { ok: true, turnId, attempt: nextAttempt }
  }

  async closeAgent(sessionId, agentId) {
    const agent = this.registry.getAgent(sessionId, agentId)
    if (!agent) {
      throw new Error('Agent not found')
    }

    if (agent.threadId) {
      await this.client.unsubscribeThread({ threadId: agent.threadId })
    }

    this.registry.closeAgent(sessionId, agentId)
    await this.blackboard.appendEvent({
      sessionId,
      agentId,
      threadId: agent.threadId,
      type: 'agent_state',
      payload: {
        state: 'closed',
        event: 'agent_closed'
      }
    })

    this.emitAgentStatus(serializeAgent(this.registry.getAgent(sessionId, agentId)))
    return { ok: true }
  }

  async respondApproval(sessionId, agentId, requestId, decision) {
    const pending = this.registry.resolvePendingApproval(sessionId, agentId, requestId)
    if (!pending) {
      throw new Error('Approval request not found')
    }

    this.client.respond(requestId, {
      decision
    })

    await this.blackboard.appendEvent({
      sessionId,
      agentId,
      threadId: pending.threadId,
      turnId: pending.turnId,
      type: 'approval_resolved',
      task: pending.task,
      payload: {
        requestId,
        decision
      }
    })

    this.broadcast({
      type: 'approval_resolved',
      sessionId,
      payload: {
        requestId,
        agentId,
        decision
      }
    })

    return { ok: true }
  }

  async getSessionBlackboard(sessionId) {
    return this.blackboard.getSessionSummary(sessionId)
  }

  async getAgentBlackboard(sessionId, agentId) {
    const events = await this.blackboard.getAgentEvents(sessionId, agentId)
    return {
      sessionId,
      agentId,
      eventCount: events.length,
      latestEventAt: events.length ? events[events.length - 1].ts : null,
      events
    }
  }

  async getSessionMarkdown(sessionId) {
    await this.blackboard.materializeSessionMarkdown(sessionId)
    return this.blackboard.readSessionMarkdown(sessionId)
  }

  async getAgentMarkdown(sessionId, agentId) {
    await this.blackboard.materializeAgentMarkdown(sessionId, agentId)
    return this.blackboard.readAgentMarkdown(sessionId, agentId)
  }

  async handleNotification(message) {
    const method = message.method
    const params = message.params || {}
    const threadId = extractThreadId(params)
    const turnId = extractTurnId(params)

    if (!threadId) {
      return
    }

    const agent = this.registry.findByThreadId(threadId)
    if (!agent) {
      return
    }

    const task = this.registry.getActiveTask(agent.sessionId, agent.agentId)

    if (method === 'turn/started') {
      this.registry.updateAgentState(agent.sessionId, agent.agentId, 'working', turnId)

      if (task) {
        this.registry.updateTask(agent.sessionId, agent.agentId, task.taskId, {
          status: 'executing',
          turnId
        })
        this.syncRuntimeTaskToSession(agent.sessionId, agent.agentId, this.registry.getTask(agent.sessionId, agent.agentId, task.taskId))

        await this.blackboard.appendEvent({
          sessionId: agent.sessionId,
          agentId: agent.agentId,
          threadId,
          turnId,
          type: 'task_progress',
          task: {
            taskId: task.taskId,
            title: task.title,
            status: 'executing',
            priority: task.priority
          },
          payload: {
            event: 'turn_started'
          },
          idempotencyKey: `${threadId}:${turnId}:turn_started`
        })
      }

      this.emitAgentStatus(serializeAgent(this.registry.getAgent(agent.sessionId, agent.agentId)))
      return
    }

    if (method === 'turn/completed') {
      const turnResult = extractTurnResult(params)

      if (task) {
        const updatedTask = this.registry.updateTask(agent.sessionId, agent.agentId, task.taskId, {
          status: 'completed',
          result: turnResult
        })
        this.syncRuntimeTaskToSession(agent.sessionId, agent.agentId, updatedTask)

        await this.blackboard.appendEvent({
          sessionId: agent.sessionId,
          agentId: agent.agentId,
          threadId,
          turnId,
          type: 'task_done',
          task: {
            taskId: task.taskId,
            title: task.title,
            status: 'completed',
            priority: task.priority
          },
          payload: {
            result: turnResult
          },
          idempotencyKey: `${threadId}:${turnId}:turn_completed`
        })
        if (updatedTask) {
          this.emitTaskUpdate(agent.sessionId, task.taskId, {
            status: updatedTask.status,
            result: updatedTask.result,
            updatedAt: updatedTask.updatedAt,
            agentId: agent.agentId
          })
        }
      }

      this.registry.setActiveTask(agent.sessionId, agent.agentId, null)
      this.registry.updateAgentState(agent.sessionId, agent.agentId, 'idle', null)
      this.emitAgentStatus(serializeAgent(this.registry.getAgent(agent.sessionId, agent.agentId)))
      if (task) {
        await this.advanceWorkflowOnCompletion(agent, task, turnResult)
      }
      return
    }

    if (method === 'turn/failed' || method === 'turn/errored' || method === 'turn/error') {
      const error = extractError(params)

      if (task) {
        const updatedTask = this.registry.updateTask(agent.sessionId, agent.agentId, task.taskId, {
          status: 'failed',
          error
        })
        this.syncRuntimeTaskToSession(agent.sessionId, agent.agentId, updatedTask)

        await this.blackboard.appendEvent({
          sessionId: agent.sessionId,
          agentId: agent.agentId,
          threadId,
          turnId,
          type: 'task_failed',
          task: {
            taskId: task.taskId,
            title: task.title,
            status: 'failed',
            priority: task.priority
          },
          payload: {
            error
          },
          idempotencyKey: `${threadId}:${turnId}:turn_failed`
        })
        if (updatedTask) {
          this.emitTaskUpdate(agent.sessionId, task.taskId, {
            status: updatedTask.status,
            error: updatedTask.error,
            updatedAt: updatedTask.updatedAt,
            agentId: agent.agentId
          })
        }
      }

      this.registry.setActiveTask(agent.sessionId, agent.agentId, null)
      this.registry.updateAgentState(agent.sessionId, agent.agentId, 'error', null)
      this.emitAgentStatus(serializeAgent(this.registry.getAgent(agent.sessionId, agent.agentId)))
      if (task) {
        await this.failWorkflow(agent, task, error)
      }
      return
    }

    if (method === 'item/started') {
      this.captureCommandStart(agent, params)
      return
    }

    if (method === 'item/commandExecution/outputDelta') {
      this.captureCommandDelta(agent, params)
      return
    }

    if (method === 'item/completed') {
      await this.captureCommandCompleted(agent, params)
    }
  }

  async handleServerRequest(message) {
    const params = message.params || {}
    const method = message.method

    if (method !== 'item/commandExecution/requestApproval') {
      this.client.respond(message.id, {})
      return
    }

    const threadId = extractThreadId(params)
    const turnId = extractTurnId(params)
    const agent = this.registry.findByThreadId(threadId)

    if (!agent) {
      this.client.respond(message.id, {
        decision: 'deny'
      })
      return
    }

    const task = this.registry.getActiveTask(agent.sessionId, agent.agentId)
    const availableDecisions = Array.isArray(params.availableDecisions) ? params.availableDecisions : []
    const approval = {
      requestId: message.id,
      sessionId: agent.sessionId,
      agentId: agent.agentId,
      threadId,
      turnId,
      availableDecisions,
      requestedAt: new Date().toISOString(),
      task: task ? {
        taskId: task.taskId,
        title: task.title,
        status: task.status,
        priority: task.priority
      } : null,
      command: params.command || params.item?.command || null,
      cwd: params.cwd || params.item?.cwd || null,
      payload: params
    }

    this.registry.addPendingApproval(agent.sessionId, agent.agentId, approval)

    await this.blackboard.appendEvent({
      sessionId: agent.sessionId,
      agentId: agent.agentId,
      threadId,
      turnId,
      type: 'approval_requested',
      task: approval.task,
      payload: {
        requestId: message.id,
        availableDecisions,
        command: approval.command,
        cwd: approval.cwd
      }
    })

    this.broadcast({
      type: 'approval_required',
      sessionId: agent.sessionId,
      payload: {
        requestId: message.id,
        agentId: agent.agentId,
        availableDecisions,
        command: approval.command,
        cwd: approval.cwd
      }
    })

    if (this.autoApprovalMode === 'manual') {
      return
    }

    const decision = chooseDecision(availableDecisions, this.autoApprovalMode)
    this.client.respond(message.id, {
      decision
    })
    this.registry.resolvePendingApproval(agent.sessionId, agent.agentId, message.id)

    await this.blackboard.appendEvent({
      sessionId: agent.sessionId,
      agentId: agent.agentId,
      threadId,
      turnId,
      type: 'approval_resolved',
      task: approval.task,
      payload: {
        requestId: message.id,
        decision
      }
    })

    this.broadcast({
      type: 'approval_resolved',
      sessionId: agent.sessionId,
      payload: {
        requestId: message.id,
        agentId: agent.agentId,
        decision
      }
    })
  }

  captureCommandStart(agent, params) {
    const item = params.item || {}
    if (item.type !== 'commandExecution') {
      return
    }

    const key = commandKey(extractThreadId(params), item.id)
    this.commandRuns.set(key, {
      sessionId: agent.sessionId,
      agentId: agent.agentId,
      threadId: extractThreadId(params),
      turnId: extractTurnId(params),
      itemId: item.id,
      command: item.command || '',
      cwd: item.cwd || null,
      status: item.status || 'started',
      startedAt: item.startedAt || new Date().toISOString(),
      output: ''
    })
  }

  captureCommandDelta(agent, params) {
    const threadId = extractThreadId(params)
    const itemId = params.itemId || params.item?.id
    if (!threadId || !itemId) {
      return
    }

    const key = commandKey(threadId, itemId)
    const current = this.commandRuns.get(key)
    if (!current) {
      return
    }

    const delta = typeof params.delta === 'string'
      ? params.delta
      : typeof params.outputDelta === 'string'
        ? params.outputDelta
        : typeof params.output === 'string'
          ? params.output
          : ''

    if (!delta) {
      return
    }

    current.output = `${current.output}${delta}`
    this.commandRuns.set(key, current)

    this.broadcast({
      type: 'command_output_delta',
      sessionId: agent.sessionId,
      payload: {
        agentId: agent.agentId,
        itemId,
        threadId,
        turnId: current.turnId,
        delta
      }
    })
  }

  async captureCommandCompleted(agent, params) {
    const item = params.item || {}
    if (item.type !== 'commandExecution') {
      return
    }

    const threadId = extractThreadId(params)
    const key = commandKey(threadId, item.id)
    const current = this.commandRuns.get(key) || {
      sessionId: agent.sessionId,
      agentId: agent.agentId,
      threadId,
      turnId: extractTurnId(params),
      itemId: item.id,
      command: item.command || '',
      cwd: item.cwd || null,
      output: ''
    }

    const durationMs = item.durationMs || computeDuration(current.startedAt, item.completedAt)
    const exitCode = typeof item.exitCode === 'number' ? item.exitCode : null
    const status = item.status || (exitCode === 0 ? 'completed' : 'failed')

    const task = this.registry.getActiveTask(agent.sessionId, agent.agentId)

    await this.blackboard.appendEvent({
      sessionId: agent.sessionId,
      agentId: agent.agentId,
      threadId,
      turnId: current.turnId,
      type: 'command_execution',
      task: task ? {
        taskId: task.taskId,
        title: task.title,
        status: task.status,
        priority: task.priority
      } : null,
      payload: {
        command: current.command,
        cwd: current.cwd,
        status,
        exitCode,
        durationMs,
        outputPreview: trimPreview(current.output)
      },
      idempotencyKey: `${threadId}:${item.id}:command_completed`
    })

    this.sessionStore.addLog(agent.sessionId, {
      agentId: agent.agentId,
      level: exitCode === 0 ? 'info' : 'error',
      message: `[${agent.agentId}] ${current.command} (exit=${String(exitCode)})`,
      taskId: task ? task.taskId : null
    })

    this.broadcast({
      type: 'command_execution',
      sessionId: agent.sessionId,
      payload: {
        agentId: agent.agentId,
        taskId: task ? task.taskId : null,
        command: current.command,
        cwd: current.cwd,
        status,
        exitCode,
        durationMs,
        outputPreview: trimPreview(current.output),
        turnId: current.turnId,
        threadId
      }
    })

    this.commandRuns.delete(key)
  }

  ensureStarted() {
    if (!this.started) {
      throw new Error('Codex orchestrator is not started')
    }
  }

  buildThreadStartParams(agent) {
    const params = {
      cwd: agent.harness.cwd || process.cwd()
    }

    if (agent.harness.model) {
      params.model = agent.harness.model
    }

    if (agent.harness.profile) {
      params.profile = agent.harness.profile
    }

    if (agent.harness.approvalPolicy) {
      params.approvalPolicy = agent.harness.approvalPolicy
    }

    if (agent.harness.sandboxPolicy) {
      params.sandboxPolicy = agent.harness.sandboxPolicy
    }

    return params
  }

  emitAgentStatus(agent) {
    if (!agent) {
      return
    }

    const runtimeTask = this.registry.getActiveTask(agent.sessionId, agent.agentId)
    const mappedStatus = mapAgentState(agent.state)

    this.broadcast({
      type: 'agent_status',
      sessionId: agent.sessionId,
      payload: {
        agentId: agent.agentId,
        data: {
          status: mappedStatus,
          currentTask: runtimeTask ? runtimeTask.title : null,
          name: agent.name || readableAgentName(agent.agentId),
          role: agent.role || getAgentRole(agent.stageId || agent.agentId),
          ephemeral: Boolean(agent.ephemeral),
          workflowParentTaskId: agent.workflowParentTaskId || null,
          stageId: agent.stageId || null,
          lifecycle: agent.state
        }
      }
    })
  }

  emitSystemLog(level, message) {
    this.broadcast({
      type: 'log_entry',
      sessionId: 'default',
      payload: {
        logId: `codex_system_${randomUUID()}`,
        data: {
          level,
          message,
          source: 'codex_orchestrator'
        }
      }
    })
  }

  emitTaskUpdate(sessionId, taskId, data) {
    this.broadcast({
      type: 'task_update',
      sessionId,
      payload: {
        taskId,
        data
      }
    })
  }

  syncRuntimeTaskToSession(sessionId, agentId, task) {
    if (!task) {
      return null
    }

    return this.sessionStore.syncTask({
      id: task.taskId,
      sessionId,
      description: task.title || task.prompt || task.taskId,
      status: task.status || 'assigned',
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      agentId,
      stageId: task.stageId || null,
      result: task.result || null,
      error: task.error || null,
      priority: task.priority || 'normal',
      parentTaskId: task.parentTaskId || null,
      subTasks: Array.isArray(task.subTasks) ? [...task.subTasks] : [],
      turnId: task.turnId || null,
      turnHistory: Array.isArray(task.turnHistory) ? [...task.turnHistory] : []
    })
  }
}

function getWorkflowSubTaskIds(workflow) {
  return ALL_WORKFLOW_STAGES
    .filter((stageId) => workflow.stageTaskIds.has(stageId))
    .map((stageId) => workflow.stageTaskIds.get(stageId))
}

function workflowAgentId(parentTaskId, stageId) {
  return `${parentTaskId}::${stageId}`
}

function parseStageId(taskId) {
  if (typeof taskId !== 'string') {
    return null
  }

  const parts = taskId.split(':')
  return parts.length > 1 ? parts[parts.length - 1] : null
}

function workflowKey(sessionId, parentTaskId) {
  return `${sessionId}:${parentTaskId}`
}

function workflowTaskKey(sessionId, taskId) {
  return `${sessionId}:${taskId}`
}

function humanizeStage(stageId) {
  if (stageId === 'planner') {
    return 'Task Breakdown'
  }
  if (stageId === 'executor') {
    return 'Primary Build'
  }
  if (stageId === 'subagent') {
    return 'Focused Support'
  }
  if (stageId === 'reviewer') {
    return 'Quality Gate'
  }
  return stageId
}

function parentStatusForStage(stageId) {
  if (stageId === 'planner') {
    return 'planning'
  }
  if (stageId === 'reviewer') {
    return 'reviewing'
  }
  return 'executing'
}

function getAgentRole(agentId) {
  if (agentId === 'agent-main') {
    return 'Main coordinator'
  }
  if (agentId === 'planner') {
    return 'Turns the request into an execution plan and handoff.'
  }
  if (agentId === 'executor') {
    return 'Carries the main implementation or analysis work.'
  }
  if (agentId === 'subagent') {
    return 'Provides targeted support work when the task needs a second specialist.'
  }
  if (agentId === 'reviewer') {
    return 'Checks correctness, risk, and readiness before handoff.'
  }
  return 'Codex controlled agent'
}

function readableAgentName(agentId) {
  if (agentId === 'agent-main') {
    return 'agent-main'
  }
  return humanizeStage(agentId)
}

const BASE_WORKFLOW_STAGES = ['planner', 'executor', 'reviewer']
const ALL_WORKFLOW_STAGES = ['planner', 'executor', 'subagent', 'reviewer']

function getStageDescriptor(stageId, workflow) {
  if (stageId === 'planner') {
    return {
      name: 'Task Breakdown',
      role: 'Turns the request into an execution plan and handoff.'
    }
  }

  if (stageId === 'executor') {
    return {
      name: 'Primary Build',
      role: 'Carries the main implementation or analysis work.'
    }
  }

  if (stageId === 'subagent') {
    return inferSupportStageDescriptor(workflow)
  }

  if (stageId === 'reviewer') {
    return {
      name: 'Quality Gate',
      role: 'Checks correctness, risk, and readiness before handoff.'
    }
  }

  return {
    name: humanizeStage(stageId),
    role: 'Codex controlled agent'
  }
}

function inferSupportStageDescriptor(workflow) {
  const supportText = `${workflow.prompt}\n${workflow.stageResults.get('planner') || ''}\n${workflow.stageResults.get('executor') || ''}`.toLowerCase()

  if (/\b(ui|ux|design|layout|frontend|react|css|visual)\b/.test(supportText)) {
    return {
      name: 'UI Support',
      role: 'Strengthens interface structure, interaction details, and visual polish.'
    }
  }

  if (/\b(api|backend|server|database|schema|query|endpoint)\b/.test(supportText)) {
    return {
      name: 'Backend Support',
      role: 'Strengthens backend behavior, data flow, and integration details.'
    }
  }

  if (/\b(test|verify|validation|qa|regression|coverage)\b/.test(supportText)) {
    return {
      name: 'Verification Support',
      role: 'Adds focused verification work, edge-case checks, and validation support.'
    }
  }

  if (/\b(research|compare|investigate|analy[sz]e|benchmark)\b/.test(supportText)) {
    return {
      name: 'Research Support',
      role: 'Provides focused investigation, comparison, and evidence gathering.'
    }
  }

  if (/\b(doc|copy|write|spec|summary|handoff)\b/.test(supportText)) {
    return {
      name: 'Documentation Support',
      role: 'Improves documentation, summaries, and handoff clarity.'
    }
  }

  return {
    name: 'Focused Support',
    role: 'Provides targeted support work when the task needs a second specialist.'
  }
}

function shouldUseSupportStage(workflow, stageResult = '') {
  const signalText = `${workflow.prompt}\n${workflow.stageResults.get('planner') || ''}\n${stageResult || ''}`.toLowerCase()

  return /\b(parallel|support|assist|investigate|research|verify|validation|qa|regression|compare|frontend|backend|api|database|ui|ux|refactor|migrate|integrate|handoff)\b/.test(signalText)
    || workflow.prompt.trim().length > 180
}

function getWorkflowSummaryStages(workflow) {
  return ALL_WORKFLOW_STAGES.filter((stageId) => workflow.stageResults.has(stageId))
}

function extractThreadId(source) {
  if (!source || typeof source !== 'object') {
    return null
  }

  return source.threadId
    || source.thread?.id
    || source.thread?.threadId
    || source.params?.threadId
    || null
}

function extractTurnId(source) {
  if (!source || typeof source !== 'object') {
    return null
  }

  return source.turnId
    || source.turn?.id
    || source.item?.turnId
    || null
}

function extractTurnResult(source) {
  if (!source || typeof source !== 'object') {
    return null
  }

  const turn = source.turn || {}
  if (typeof turn.outputText === 'string') {
    return turn.outputText
  }

  if (typeof turn.output === 'string') {
    return turn.output
  }

  if (Array.isArray(turn.output)) {
    return turn.output
      .map(entry => entry?.text || '')
      .filter(Boolean)
      .join('\n')
  }

  return null
}

function extractError(source) {
  const err = source?.error || source?.turn?.error
  if (!err) {
    return 'Unknown error'
  }

  if (typeof err === 'string') {
    return err
  }

  if (typeof err.message === 'string') {
    return err.message
  }

  return JSON.stringify(err)
}

function commandKey(threadId, itemId) {
  return `${threadId || 'unknown'}:${itemId || 'unknown'}`
}

function trimPreview(value) {
  if (typeof value !== 'string') {
    return ''
  }

  const trimmed = value.trim()
  if (trimmed.length <= 600) {
    return trimmed
  }

  return `${trimmed.slice(0, 600)}...`
}

function mapAgentState(state) {
  if (state === 'working') {
    return 'working'
  }

  if (state === 'error') {
    return 'error'
  }

  if (state === 'closed') {
    return 'completed'
  }

  return 'idle'
}

function computeDuration(startedAt, completedAt) {
  if (!startedAt || !completedAt) {
    return null
  }

  const startMs = new Date(startedAt).getTime()
  const endMs = new Date(completedAt).getTime()

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return null
  }

  return endMs - startMs
}

function chooseDecision(availableDecisions, mode) {
  if (!Array.isArray(availableDecisions) || availableDecisions.length === 0) {
    return mode === 'deny' ? 'deny' : 'approve'
  }

  if (mode === 'deny') {
    return availableDecisions.includes('deny') ? 'deny' : availableDecisions[0]
  }

  if (mode === 'accept') {
    const preferred = ['approve', 'allow', 'accept']
    const match = preferred.find(decision => availableDecisions.includes(decision))
    return match || availableDecisions[0]
  }

  return availableDecisions[0]
}

module.exports = { CodexOrchestrator }
