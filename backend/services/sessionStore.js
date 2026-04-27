const { AgentManager } = require('./agentManager')

const DEFAULT_SESSION_ID = 'default'
const MAX_LOGS_PER_SESSION = 500
const VALID_REVIEW_MODES = new Set(['balanced', 'strict'])

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
        settings: createDefaultSettings(createdAt),
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
    if (!agent || shouldIgnorePersistentAgent(agent.id, agent)) {
      return null
    }

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
      if (isLegacyWorkflowAgent(agentId)) {
        return
      }
      agentsById.set(agentId, agent)
    })

    if (this.runtimeAgentProvider) {
      const runtimeAgents = this.runtimeAgentProvider(session.id) || []
      for (const runtimeAgent of runtimeAgents) {
        const normalized = normalizeRuntimeAgent(runtimeAgent)
        if (!normalized || normalized.ephemeral) {
          continue
        }
        if (isLegacyWorkflowAgent(normalized.id)) {
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

  getWorkflowAgents(sessionId) {
    const session = this.getSession(sessionId)
    if (!session) {
      return []
    }

    const runtimeWorkflowAgents = this.runtimeAgentProvider
      ? (this.runtimeAgentProvider(session.id) || [])
        .map(runtimeAgent => normalizeRuntimeAgent(runtimeAgent))
        .filter(agent => agent && agent.ephemeral)
      : []

    return mergeWorkflowAgents(runtimeWorkflowAgents, deriveHistoricalWorkflowAgents(this.getTasks(session.id)))
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
        const activeTaskCount = tasks.filter(task => !['completed', 'rejected', 'failed', 'error', 'interrupted'].includes(task.status)).length

      return {
        id: session.id,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        taskCount: tasks.length,
        activeTaskCount,
        agentCount: this.getAgents(session.id).length + this.getWorkflowAgents(session.id).length,
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
      settings: cloneSettings(session.settings),
      agents: this.getAgents(session.id),
      workflowAgents: this.getWorkflowAgents(session.id),
      tasks: this.getTasks(session.id),
      logs: this.getLogs(session.id)
    }
  }

  updateSessionSettings(sessionId, nextSettings = {}) {
    const session = this.ensureSession(sessionId)
    const timestamp = new Date().toISOString()
    session.settings = mergeSessionSettings(session.settings, nextSettings, timestamp)
    session.updatedAt = timestamp

    return cloneSettings(session.settings)
  }

  getSessionIds() {
    return Array.from(this.sessions.keys())
  }
}

module.exports = {
  SessionStore,
  DEFAULT_SESSION_ID
}

function createDefaultSettings(timestamp = new Date().toISOString()) {
  return {
    autoDispatch: true,
    compactMode: false,
    reviewMode: 'balanced',
    backend: {
      kind: 'mock',
      status: 'connected',
      lastSyncedAt: timestamp,
    },
  }
}

function cloneSettings(settings) {
  return {
    autoDispatch: Boolean(settings?.autoDispatch),
    compactMode: Boolean(settings?.compactMode),
    reviewMode: VALID_REVIEW_MODES.has(settings?.reviewMode) ? settings.reviewMode : 'balanced',
    backend: {
      kind: 'mock',
      status: 'connected',
      lastSyncedAt: typeof settings?.backend?.lastSyncedAt === 'string'
        ? settings.backend.lastSyncedAt
        : new Date().toISOString(),
    },
  }
}

function mergeSessionSettings(existingSettings, patch, timestamp) {
  const base = cloneSettings(existingSettings || createDefaultSettings(timestamp))

  if (Object.prototype.hasOwnProperty.call(patch, 'autoDispatch')) {
    base.autoDispatch = Boolean(patch.autoDispatch)
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'compactMode')) {
    base.compactMode = Boolean(patch.compactMode)
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'reviewMode') && VALID_REVIEW_MODES.has(patch.reviewMode)) {
    base.reviewMode = patch.reviewMode
  }

  base.backend.lastSyncedAt = timestamp

  return base
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
    ephemeral: Boolean(agent.ephemeral),
    workflowParentTaskId: typeof agent.workflowParentTaskId === 'string' ? agent.workflowParentTaskId : null,
    stageId: typeof agent.stageId === 'string' ? agent.stageId : null,
    threadId: typeof agent.threadId === 'string' ? agent.threadId : null,
    activeTurnId: typeof agent.activeTurnId === 'string' ? agent.activeTurnId : null,
  }
}

function mapRuntimeAgentStatus(state) {
  if (state === 'working') {
    return 'working'
  }
  if (state === 'waiting') {
    return 'waiting'
  }
  if (state === 'error') {
    return 'error'
  }
  if (state === 'completed' || state === 'done') {
    return 'completed'
  }
  return 'idle'
}

function isLegacyWorkflowAgent(agentId) {
  return ['planner', 'executor', 'subagent', 'reviewer'].includes(agentId)
}

function shouldIgnorePersistentAgent(agentId, agent) {
  if (typeof agentId !== 'string' || !agentId.trim()) {
    return true
  }

  if (isLegacyWorkflowAgent(agentId)) {
    return true
  }

  if (agentId.includes('::')) {
    return true
  }

  if (agent && (agent.ephemeral || typeof agent.workflowParentTaskId === 'string')) {
    return true
  }

  return false
}

function mergeWorkflowAgents(runtimeAgents, historicalAgents) {
  const agentsById = new Map()

  for (const agent of historicalAgents) {
    agentsById.set(agent.id, agent)
  }

  for (const agent of runtimeAgents) {
    agentsById.set(agent.id, agent)
  }

  return Array.from(agentsById.values()).sort((left, right) => {
    const parentCompare = String(left.workflowParentTaskId || '').localeCompare(String(right.workflowParentTaskId || ''))
    if (parentCompare !== 0) {
      return parentCompare
    }

    return String(left.name || left.id).localeCompare(String(right.name || right.id))
  })
}

function deriveHistoricalWorkflowAgents(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return []
  }

  const rootTasks = tasks
    .filter((task) => !task.parentTaskId && task.agentId === 'agent-main' && Array.isArray(task.subTasks) && task.subTasks.length > 0)
    .sort((left, right) => new Date(right.updatedAt || right.createdAt || 0).getTime() - new Date(left.updatedAt || left.createdAt || 0).getTime())

  const latestWorkflowTask = rootTasks.find((task) => task.subTasks.some((subTaskId) => typeof subTaskId === 'string' && subTaskId.includes(':')))
  if (!latestWorkflowTask) {
    return []
  }

  const tasksById = new Map(tasks.map((task) => [task.id, task]))
  return latestWorkflowTask.subTasks
    .map((subTaskId) => tasksById.get(subTaskId))
    .filter((task) => task && task.stageId)
    .map((task) => {
      const descriptor = describeWorkflowStage(task.stageId)
      return {
        id: `${latestWorkflowTask.id}::${task.stageId}`,
        name: descriptor.name,
        role: descriptor.role,
        status: mapHistoricalWorkflowAgentStatus(task.status),
        currentTask: null,
        ephemeral: true,
        workflowParentTaskId: latestWorkflowTask.id,
        stageId: task.stageId,
        threadId: null,
        activeTurnId: null,
      }
    })
}

function describeWorkflowStage(stageId) {
  const normalized = typeof stageId === 'string' ? stageId.trim() : ''

  if (normalized === 'task-breakdown') {
    return {
      name: 'Task Breakdown',
      role: 'Owns the initial task breakdown and execution plan for the team.'
    }
  }

  if (normalized === 'quality-gate') {
    return {
      name: 'Quality Gate',
      role: 'Owns focused validation, QA, and final readiness review.'
    }
  }

  if (normalized === 'primary-build') {
    return {
      name: 'Primary Build',
      role: 'Owns the main implementation or analysis workstream.'
    }
  }

  if (normalized === 'ui-build') {
    return {
      name: 'UI Build',
      role: 'Owns the interface workstream, interaction details, and visual execution.'
    }
  }

  if (normalized === 'backend-integration') {
    return {
      name: 'Backend Integration',
      role: 'Owns backend, API, and data integration execution.'
    }
  }

  if (normalized === 'validation-sweep') {
    return {
      name: 'Validation Sweep',
      role: 'Owns focused validation, QA, and regression checks.'
    }
  }

  return {
    name: humanizeStageId(normalized),
    role: `Owns the ${humanizeStageId(normalized).toLowerCase()} workstream for this task.`
  }
}

function humanizeStageId(stageId) {
  return String(stageId || '')
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Workflow Stage'
}

function mapHistoricalWorkflowAgentStatus(taskStatus) {
  if (taskStatus === 'completed') {
    return 'completed'
  }
  if (taskStatus === 'awaiting_finish' || taskStatus === 'waiting') {
    return 'waiting'
  }
  if (taskStatus === 'failed' || taskStatus === 'error' || taskStatus === 'interrupted') {
    return 'error'
  }
  if (taskStatus === 'reviewing' || taskStatus === 'planning' || taskStatus === 'executing' || taskStatus === 'assigned') {
    return 'working'
  }
  return 'idle'
}
