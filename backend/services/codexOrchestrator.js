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

  async createTeam(sessionId, payload = {}) {
    return this.dispatchTeamTask(sessionId, payload)
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

    const existingLiveWorkflowTask = this.findLiveWorkflowTask(sessionId)
    if (existingLiveWorkflowTask) {
      throw new Error(`Finish or resolve the current team task first: ${existingLiveWorkflowTask.description || existingLiveWorkflowTask.id}`)
    }

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
      stageTaskIds: new Map(),
      stageResults: new Map(),
      workerStageIds: [],
      stageDescriptors: new Map(),
      reviewStarted: false
    }

    this.trackWorkflow(workflow, parentTaskId)
    await this.startWorkflowStage(workflow, BREAKDOWN_STAGE_ID)

    return {
      taskId: parentTaskId,
      turnId: null,
      threadId: this.registry.getAgent(coordinator.sessionId, coordinator.agentId)?.threadId || null,
      status: 'accepted'
    }
  }

  findLiveWorkflowTask(sessionId) {
    const snapshot = this.sessionStore.getSessionSnapshot(sessionId)
    return (snapshot.tasks || []).find((task) => {
      if (task.parentTaskId) {
        return false
      }
      if (task.agentId !== 'agent-main') {
        return false
      }
      return !['completed', 'rejected', 'failed', 'error', 'interrupted'].includes(task.status)
    }) || null
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
    const plan = workflow.stageResults.get(BREAKDOWN_STAGE_ID) || ''
    const workerSummaries = getWorkerStageIds(workflow)
      .map((stageId) => {
        const descriptor = getStageDescriptor(stageId, workflow)
        return `${descriptor.name}\n${workflow.stageResults.get(stageId) || 'No output provided.'}`.trim()
      })
      .join('\n\n')
    const descriptor = getStageDescriptor(stageAgentId, workflow)

    if (stageAgentId === BREAKDOWN_STAGE_ID) {
      return [
        `You are ${descriptor.name}. ${descriptor.role}`,
        `Parent task: ${workflow.title}`,
        `User request: ${workflow.prompt}`,
        'This is a fast orchestration step, not a full design or spec exercise.',
        'Do not read skill documents, do not start brainstorming/spec-writing workflows, and do not scan the whole repository.',
        'Inspect only the minimum context needed, with a hard cap of 3 directly relevant files or commands.',
        'Return a compact handoff with exactly these sections: Scope, Workstreams, Risks, Handoff.',
        'Keep the response under 180 words.'
      ].join('\n\n')
    }

    if (stageAgentId === REVIEW_STAGE_ID) {
      return [
        `You are ${descriptor.name}. ${descriptor.role}`,
        `Parent task: ${workflow.title}`,
        `User request: ${workflow.prompt}`,
        `Task breakdown:\n${plan || 'No breakdown output provided.'}`,
        `Worker outputs:\n${workerSummaries || 'No worker outputs provided.'}`,
        'Review the combined work, identify concrete risks, and state whether the result is ready.',
        'Keep the review concise and decision-oriented.'
      ].join('\n\n')
    }

    return [
      `You are ${descriptor.name}. ${descriptor.role}`,
      `Parent task: ${workflow.title}`,
      `User request: ${workflow.prompt}`,
      `Task breakdown:\n${plan || 'No breakdown output provided.'}`,
      'Own only this duty. Do not restart planning or broad repository discovery.',
      'Stay focused on the handed-off workstream and finish with a concise handoff for the coordinator.'
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

  getOrRestoreWorkflow(sessionId, parentTaskId) {
    const existing = this.teamWorkflows.get(workflowKey(sessionId, parentTaskId))
    if (existing) {
      return existing
    }

    const parentTask = this.sessionStore.getTask(sessionId, parentTaskId)
    if (!parentTask) {
      return null
    }

    const restored = restoreWorkflowFromSessionTask(this.sessionStore, sessionId, parentTask)
    if (!restored) {
      return null
    }

    this.trackWorkflow(restored, restored.parentTaskId)
    for (const stageTaskId of restored.stageTaskIds.values()) {
      this.trackWorkflow(restored, stageTaskId)
    }

    return restored
  }

  async advanceWorkflowOnCompletion(agent, task, result) {
    const workflow = this.getWorkflowForTask(agent.sessionId, task.taskId)
    if (!workflow || task.taskId === workflow.parentTaskId) {
      return
    }

    const stageId = task.stageId || parseStageId(task.taskId)
    workflow.stageResults.set(stageId, result || '')
    this.markWorkflowAgentWaiting(workflow, stageId)
    this.refreshWorkflowDescriptor(workflow, stageId)

    if (stageId === BREAKDOWN_STAGE_ID) {
      const workerDescriptors = inferWorkerDescriptors(workflow, result || '')
      workflow.workerStageIds = workerDescriptors.map((descriptor) => descriptor.stageId)
      for (const descriptor of workerDescriptors) {
        workflow.stageDescriptors.set(descriptor.stageId, descriptor)
        await this.startWorkflowStage(workflow, descriptor.stageId)
      }
      return
    }

    if (stageId !== REVIEW_STAGE_ID) {
      const allWorkersDone = getWorkerStageIds(workflow).every((workerStageId) => workflow.stageResults.has(workerStageId))
      if (allWorkersDone && !workflow.reviewStarted) {
        workflow.reviewStarted = true
        await this.startWorkflowStage(workflow, REVIEW_STAGE_ID)
      }
      return
    }

    const parentResult = getWorkflowSummaryStages(workflow)
      .map((stageId) => `${getStageDescriptor(stageId, workflow).name}\n${workflow.stageResults.get(stageId) || ''}`.trim())
      .join('\n\n')

    const updatedParentTask = this.registry.updateTask(workflow.sessionId, workflow.parentAgentId, workflow.parentTaskId, {
      status: 'awaiting_finish',
      result: parentResult,
      subTasks: getWorkflowSubTaskIds(workflow)
    })

    if (updatedParentTask) {
      this.syncRuntimeTaskToSession(workflow.sessionId, workflow.parentAgentId, updatedParentTask)
      this.emitTaskUpdate(workflow.sessionId, workflow.parentTaskId, {
        status: 'awaiting_finish',
        result: updatedParentTask.result,
        updatedAt: updatedParentTask.updatedAt,
        agentId: workflow.parentAgentId
      })
    }

    this.registry.updateAgentState(workflow.sessionId, workflow.parentAgentId, 'waiting', null)
    this.emitAgentStatus(serializeAgent(this.registry.getAgent(workflow.sessionId, workflow.parentAgentId)))
  }

  markWorkflowAgentWaiting(workflow, stageId) {
    if (!stageId) {
      return
    }

    const agentId = workflowAgentId(workflow.parentTaskId, stageId)
    const runtimeAgent = this.registry.getAgent(workflow.sessionId, agentId)
    if (!runtimeAgent || runtimeAgent.state === 'closed') {
      return
    }

    this.registry.updateAgentState(workflow.sessionId, agentId, 'waiting', null)
    this.emitAgentStatus(serializeAgent(this.registry.getAgent(workflow.sessionId, agentId)))
  }

  async finishTask(sessionId, parentTaskId) {
    this.ensureStarted()
    const workflow = this.getOrRestoreWorkflow(sessionId, parentTaskId)

    if (!workflow) {
      throw new Error('Workflow task not found')
    }

    const parentTask = this.registry.getTask(workflow.sessionId, workflow.parentAgentId, workflow.parentTaskId)
      || this.sessionStore.getTask(workflow.sessionId, workflow.parentTaskId)
    if (!parentTask) {
      throw new Error('Task not found')
    }

    if (parentTask.status !== 'awaiting_finish' && parentTask.status !== 'completed') {
      throw new Error('Task is not ready to finish')
    }

    await this.closeWorkflowAgents(workflow)
    this.cleanupWorkflow(workflow)

    const updatedParentRuntimeTask = this.registry.updateTask(workflow.sessionId, workflow.parentAgentId, workflow.parentTaskId, {
      status: 'completed',
      subTasks: getWorkflowSubTaskIds(workflow)
    })
    const updatedParentTask = updatedParentRuntimeTask || this.sessionStore.syncTask({
      ...parentTask,
      id: parentTask.id || workflow.parentTaskId,
      sessionId: workflow.sessionId,
      agentId: workflow.parentAgentId,
      status: 'completed',
      subTasks: getWorkflowSubTaskIds(workflow)
    })

    if (updatedParentRuntimeTask) {
      this.syncRuntimeTaskToSession(workflow.sessionId, workflow.parentAgentId, updatedParentRuntimeTask)
    }
    if (updatedParentTask) {
      this.emitTaskUpdate(workflow.sessionId, workflow.parentTaskId, {
        status: 'completed',
        updatedAt: updatedParentTask.updatedAt,
        agentId: workflow.parentAgentId
      })
    }

    this.registry.setActiveTask(workflow.sessionId, workflow.parentAgentId, null)
    this.registry.updateAgentState(workflow.sessionId, workflow.parentAgentId, 'idle', null)
    const runtimeParentAgent = this.registry.getAgent(workflow.sessionId, workflow.parentAgentId)
    if (runtimeParentAgent) {
      this.emitAgentStatus(serializeAgent(runtimeParentAgent))
    } else {
      this.sessionStore.syncAgent(workflow.sessionId, {
        id: workflow.parentAgentId,
        name: workflow.parentAgentId,
        role: getAgentRole(workflow.parentAgentId),
        status: 'idle',
        currentTask: null
      })
    }

    await this.blackboard.appendEvent({
      sessionId: workflow.sessionId,
      agentId: workflow.parentAgentId,
      threadId: this.registry.getAgent(workflow.sessionId, workflow.parentAgentId)?.threadId,
      type: 'task_progress',
      task: {
        taskId: workflow.parentTaskId,
        title: workflow.title,
        status: 'completed',
        priority: workflow.priority
      },
      payload: {
        action: 'finish'
      }
    })

    return {
      ok: true,
      taskId: workflow.parentTaskId,
      status: 'completed'
    }
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
    for (const stageId of workflow.stageTaskIds.keys()) {
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

  refreshWorkflowDescriptor(workflow, stageId) {
    if (!workflow?.stageDescriptors || !stageId) {
      return
    }

    if (!workflow.stageDescriptors.has(stageId)) {
      workflow.stageDescriptors.set(stageId, buildDescriptorForStageId(stageId, workflow.prompt))
    }
  }
}

function getWorkflowSubTaskIds(workflow) {
  return getOrderedWorkflowStageIds(workflow)
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
  if (stageId === BREAKDOWN_STAGE_ID) {
    return 'Task Breakdown'
  }
  if (stageId === REVIEW_STAGE_ID) {
    return 'Quality Gate'
  }
  if (stageId === 'primary-build') {
    return 'Primary Build'
  }
  if (stageId === 'ui-build') {
    return 'UI Build'
  }
  if (stageId === 'backend-integration') {
    return 'Backend Integration'
  }
  if (stageId === 'validation-sweep') {
    return 'Validation Sweep'
  }
  if (stageId === 'research-pass') {
    return 'Research Pass'
  }
  if (stageId === 'handoff-notes') {
    return 'Handoff Notes'
  }
  return stageId
}

function parentStatusForStage(stageId) {
  if (stageId === BREAKDOWN_STAGE_ID) {
    return 'planning'
  }
  if (stageId === REVIEW_STAGE_ID) {
    return 'reviewing'
  }
  return 'executing'
}

function getAgentRole(agentId) {
  if (agentId === 'agent-main') {
    return 'Main coordinator'
  }
  if (agentId === BREAKDOWN_STAGE_ID) {
    return 'Turns the request into an execution plan and handoff.'
  }
  if (agentId === REVIEW_STAGE_ID) {
    return 'Checks correctness, risk, and readiness before handoff.'
  }
  if (agentId === 'primary-build') {
    return 'Carries the main implementation or analysis work.'
  }
  if (agentId === 'ui-build') {
    return 'Owns the interface workstream and visual execution details.'
  }
  if (agentId === 'backend-integration') {
    return 'Owns backend, API, and integration execution details.'
  }
  if (agentId === 'validation-sweep') {
    return 'Owns focused validation, QA, and regression checks.'
  }
  if (agentId === 'research-pass') {
    return 'Owns focused research, comparisons, and evidence gathering.'
  }
  if (agentId === 'handoff-notes') {
    return 'Owns handoff notes, summaries, and delivery-ready packaging.'
  }
  return 'Codex controlled agent'
}

function readableAgentName(agentId) {
  if (agentId === 'agent-main') {
    return 'agent-main'
  }
  return humanizeStage(agentId)
}

const BREAKDOWN_STAGE_ID = 'task-breakdown'
const REVIEW_STAGE_ID = 'quality-gate'

function getOrderedWorkflowStageIds(workflow) {
  return [
    BREAKDOWN_STAGE_ID,
    ...getWorkerStageIds(workflow),
    REVIEW_STAGE_ID
  ]
}

function getWorkerStageIds(workflow) {
  return Array.isArray(workflow?.workerStageIds) ? workflow.workerStageIds : []
}

function buildDescriptorForStageId(stageId, sourceText = '') {
  if (stageId === BREAKDOWN_STAGE_ID || stageId === REVIEW_STAGE_ID) {
    return getStageDescriptor(stageId)
  }

  const normalized = String(stageId || '').trim()
  if (normalized === 'primary-build') {
    return {
      stageId: normalized,
      name: 'Primary Build',
      role: 'Owns the main implementation or analysis workstream.'
    }
  }
  if (normalized === 'ui-build') {
    return {
      stageId: normalized,
      name: 'UI Build',
      role: 'Owns the interface workstream, interaction details, and visual execution.'
    }
  }
  if (normalized === 'backend-integration') {
    return {
      stageId: normalized,
      name: 'Backend Integration',
      role: 'Owns backend, API, and data integration execution.'
    }
  }
  if (normalized === 'validation-sweep') {
    return {
      stageId: normalized,
      name: 'Validation Sweep',
      role: 'Owns focused validation, QA, and regression checks.'
    }
  }
  if (normalized === 'research-pass') {
    return {
      stageId: normalized,
      name: 'Research Pass',
      role: 'Owns focused investigation, evidence gathering, and technical comparison.'
    }
  }
  if (normalized === 'handoff-notes') {
    return {
      stageId: normalized,
      name: 'Handoff Notes',
      role: 'Owns summaries, delivery notes, and final packaging for handoff.'
    }
  }

  return {
    stageId: normalized,
    name: humanizeStage(normalized),
    role: `Owns the ${humanizeStage(normalized).toLowerCase()} workstream for this task. ${sourceText ? `Source focus: ${sourceText}` : ''}`.trim()
  }
}

function inferWorkerDescriptors(workflow, breakdownResult = '') {
  const signalText = `${workflow.prompt}\n${breakdownResult}`.toLowerCase()
  const descriptors = []
  const seen = new Set()

  const pushDescriptor = (stageId) => {
    if (!stageId || seen.has(stageId)) {
      return
    }
    seen.add(stageId)
    descriptors.push(buildDescriptorForStageId(stageId, workflow.prompt))
  }

  if (/\b(ui|ux|design|layout|frontend|react|css|visual|screen|page)\b/.test(signalText)) {
    pushDescriptor('ui-build')
  }

  if (/\b(api|backend|server|database|schema|query|endpoint|integration|data)\b/.test(signalText)) {
    pushDescriptor('backend-integration')
  }

  if (/\b(test|verify|validation|qa|regression|coverage|check)\b/.test(signalText)) {
    pushDescriptor('validation-sweep')
  }

  if (/\b(research|compare|investigate|analy[sz]e|benchmark)\b/.test(signalText)) {
    pushDescriptor('research-pass')
  }

  if (/\b(doc|copy|write|summary|handoff|notes|changelog)\b/.test(signalText)) {
    pushDescriptor('handoff-notes')
  }

  const longTask = /\b(parallel|swarm|multi|across|surface|surfaces|system|end-to-end)\b/.test(signalText)
    || workflow.prompt.trim().length > 140

  if (descriptors.length === 0) {
    pushDescriptor('primary-build')
  }

  if (longTask && descriptors.length === 1) {
    pushDescriptor('validation-sweep')
  }

  if (longTask && descriptors.length >= 2 && !seen.has('primary-build') && !seen.has('handoff-notes')) {
    pushDescriptor('primary-build')
  }

  return descriptors.slice(0, 4)
}

function getStageDescriptor(stageId, workflow) {
  const dynamicDescriptor = workflow?.stageDescriptors instanceof Map ? workflow.stageDescriptors.get(stageId) : null
  if (dynamicDescriptor) {
    return dynamicDescriptor
  }

  if (stageId === BREAKDOWN_STAGE_ID) {
    return {
      name: 'Task Breakdown',
      role: 'Turns the request into an execution plan and handoff.'
    }
  }

  if (stageId === REVIEW_STAGE_ID) {
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

function getWorkflowSummaryStages(workflow) {
  return getOrderedWorkflowStageIds(workflow).filter((stageId) => workflow.stageResults.has(stageId))
}

function restoreWorkflowFromSessionTask(sessionStore, sessionId, parentTask) {
  const stageTaskIds = new Map()
  const stageResults = new Map()
  const subTaskIds = Array.isArray(parentTask.subTasks) ? parentTask.subTasks : []
  const stageDescriptors = new Map()
  const workerStageIds = []

  for (const stageTaskId of subTaskIds) {
    const stageId = parseStageId(stageTaskId)
    if (!stageId) {
      continue
    }

    const stageTask = sessionStore.getTask(sessionId, stageTaskId)
    if (!stageTask) {
      continue
    }

    stageTaskIds.set(stageId, stageTaskId)
    if (stageId !== BREAKDOWN_STAGE_ID && stageId !== REVIEW_STAGE_ID) {
      workerStageIds.push(stageId)
    }
    stageDescriptors.set(stageId, buildDescriptorForStageId(stageId, parentTask.description || ''))
    if (typeof stageTask.result === 'string' && stageTask.result) {
      stageResults.set(stageId, stageTask.result)
    }
  }

  if (stageTaskIds.size === 0) {
    return null
  }

  return {
    sessionId,
    parentTaskId: parentTask.id,
    parentAgentId: parentTask.agentId || 'agent-main',
    title: parentTask.description || parentTask.id,
    prompt: '',
    priority: parentTask.priority || 'normal',
    stageTaskIds,
    stageResults,
    workerStageIds,
    stageDescriptors,
    reviewStarted: stageTaskIds.has(REVIEW_STAGE_ID)
  }
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

  if (state === 'waiting') {
    return 'waiting'
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
