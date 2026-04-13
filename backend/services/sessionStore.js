const { AgentManager } = require('./agentManager')

const DEFAULT_SESSION_ID = 'default'
const MAX_LOGS_PER_SESSION = 500

class SessionStore {
  constructor() {
    this.sessions = new Map()
    this.listeners = new Set()
    this.taskCounter = 0
    this.runtimeAgentProvider = null
    this.ensureSession(DEFAULT_SESSION_ID)
  }

  normalizeSessionId(sessionId) {
    if (typeof sessionId !== 'string') {
      return DEFAULT_SESSION_ID
    }

    const normalized = sessionId.trim()
    return normalized || DEFAULT_SESSION_ID
  }

  ensureSession(sessionId = DEFAULT_SESSION_ID) {
    const normalizedSessionId = this.normalizeSessionId(sessionId)
    let session = this.getSession(normalizedSessionId)

    if (!session) {
      const createdAt = new Date().toISOString()
      session = {
        id: normalizedSessionId,
        createdAt,
        updatedAt: createdAt,
        tasks: new Map(),
        persistedAgents: new Map(),
        logs: [],
        agentManager: new AgentManager((event) => {
          this.handleAgentManagerEvent(normalizedSessionId, event)
        })
      }
      this.sessions.set(normalizedSessionId, session)
    }

    return session
  }

  hasSession(sessionId = DEFAULT_SESSION_ID) {
    return this.sessions.has(this.normalizeSessionId(sessionId))
  }

  getSession(sessionId = DEFAULT_SESSION_ID) {
    return this.sessions.get(this.normalizeSessionId(sessionId)) || null
  }

  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  setRuntimeAgentProvider(provider) {
    this.runtimeAgentProvider = typeof provider === 'function' ? provider : null
  }

  emitSessionEvent(sessionId, event) {
    const session = this.ensureSession(sessionId)
    const timestamp = event.timestamp || new Date().toISOString()
    const enrichedEvent = {
      ...event,
      sessionId: session.id,
      timestamp
    }

    session.updatedAt = timestamp

    if (enrichedEvent.type === 'log_entry') {
      this.appendLogFromEvent(session, enrichedEvent)
    }

    this.listeners.forEach(listener => listener(enrichedEvent))
    return enrichedEvent
  }

  handleAgentManagerEvent(sessionId, event) {
    const session = this.ensureSession(sessionId)

    if (event.type === 'task:new' && event.task) {
      event.task.sessionId = session.id
    }

    return this.emitSessionEvent(session.id, event)
  }

  appendLogFromEvent(session, event) {
    const logId = event.payload?.logId || `log_${Date.now()}`
    const data = event.payload?.data || {}

    session.logs.push({
      id: logId,
      timestamp: event.timestamp,
      level: data.level || 'info',
      message: data.message || '',
      taskId: data.taskId || null,
      agentId: data.agentId || null,
      sessionId: session.id,
      data
    })

    if (session.logs.length > MAX_LOGS_PER_SESSION) {
      session.logs = session.logs.slice(-MAX_LOGS_PER_SESSION)
    }
  }

  addLog(sessionId, data, timestamp = new Date().toISOString()) {
    return this.emitSessionEvent(sessionId, {
      type: 'log_entry',
      payload: {
        logId: `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        data
      },
      timestamp
    })
  }

  createTask({ sessionId, description, priority = 'normal' }) {
    const session = this.ensureSession(sessionId)
    const createdAt = new Date().toISOString()
    const task = {
      id: `task_${++this.taskCounter}_${Date.now()}`,
      sessionId: session.id,
      description,
      priority,
      status: 'pending',
      createdAt,
      updatedAt: createdAt,
      logs: [],
      subTasks: [],
      result: null,
      agentId: null,
      error: null,
      reviewLoops: 0
    }

    session.tasks.set(task.id, task)
    session.updatedAt = createdAt

    this.emitSessionEvent(session.id, {
      type: 'task:new',
      task
    })

    this.addLog(session.id, {
      taskId: task.id,
      level: 'info',
      message: `任务已创建: ${description.substring(0, 50)}...`
    }, createdAt)

    return task
  }

  syncTask(task) {
    const session = this.ensureSession(task.sessionId)
    const existing = session.tasks.get(task.id) || null
    const createdAt = existing?.createdAt || task.createdAt || new Date().toISOString()
    const nextTask = {
      logs: [],
      subTasks: [],
      result: null,
      agentId: null,
      error: null,
      reviewLoops: 0,
      priority: 'normal',
      ...existing,
      ...task,
      createdAt,
      updatedAt: task.updatedAt || new Date().toISOString()
    }

    session.tasks.set(nextTask.id, nextTask)
    session.updatedAt = nextTask.updatedAt

    if (!existing) {
      this.emitSessionEvent(session.id, {
        type: 'task:new',
        task: nextTask
      })
    }

    return nextTask
  }

  syncAgent(sessionId, agent) {
    const session = this.ensureSession(sessionId)
    const existing = session.persistedAgents.get(agent.id) || null
    const nextAgent = {
      id: agent.id,
      name: agent.name || existing?.name || agent.id,
      role: agent.role || existing?.role || 'Codex controlled agent',
      status: agent.status || existing?.status || 'idle',
      currentTask: Object.prototype.hasOwnProperty.call(agent, 'currentTask')
        ? (agent.currentTask || null)
        : (existing?.currentTask || null)
    }

    session.persistedAgents.set(nextAgent.id, nextAgent)
    session.updatedAt = new Date().toISOString()
    return nextAgent
  }

  getTask(sessionId, taskId) {
    const session = this.getSession(sessionId)
    if (!session) {
      return null
    }

    return session.tasks.get(taskId) || session.agentManager.getTask(taskId) || null
  }

  findTask(taskId) {
    for (const session of this.sessions.values()) {
      const task = session.tasks.get(taskId) || session.agentManager.getTask(taskId)
      if (task) {
        return { sessionId: session.id, task }
      }
    }

    return null
  }

  getTasks(sessionId) {
    const session = this.getSession(sessionId)
    if (!session) {
      return []
    }

    const tasksById = new Map()

    session.tasks.forEach((task, taskId) => {
      tasksById.set(taskId, task)
    })

    session.agentManager.getAllTasks().forEach(task => {
      tasksById.set(task.id, {
        ...task,
        sessionId: session.id
      })
    })

    return Array.from(tasksById.values())
      .sort((a, b) => new Date(b.createdAt || b.updatedAt || 0).getTime() - new Date(a.createdAt || a.updatedAt || 0).getTime())
  }

  updateTask(task) {
    const session = this.ensureSession(task.sessionId)
    session.tasks.set(task.id, task)
    session.updatedAt = task.updatedAt || new Date().toISOString()
    return task
  }

  deleteTask(sessionId, taskId) {
    const session = this.ensureSession(sessionId)
    const deleted = session.tasks.delete(taskId)
    if (deleted) {
      session.updatedAt = new Date().toISOString()
    }
    return deleted
  }

  getAgentManager(sessionId) {
    return this.ensureSession(sessionId).agentManager
  }

  getAgents(sessionId) {
    const session = this.getSession(sessionId)
    if (!session) {
      return []
    }

    const agentsById = new Map()

    session.persistedAgents.forEach((agent, agentId) => {
      agentsById.set(agentId, agent)
    })

    for (const agent of session.agentManager.getAllAgents()) {
      agentsById.set(agent.id, agent)
    }

    if (this.runtimeAgentProvider) {
      const runtimeAgents = this.runtimeAgentProvider(session.id) || []
      for (const runtimeAgent of runtimeAgents) {
        const normalized = normalizeRuntimeAgent(runtimeAgent)
        if (!normalized) {
          continue
        }
        agentsById.set(normalized.id, {
          ...(agentsById.get(normalized.id) || {}),
          ...normalized
        })
      }
    }

    return Array.from(agentsById.values())
  }

  getLogs(sessionId) {
    const session = this.getSession(sessionId)
    if (!session) {
      return []
    }

    return [...session.logs]
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
  }

  getSessionSummaries() {
    return Array.from(this.sessions.values())
      .filter(session => {
        if (session.id !== DEFAULT_SESSION_ID) {
          return true
        }

        return session.tasks.size > 0 || session.logs.length > 0
      })
      .map(session => {
        const tasks = this.getTasks(session.id)
        const activeTaskCount = tasks.filter(task => !['completed', 'rejected'].includes(task.status)).length

        return {
          id: session.id,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          taskCount: tasks.length,
          activeTaskCount,
          agentCount: session.agentManager.getAllAgents().length,
          latestLogAt: session.logs.length ? session.logs[session.logs.length - 1].timestamp : null
        }
      })
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }

  getSessionSnapshot(sessionId) {
    const session = this.getSession(sessionId)
    if (!session) {
      return null
    }

    return {
      session: {
        id: session.id,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt
      },
      agents: this.getAgents(session.id),
      tasks: this.getTasks(session.id),
      logs: this.getLogs(session.id)
    }
  }

  getSessionIds() {
    return Array.from(this.sessions.keys())
  }
}

module.exports = {
  SessionStore,
  DEFAULT_SESSION_ID
}

function normalizeRuntimeAgent(agent) {
  if (!agent || typeof agent !== 'object') {
    return null
  }

  const id = typeof agent.agentId === 'string' && agent.agentId.trim()
    ? agent.agentId.trim()
    : typeof agent.id === 'string' && agent.id.trim()
      ? agent.id.trim()
      : ''

  if (!id) {
    return null
  }

  const state = typeof agent.state === 'string' ? agent.state : typeof agent.status === 'string' ? agent.status : 'idle'
  return {
    id,
    name: typeof agent.name === 'string' && agent.name.trim() ? agent.name.trim() : id,
    role: typeof agent.role === 'string' && agent.role.trim() ? agent.role.trim() : 'Codex controlled agent',
    status: mapRuntimeAgentStatus(state),
    currentTask: Object.prototype.hasOwnProperty.call(agent, 'currentTask') ? (agent.currentTask || null) : null,
  }
}

function mapRuntimeAgentStatus(state) {
  if (state === 'working') {
    return 'working'
  }
  if (state === 'error') {
    return 'error'
  }
  if (state === 'completed' || state === 'done') {
    return 'completed'
  }
  return 'idle'
}
