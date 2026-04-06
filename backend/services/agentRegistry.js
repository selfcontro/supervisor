class AgentRegistry {
  constructor() {
    this.sessions = new Map()
    this.threadIndex = new Map()
  }

  ensureAgent(sessionId, agentId, options = {}) {
    const normalizedSessionId = normalizeId(sessionId)
    const normalizedAgentId = normalizeId(agentId)

    if (!this.sessions.has(normalizedSessionId)) {
      this.sessions.set(normalizedSessionId, new Map())
    }

    const sessionAgents = this.sessions.get(normalizedSessionId)
    let agent = sessionAgents.get(normalizedAgentId)

    if (!agent) {
      const now = new Date().toISOString()
      agent = {
        sessionId: normalizedSessionId,
        agentId: normalizedAgentId,
        state: 'idle',
        createdAt: now,
        updatedAt: now,
        threadId: null,
        activeTurnId: null,
        harness: sanitizeHarness(options.harness || {}),
        tasks: new Map(),
        pendingApprovals: new Map()
      }
      sessionAgents.set(normalizedAgentId, agent)
    }

    if (options.harness) {
      agent.harness = {
        ...agent.harness,
        ...sanitizeHarness(options.harness)
      }
    }

    agent.updatedAt = new Date().toISOString()
    return agent
  }

  listAgents(sessionId) {
    const normalizedSessionId = normalizeId(sessionId)
    const sessionAgents = this.sessions.get(normalizedSessionId)

    if (!sessionAgents) {
      return []
    }

    return Array.from(sessionAgents.values()).map(agent => serializeAgent(agent))
  }

  getAgent(sessionId, agentId) {
    const sessionAgents = this.sessions.get(normalizeId(sessionId))
    if (!sessionAgents) {
      return null
    }

    return sessionAgents.get(normalizeId(agentId)) || null
  }

  setThread(sessionId, agentId, threadId) {
    const agent = this.getAgent(sessionId, agentId)
    if (!agent) {
      return null
    }

    if (agent.threadId) {
      this.threadIndex.delete(agent.threadId)
    }

    agent.threadId = threadId
    agent.updatedAt = new Date().toISOString()
    this.threadIndex.set(threadId, {
      sessionId: agent.sessionId,
      agentId: agent.agentId
    })

    return agent
  }

  findByThreadId(threadId) {
    if (!threadId) {
      return null
    }

    const pointer = this.threadIndex.get(threadId)
    if (!pointer) {
      return null
    }

    const agent = this.getAgent(pointer.sessionId, pointer.agentId)
    if (!agent) {
      this.threadIndex.delete(threadId)
      return null
    }

    return agent
  }

  updateAgentState(sessionId, agentId, state, activeTurnId = null) {
    const agent = this.getAgent(sessionId, agentId)
    if (!agent) {
      return null
    }

    agent.state = state
    agent.activeTurnId = activeTurnId
    agent.updatedAt = new Date().toISOString()

    return agent
  }

  addTask(sessionId, agentId, task) {
    const agent = this.getAgent(sessionId, agentId)
    if (!agent) {
      return null
    }

    agent.tasks.set(task.taskId, {
      ...task,
      createdAt: task.createdAt || new Date().toISOString(),
      updatedAt: task.updatedAt || new Date().toISOString()
    })
    agent.updatedAt = new Date().toISOString()
    return agent.tasks.get(task.taskId)
  }

  getTask(sessionId, agentId, taskId) {
    const agent = this.getAgent(sessionId, agentId)
    if (!agent) {
      return null
    }

    return agent.tasks.get(taskId) || null
  }

  setActiveTask(sessionId, agentId, taskId) {
    const agent = this.getAgent(sessionId, agentId)
    if (!agent) {
      return null
    }

    if (!taskId) {
      delete agent.activeTaskId
    } else {
      agent.activeTaskId = taskId
    }
    agent.updatedAt = new Date().toISOString()
    return agent
  }

  getActiveTask(sessionId, agentId) {
    const agent = this.getAgent(sessionId, agentId)
    if (!agent || !agent.activeTaskId) {
      return null
    }

    return agent.tasks.get(agent.activeTaskId) || null
  }

  updateTask(sessionId, agentId, taskId, patch) {
    const agent = this.getAgent(sessionId, agentId)
    if (!agent) {
      return null
    }

    const task = agent.tasks.get(taskId)
    if (!task) {
      return null
    }

    const nextTask = {
      ...task,
      ...patch,
      updatedAt: new Date().toISOString()
    }

    agent.tasks.set(taskId, nextTask)
    agent.updatedAt = nextTask.updatedAt
    return nextTask
  }

  addPendingApproval(sessionId, agentId, approval) {
    const agent = this.getAgent(sessionId, agentId)
    if (!agent) {
      return null
    }

    const key = approval.requestId
    agent.pendingApprovals.set(key, approval)
    agent.updatedAt = new Date().toISOString()
    return approval
  }

  resolvePendingApproval(sessionId, agentId, requestId) {
    const agent = this.getAgent(sessionId, agentId)
    if (!agent) {
      return null
    }

    const current = agent.pendingApprovals.get(requestId) || null
    if (current) {
      agent.pendingApprovals.delete(requestId)
      agent.updatedAt = new Date().toISOString()
    }
    return current
  }

  closeAgent(sessionId, agentId) {
    const agent = this.getAgent(sessionId, agentId)
    if (!agent) {
      return null
    }

    if (agent.threadId) {
      this.threadIndex.delete(agent.threadId)
    }

    agent.state = 'closed'
    agent.activeTurnId = null
    agent.activeTaskId = null
    agent.updatedAt = new Date().toISOString()

    return agent
  }
}

function normalizeId(value) {
  if (typeof value !== 'string') {
    return ''
  }
  return value.trim()
}

function sanitizeHarness(harness) {
  if (!harness || typeof harness !== 'object') {
    return {}
  }

  const allowed = {}
  if (typeof harness.model === 'string' && harness.model.trim()) {
    allowed.model = harness.model.trim()
  }
  if (typeof harness.profile === 'string' && harness.profile.trim()) {
    allowed.profile = harness.profile.trim()
  }
  if (typeof harness.cwd === 'string' && harness.cwd.trim()) {
    allowed.cwd = harness.cwd.trim()
  }
  if (typeof harness.approvalPolicy === 'string' && harness.approvalPolicy.trim()) {
    allowed.approvalPolicy = harness.approvalPolicy.trim()
  }
  if (harness.sandboxPolicy && typeof harness.sandboxPolicy === 'object') {
    allowed.sandboxPolicy = harness.sandboxPolicy
  }
  return allowed
}

function serializeAgent(agent) {
  return {
    sessionId: agent.sessionId,
    agentId: agent.agentId,
    state: agent.state,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
    threadId: agent.threadId,
    activeTurnId: agent.activeTurnId,
    activeTaskId: agent.activeTaskId || null,
    harness: agent.harness,
    taskCount: agent.tasks.size,
    pendingApprovalCount: agent.pendingApprovals.size
  }
}

module.exports = { AgentRegistry, sanitizeHarness, serializeAgent }
