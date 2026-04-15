function buildWorkflowLayout(agents) {
  const layout = {}
  const coordinator = (agents || []).find((agent) => agent.id === 'agent-main')
  const workflowGroups = groupWorkflowAgents(agents || [])

  if (coordinator) {
    layout[coordinator.id] = { x: 420, y: 28 }
  }

  let cursorX = 180

  workflowGroups.forEach((group) => {
    const breakdownAgent = group.find((agent) => getWorkflowStageKind(agent.stageId) === 'breakdown')
    const reviewAgent = group.find((agent) => getWorkflowStageKind(agent.stageId) === 'review')
    const workerAgents = group.filter((agent) => getWorkflowStageKind(agent.stageId) === 'worker')
    const workerSpacing = workerAgents.length > 1 ? 290 : 0
    const groupSpan = Math.max(320, workerAgents.length > 0 ? 320 + workerSpacing * (workerAgents.length - 1) : 320)
    const centerX = cursorX + groupSpan / 2

    if (breakdownAgent) {
      layout[breakdownAgent.id] = { x: centerX, y: 320 }
    }

    const workerStartX = centerX - ((workerAgents.length - 1) * workerSpacing) / 2
    workerAgents.forEach((agent, workerIndex) => {
      layout[agent.id] = {
        x: workerStartX + workerIndex * workerSpacing,
        y: 612,
      }
    })

    if (reviewAgent) {
      layout[reviewAgent.id] = { x: centerX, y: 904 }
    }

    cursorX += groupSpan + 340
  })

  const extraRuntimeAgents = (agents || []).filter(
    (agent) => agent.id !== 'agent-main' && !agent.ephemeral && !agent.stageId
  )

  extraRuntimeAgents.forEach((agent, index) => {
    layout[agent.id] = { x: Math.max(cursorX, 980), y: 304 + index * 188 }
  })

  return layout
}

function groupWorkflowAgents(agents) {
  const grouped = new Map()

  for (const agent of agents) {
    if (!agent.ephemeral || !agent.workflowParentTaskId) {
      continue
    }

    const bucket = grouped.get(agent.workflowParentTaskId) || []
    bucket.push(agent)
    grouped.set(agent.workflowParentTaskId, bucket)
  }

  return Array.from(grouped.values()).map((group) =>
    group.slice().sort((left, right) => {
      const kindOrder = workflowKindOrder(getWorkflowStageKind(left.stageId)) - workflowKindOrder(getWorkflowStageKind(right.stageId))
      if (kindOrder !== 0) {
        return kindOrder
      }
      return String(left.name || left.id).localeCompare(String(right.name || right.id))
    })
  )
}

function getWorkflowStageKind(stageId) {
  if (stageId === 'task-breakdown') {
    return 'breakdown'
  }
  if (stageId === 'quality-gate') {
    return 'review'
  }
  return 'worker'
}

function workflowKindOrder(kind) {
  if (kind === 'breakdown') {
    return 0
  }
  if (kind === 'worker') {
    return 1
  }
  if (kind === 'review') {
    return 2
  }
  return 3
}

module.exports = {
  buildWorkflowLayout,
  groupWorkflowAgents,
  getWorkflowStageKind,
  workflowKindOrder,
}
