const express = require('express')
const { DEFAULT_SESSION_ID } = require('../services/sessionStore')

const router = express.Router()

// Timeout warning threshold (5 minutes)
const TIMEOUT_WARNING_MS = 5 * 60 * 1000

const taskTimeouts = new Map()

// Task state machine
const TaskState = {
  PENDING: 'pending',
  PLANNING: 'planning',
  EXECUTING: 'executing',
  REVIEWING: 'reviewing',
  COMPLETED: 'completed',
  REJECTED: 'rejected'
}

// Valid state transitions
const validTransitions = {
  [TaskState.PENDING]: [TaskState.PLANNING],
  [TaskState.PLANNING]: [TaskState.EXECUTING],
  [TaskState.EXECUTING]: [TaskState.REVIEWING],
  [TaskState.REVIEWING]: [TaskState.COMPLETED, TaskState.EXECUTING],
  [TaskState.COMPLETED]: [],
  [TaskState.REJECTED]: [TaskState.PENDING]
}

function normalizeSessionId(req, sessionStore) {
  return sessionStore.normalizeSessionId(getSessionId(req))
}

function getSessionId(req) {
  return req.body?.sessionId || req.query?.sessionId || DEFAULT_SESSION_ID
}

function getTimeoutKey(sessionId, taskId) {
  return `${sessionId}:${taskId}`
}

function canTransition(from, to) {
  return validTransitions[from]?.includes(to) || false
}

function setTaskTimeout(sessionId, taskId, startTime, sessionStore, broadcast) {
  clearTaskTimeout(sessionId, taskId)

  const timeoutKey = getTimeoutKey(sessionId, taskId)
  const timeoutId = setTimeout(() => {
    taskTimeouts.delete(timeoutKey)
    const task = sessionStore.getTask(sessionId, taskId)
    if (task && [TaskState.PLANNING, TaskState.EXECUTING, TaskState.REVIEWING].includes(task.status)) {
      broadcast({
        type: 'task_warning',
        sessionId,
        payload: {
          taskId,
          message: '任务执行时间过长',
          details: {
            status: task.status,
            elapsed: Date.now() - new Date(startTime).getTime()
          }
        },
        timestamp: new Date().toISOString()
      })

      console.warn(`[TIMEOUT WARNING] Session ${sessionId} task ${taskId} has been in ${task.status} for over 5 minutes`)
    }
  }, TIMEOUT_WARNING_MS)

  taskTimeouts.set(timeoutKey, timeoutId)
}

function clearTaskTimeout(sessionId, taskId) {
  const timeoutKey = getTimeoutKey(sessionId, taskId)
  const existingTimeout = taskTimeouts.get(timeoutKey)
  if (existingTimeout) {
    clearTimeout(existingTimeout)
    taskTimeouts.delete(timeoutKey)
  }
}

function resolveTask(sessionStore, requestedSessionId, taskId) {
  const sessionId = sessionStore.normalizeSessionId(requestedSessionId)
  const task = sessionStore.getTask(sessionId, taskId)

  if (!task) {
    return null
  }

  return { sessionId, task }
}

function clearAllTaskTimeouts() {
  taskTimeouts.forEach(timeoutId => clearTimeout(timeoutId))
  taskTimeouts.clear()
}

// GET /api/tasks/stats/summary - Get task statistics
router.get('/stats/summary', (req, res) => {
  const sessionStore = req.app.get('sessionStore')
  const sessionId = normalizeSessionId(req, sessionStore)
  const tasks = sessionStore.getTasks(sessionId)
  const stats = {
    sessionId,
    total: tasks.length,
    byStatus: {}
  }

  for (const status of Object.values(TaskState)) {
    stats.byStatus[status] = tasks.filter(task => task.status === status).length
  }

  stats.active = stats.byStatus[TaskState.PENDING] +
                 stats.byStatus[TaskState.PLANNING] +
                 stats.byStatus[TaskState.EXECUTING] +
                 stats.byStatus[TaskState.REVIEWING]
  stats.completed = stats.byStatus[TaskState.COMPLETED]
  stats.rejected = stats.byStatus[TaskState.REJECTED]

  res.json(stats)
})

// GET /api/tasks - Get all tasks
router.get('/', (req, res) => {
  const sessionStore = req.app.get('sessionStore')
  const sessionId = normalizeSessionId(req, sessionStore)
  const { status, limit = 100 } = req.query

  let result = sessionStore.getTasks(sessionId)

  if (status && Object.values(TaskState).includes(status)) {
    result = result.filter(task => task.status === status)
  }

  result = result.slice(0, parseInt(limit, 10))

  res.json({ tasks: result })
})

// POST /api/tasks - Create new task
router.post('/', (req, res) => {
  const { description, priority = 'normal' } = req.body
  const sessionStore = req.app.get('sessionStore')
  const sessionId = normalizeSessionId(req, sessionStore)

  if (typeof description !== 'string') {
    return res.status(400).json({ error: 'Description must be a non-empty string' })
  }

  const normalizedDescription = description.trim()
  if (!normalizedDescription) {
    return res.status(400).json({ error: 'Description must be a non-empty string' })
  }

  if (normalizedDescription.length > 1000) {
    return res.status(400).json({ error: 'Description too long (max 1000 characters)' })
  }

  const task = sessionStore.createTask({ sessionId, description: normalizedDescription, priority })

  res.status(201).json(task)
})

// GET /api/tasks/:id/history - Get task state history
router.get('/:id/history', (req, res) => {
  const sessionStore = req.app.get('sessionStore')
  const requestedSessionId = getSessionId(req)
  const resolved = resolveTask(sessionStore, requestedSessionId, req.params.id)

  if (!resolved) {
    return res.status(404).json({ error: 'Task not found' })
  }

  const history = (resolved.task.logs || [])
    .filter(log => (log.message || '').includes('状态'))
    .map(log => ({
      status: log.message.split('→')[1]?.trim() || log.message,
      timestamp: log.timestamp || new Date().toISOString()
    }))

  res.json({
    taskId: resolved.task.id,
    sessionId: resolved.sessionId,
    history
  })
})

// GET /api/tasks/:id - Get single task
router.get('/:id', (req, res) => {
  const sessionStore = req.app.get('sessionStore')
  const requestedSessionId = getSessionId(req)
  const resolved = resolveTask(sessionStore, requestedSessionId, req.params.id)

  if (!resolved) {
    return res.status(404).json({ error: 'Task not found' })
  }

  res.json({
    ...resolved.task,
    sessionId: resolved.sessionId
  })
})

// PUT /api/tasks/:id/status - Update task status
router.put('/:id/status', (req, res) => {
  const { id } = req.params
  const { status: newStatus, result, error } = req.body
  const sessionStore = req.app.get('sessionStore')
  const broadcast = req.app.get('broadcast')
  const requestedSessionId = getSessionId(req)
  const resolved = resolveTask(sessionStore, requestedSessionId, id)

  if (!resolved) {
    return res.status(404).json({ error: 'Task not found' })
  }

  const task = resolved.task
  const sessionId = resolved.sessionId

  if (!canTransition(task.status, newStatus)) {
    return res.status(400).json({
      error: 'Invalid state transition',
      currentStatus: task.status,
      requestedStatus: newStatus,
      validTransitions: validTransitions[task.status]
    })
  }

  const oldStatus = task.status
  task.status = newStatus
  task.updatedAt = new Date().toISOString()

  if (result !== undefined) {
    task.result = result
  }

  if (error !== undefined) {
    task.error = error
  }

  task.logs = task.logs || []
  task.logs.push({
    level: 'info',
    message: `任务状态: ${oldStatus} → ${newStatus}`,
    timestamp: task.updatedAt
  })

  sessionStore.updateTask({
    ...task,
    sessionId
  })

  if ([TaskState.PLANNING, TaskState.EXECUTING, TaskState.REVIEWING].includes(newStatus)) {
    setTaskTimeout(sessionId, id, task.updatedAt, sessionStore, broadcast)
  } else {
    clearTaskTimeout(sessionId, id)
  }

  broadcast({
    type: 'task_update',
    sessionId,
    payload: {
      taskId: id,
      data: {
        status: newStatus,
        updatedAt: task.updatedAt,
        result: task.result,
        error: task.error
      }
    },
    timestamp: task.updatedAt
  })

  sessionStore.addLog(sessionId, {
    taskId: id,
    level: 'info',
    message: `任务状态: ${oldStatus} → ${newStatus}`
  }, task.updatedAt)

  res.json({
    ...task,
    sessionId
  })
})

// DELETE /api/tasks/:id - Cancel/delete task
router.delete('/:id', (req, res) => {
  const sessionStore = req.app.get('sessionStore')
  const requestedSessionId = getSessionId(req)
  const resolved = resolveTask(sessionStore, requestedSessionId, req.params.id)

  if (!resolved) {
    return res.status(404).json({ error: 'Task not found' })
  }

  const task = resolved.task
  const sessionId = resolved.sessionId

  if ([TaskState.PLANNING, TaskState.EXECUTING, TaskState.REVIEWING].includes(task.status)) {
    return res.status(400).json({ error: 'Cannot delete active task' })
  }

  clearTaskTimeout(sessionId, req.params.id)
  sessionStore.deleteTask(sessionId, req.params.id)

  res.json({ success: true, message: 'Task deleted' })
})

module.exports = router
module.exports.TaskState = TaskState
module.exports.clearAllTaskTimeouts = clearAllTaskTimeouts
