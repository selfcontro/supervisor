function toTime(value) {
  const timestamp = new Date(value || 0).getTime()
  return Number.isFinite(timestamp) ? timestamp : 0
}

function compareNewestFirst(left, right) {
  const delta = toTime(right.timestamp) - toTime(left.timestamp)
  if (delta !== 0) {
    return delta
  }

  return String(right.id).localeCompare(String(left.id))
}

function buildSessionTimeline(tasks = [], logs = [], options = {}) {
  const limit = Number.isFinite(options.limit) ? options.limit : 80
  const events = []

  for (const task of tasks) {
    if (!task || !task.id || !task.createdAt) {
      continue
    }

    events.push({
      id: `task:${task.id}:created`,
      kind: 'task',
      timestamp: task.createdAt,
      title: 'Task created',
      message: task.description || task.id,
      status: task.status,
      taskId: task.id,
      agentId: task.agentId || null,
    })

    const updatedAt = task.updatedAt || task.createdAt
    if (updatedAt !== task.createdAt) {
      events.push({
        id: `task:${task.id}:updated`,
        kind: 'task',
        timestamp: updatedAt,
        title: `Task ${task.status || 'updated'}`,
        message: task.result || task.error || task.description || task.id,
        status: task.status,
        taskId: task.id,
        agentId: task.agentId || null,
      })
    }
  }

  for (const log of logs) {
    if (!log || !log.id || !log.timestamp || !log.message) {
      continue
    }

    events.push({
      id: `log:${log.id}`,
      kind: 'log',
      timestamp: log.timestamp,
      title: log.level || 'log',
      message: log.message,
      level: log.level,
      taskId: log.taskId || null,
      agentId: log.agentId || null,
    })
  }

  return events.sort(compareNewestFirst).slice(0, Math.max(0, limit))
}

function filterSessionLogs(logs = [], filters = {}) {
  const agentId = filters.agentId || null
  const taskIds = new Set(filters.taskIds || [])

  return logs
    .filter((log) => {
      if (!log) {
        return false
      }

      if (!agentId && taskIds.size === 0) {
        return true
      }

      return (agentId && log.agentId === agentId) || (log.taskId && taskIds.has(log.taskId))
    })
    .sort((left, right) => compareNewestFirst(
      { id: left.id, timestamp: left.timestamp },
      { id: right.id, timestamp: right.timestamp }
    ))
}

module.exports = {
  buildSessionTimeline,
  filterSessionLogs,
}
