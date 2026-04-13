const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

class BlackboardStore {
  constructor(options = {}) {
    this.rootDir = options.rootDir || path.join(process.cwd(), 'backend', 'data', 'blackboard')
    this.maxPreviewLength = Number(options.maxPreviewLength) || 500
    this.idempotency = new Set()
  }

  sessionDir(sessionId) {
    return path.join(this.rootDir, 'sessions', sessionId)
  }

  agentDir(sessionId, agentId) {
    return path.join(this.sessionDir(sessionId), 'agents', agentId)
  }

  sessionEventsPath(sessionId) {
    return path.join(this.sessionDir(sessionId), 'events.jsonl')
  }

  agentEventsPath(sessionId, agentId) {
    return path.join(this.agentDir(sessionId, agentId), 'events.jsonl')
  }

  sessionMarkdownPath(sessionId) {
    return path.join(this.sessionDir(sessionId), 'SESSION.md')
  }

  agentMarkdownPath(sessionId, agentId) {
    return path.join(this.agentDir(sessionId, agentId), 'AGENT.md')
  }

  async appendEvent(event, options = {}) {
    const normalizedEvent = normalizeEvent(event)
    const idempotencyKey = normalizedEvent.idempotencyKey || normalizedEvent.eventId

    const targets = []
    if (options.includeSession !== false) {
      targets.push({ scope: `session:${normalizedEvent.sessionId}`, path: this.sessionEventsPath(normalizedEvent.sessionId) })
    }
    if (options.includeAgent !== false && normalizedEvent.agentId) {
      targets.push({
        scope: `agent:${normalizedEvent.sessionId}:${normalizedEvent.agentId}`,
        path: this.agentEventsPath(normalizedEvent.sessionId, normalizedEvent.agentId)
      })
    }

    for (const target of targets) {
      const dedupeKey = `${target.scope}:${idempotencyKey}`
      if (this.idempotency.has(dedupeKey)) {
        continue
      }

      await fs.mkdir(path.dirname(target.path), { recursive: true })
      await fs.appendFile(target.path, `${JSON.stringify(normalizedEvent)}\n`, 'utf8')
      this.idempotency.add(dedupeKey)
    }

    await this.materializeSessionMarkdown(normalizedEvent.sessionId)
    if (normalizedEvent.agentId) {
      await this.materializeAgentMarkdown(normalizedEvent.sessionId, normalizedEvent.agentId)
    }

    return normalizedEvent
  }

  async getSessionEvents(sessionId, options = {}) {
    return this.readEvents(this.sessionEventsPath(sessionId), options)
  }

  async listSessionIds() {
    const sessionsRoot = path.join(this.rootDir, 'sessions')

    try {
      const entries = await fs.readdir(sessionsRoot, { withFileTypes: true })
      return entries
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .sort()
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        return []
      }
      throw error
    }
  }

  async getAgentEvents(sessionId, agentId, options = {}) {
    return this.readEvents(this.agentEventsPath(sessionId, agentId), options)
  }

  async getSessionSummary(sessionId) {
    const events = await this.getSessionEvents(sessionId)
    const tasks = new Map()
    let latestTs = null

    for (const event of events) {
      latestTs = event.ts
      if (event.task?.taskId) {
        const current = tasks.get(event.task.taskId) || {
          taskId: event.task.taskId,
          title: event.task.title || '',
          status: 'pending',
          agentId: null,
          updatedAt: event.ts
        }

        tasks.set(event.task.taskId, {
          ...current,
          title: event.task.title || current.title,
          status: event.task.status || current.status,
          agentId: event.agentId || current.agentId,
          updatedAt: event.ts
        })
      }
    }

    const taskList = Array.from(tasks.values()).sort((a, b) => {
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    })

    return {
      sessionId,
      eventCount: events.length,
      latestEventAt: latestTs,
      tasks: taskList
    }
  }

  async materializeSessionMarkdown(sessionId) {
    const summary = await this.getSessionSummary(sessionId)
    const checklistCards = buildWorkflowChecklistCards(summary.tasks)
    const lines = []

    lines.push(`# Session Blackboard: ${sessionId}`)
    lines.push('')
    lines.push(`- Last updated: ${summary.latestEventAt || 'n/a'}`)
    lines.push(`- Total events: ${summary.eventCount}`)
    lines.push(`- Tasks tracked: ${summary.tasks.length}`)
    lines.push('')
    lines.push('## Tasks')
    lines.push('')

    if (summary.tasks.length === 0) {
      lines.push('_No tasks yet._')
    } else {
      for (const task of summary.tasks) {
        lines.push(`- [${task.status}] ${task.taskId} | ${task.title || '(untitled)'} | agent: ${task.agentId || 'n/a'} | updated: ${task.updatedAt}`)
      }
    }

    if (checklistCards.length > 0) {
      lines.push('')
      lines.push('## Team Checklist Cards')
      lines.push('')

      for (const card of checklistCards) {
        lines.push(`### ${card.title}`)
        lines.push('')
        lines.push(`- Status: ${card.status}`)
        lines.push(`- [${card.steps.planning ? 'x' : ' '}] Planning`)
        lines.push(`- [${card.steps.execution ? 'x' : ' '}] Execution`)
        lines.push(`- [${card.steps.review ? 'x' : ' '}] Review`)
        lines.push('')
      }
    }

    lines.push('')
    lines.push('## Recent Events')
    lines.push('')

    const recent = (await this.getSessionEvents(sessionId, { limit: 20 })).reverse()
    if (recent.length === 0) {
      lines.push('_No events yet._')
    } else {
      for (const event of recent) {
        lines.push(`- ${event.ts} | ${event.type} | agent=${event.agentId || 'n/a'} | task=${event.task?.taskId || 'n/a'} | ${previewPayload(event.payload, this.maxPreviewLength)}`)
      }
    }

    await fs.mkdir(path.dirname(this.sessionMarkdownPath(sessionId)), { recursive: true })
    await fs.writeFile(this.sessionMarkdownPath(sessionId), `${lines.join('\n')}\n`, 'utf8')
  }

  async materializeAgentMarkdown(sessionId, agentId) {
    const events = await this.getAgentEvents(sessionId, agentId)
    const lines = []

    lines.push(`# Agent Blackboard: ${agentId}`)
    lines.push('')
    lines.push(`- Session: ${sessionId}`)
    lines.push(`- Total events: ${events.length}`)
    lines.push(`- Last updated: ${events.length ? events[events.length - 1].ts : 'n/a'}`)
    lines.push('')
    lines.push('## Timeline')
    lines.push('')

    if (events.length === 0) {
      lines.push('_No events yet._')
    } else {
      for (const event of events) {
        lines.push(`- ${event.ts} | ${event.type} | task=${event.task?.taskId || 'n/a'}`)
        if (event.type === 'command_execution') {
          lines.push(`  - command: ${event.payload?.command || 'n/a'}`)
          lines.push(`  - cwd: ${event.payload?.cwd || 'n/a'}`)
          lines.push(`  - exitCode: ${String(event.payload?.exitCode ?? 'n/a')}`)
          lines.push(`  - durationMs: ${String(event.payload?.durationMs ?? 'n/a')}`)
        }
      }
    }

    await fs.mkdir(path.dirname(this.agentMarkdownPath(sessionId, agentId)), { recursive: true })
    await fs.writeFile(this.agentMarkdownPath(sessionId, agentId), `${lines.join('\n')}\n`, 'utf8')
  }

  async readSessionMarkdown(sessionId) {
    return this.readFileSafe(this.sessionMarkdownPath(sessionId))
  }

  async readAgentMarkdown(sessionId, agentId) {
    return this.readFileSafe(this.agentMarkdownPath(sessionId, agentId))
  }

  async readEvents(filePath, options = {}) {
    const content = await this.readFileSafe(filePath)
    if (!content) {
      return []
    }

    const lines = content
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)

    let events = lines.map(line => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    }).filter(Boolean)

    if (options.sinceEventId) {
      const index = events.findIndex(event => event.eventId === options.sinceEventId)
      if (index >= 0) {
        events = events.slice(index + 1)
      }
    }

    if (options.limit && Number.isFinite(options.limit)) {
      events = events.slice(-Math.max(0, options.limit))
    }

    return events
  }

  async readFileSafe(filePath) {
    try {
      return await fs.readFile(filePath, 'utf8')
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        return ''
      }
      throw error
    }
  }
}

function normalizeEvent(event) {
  const now = new Date().toISOString()
  return {
    eventId: event.eventId || randomUUID(),
    ts: event.ts || now,
    sessionId: event.sessionId,
    agentId: event.agentId || null,
    threadId: event.threadId || null,
    turnId: event.turnId || null,
    type: event.type,
    task: event.task || null,
    payload: event.payload || {},
    idempotencyKey: event.idempotencyKey || null
  }
}

function buildWorkflowChecklistCards(tasks) {
  const cardsByParentId = new Map()

  for (const task of tasks) {
    const workflowStage = parseWorkflowStageTaskId(task.taskId)
    if (!workflowStage) {
      continue
    }

    const existing = cardsByParentId.get(workflowStage.parentTaskId) || {
      parentTaskId: workflowStage.parentTaskId,
      title: task.title.replace(/\s+·\s+(Planning|Execution|Review)$/, ''),
      status: 'pending',
      steps: {
        planning: false,
        execution: false,
        review: false
      }
    }

    existing.steps[workflowStage.stage] = task.status === 'completed'
    cardsByParentId.set(workflowStage.parentTaskId, existing)
  }

  for (const task of tasks) {
    const existing = cardsByParentId.get(task.taskId)
    if (!existing) {
      continue
    }

    existing.title = task.title || existing.title
    existing.status = task.status || existing.status
  }

  return Array.from(cardsByParentId.values()).sort((left, right) => {
    return left.parentTaskId.localeCompare(right.parentTaskId)
  })
}

function parseWorkflowStageTaskId(taskId) {
  if (typeof taskId !== 'string') {
    return null
  }

  const match = taskId.match(/^(.*):(planner|executor|reviewer)$/)
  if (!match) {
    return null
  }

  return {
    parentTaskId: match[1],
    stage: normalizeWorkflowStage(match[2])
  }
}

function normalizeWorkflowStage(stageId) {
  if (stageId === 'planner') {
    return 'planning'
  }
  if (stageId === 'executor') {
    return 'execution'
  }
  return 'review'
}

function previewPayload(payload, maxLength) {
  const text = JSON.stringify(payload)
  if (!text || text === '{}') {
    return ''
  }
  if (text.length <= maxLength) {
    return text
  }
  return `${text.slice(0, maxLength)}...`
}

module.exports = { BlackboardStore }
