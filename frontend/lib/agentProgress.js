function buildAgentProgressMap(agents, tasks, logs) {
  const tasksById = new Map((tasks || []).map((task) => [task.id, task]))
  const sortedLogs = [...(logs || [])].sort(
    (left, right) => new Date(right.timestamp || 0).getTime() - new Date(left.timestamp || 0).getTime()
  )
  const progress = {}

  for (const agent of agents || []) {
    progress[agent.id] = agent.id === 'agent-main'
      ? buildCoordinatorProgress(agent, tasksById, sortedLogs)
      : buildWorkerProgress(agent, tasksById, sortedLogs)
  }

  return progress
}

function buildCoordinatorProgress(agent, tasksById, logs) {
  const parentTasks = [...tasksById.values()]
    .filter((task) => task.agentId === agent.id)
    .sort((left, right) => new Date(right.updatedAt || right.createdAt || 0).getTime() - new Date(left.updatedAt || left.createdAt || 0).getTime())
  const currentTask = parentTasks.find((task) => !['completed', 'failed', 'rejected'].includes(task.status)) || parentTasks[0]

  if (!currentTask) {
    return null
  }

  const stageTasks = (currentTask.subTasks || [])
    .map((taskId) => tasksById.get(taskId))
    .filter(Boolean)
  const completedCount = stageTasks.filter((task) => ['completed', 'waiting'].includes(task.status)).length
  const activeStage = stageTasks.find((task) => ['planning', 'executing', 'reviewing', 'working'].includes(task.status))
  const latestCommand = findLatestCommand(logs, {
    taskIds: stageTasks.map((task) => task.id),
  })

  return {
    label: activeStage
      ? `Running ${activeStage.agentId || 'workflow'}`
      : `${completedCount}/${stageTasks.length || 0} stages ready`,
    detail: activeStage
      ? firstLine(activeStage.description)
      : currentTask.status === 'awaiting_finish'
        ? 'All stages finished. Waiting for manual finish.'
        : firstLine(currentTask.description),
    latestCommand,
  }
}

function buildWorkerProgress(agent, tasksById, logs) {
  const agentTasks = [...tasksById.values()]
    .filter((task) => task.agentId === agent.id)
    .sort((left, right) => new Date(right.updatedAt || right.createdAt || 0).getTime() - new Date(left.updatedAt || left.createdAt || 0).getTime())
  const currentTask = agentTasks[0]

  if (!currentTask) {
    return null
  }

  return {
    label: statusLabel(currentTask.status),
    detail: currentTask.result
      ? firstLine(currentTask.result)
      : currentTask.error
        ? firstLine(currentTask.error)
        : currentTask.description,
    latestCommand: findLatestCommand(logs, {
      taskIds: [currentTask.id],
      agentIds: [agent.id],
    }),
  }
}

function findLatestCommand(logs, scope) {
  const match = logs.find((entry) => {
    if (scope.taskIds && scope.taskIds.includes(entry.taskId || '')) {
      return true
    }
    if (scope.agentIds && scope.agentIds.includes(entry.agentId || '')) {
      return true
    }
    return false
  })

  if (!match || typeof match.message !== 'string') {
    return null
  }

  return match.message.replace(/^\[[^\]]+\]\s*/, '').trim()
}

function firstLine(value) {
  return String(value || '').split('\n').map((line) => line.trim()).find(Boolean) || null
}

function statusLabel(status) {
  if (status === 'executing' || status === 'working') {
    return 'Executing now'
  }
  if (status === 'planning') {
    return 'Planning'
  }
  if (status === 'reviewing') {
    return 'Reviewing'
  }
  if (status === 'waiting') {
    return 'Waiting'
  }
  if (status === 'completed') {
    return 'Completed'
  }
  if (status === 'awaiting_finish') {
    return 'Awaiting finish'
  }
  if (status === 'failed' || status === 'error') {
    return 'Failed'
  }
  return status || 'Idle'
}

module.exports = {
  buildAgentProgressMap,
}
