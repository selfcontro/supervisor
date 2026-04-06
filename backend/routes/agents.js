const express = require('express')
const { DEFAULT_SESSION_ID } = require('../services/sessionStore')

const router = express.Router()

function getSessionId(req) {
  return req.body?.sessionId || req.query?.sessionId || DEFAULT_SESSION_ID
}

// GET /api/agents - Get all agents
router.get('/', (req, res) => {
  const sessionStore = req.app.get('sessionStore')
  const sessionId = getSessionId(req)

  res.json({ agents: sessionStore.getAgents(sessionId) })
})

// GET /api/agents/:id - Get single agent
router.get('/:id', (req, res) => {
  const sessionStore = req.app.get('sessionStore')
  const sessionId = getSessionId(req)
  const agents = sessionStore.getAgents(sessionId)
  const agent = agents.find(candidate => candidate.id === req.params.id)

  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' })
  }

  res.json(agent)
})

// POST /api/agents/:id/task - Assign task to agent
router.post('/:id/task', (req, res) => {
  const { task } = req.body
  const agentId = req.params.id
  const sessionStore = req.app.get('sessionStore')
  const sessionId = getSessionId(req)
  const agentManager = sessionStore.getAgentManager(sessionId)
  const agent = agentManager.getAgent(agentId)

  if (!task) {
    return res.status(400).json({ error: 'Task is required' })
  }

  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' })
  }

  agent.status = 'working'
  agent.currentTask = task
  agent.taskHistory = [...(agent.taskHistory || []), {
    task,
    assignedAt: new Date().toISOString()
  }].slice(-20)

  req.app.get('broadcast')({
    type: 'agent_status',
    sessionId,
    payload: {
      agentId,
      data: {
        status: agent.status,
        currentTask: agent.currentTask
      }
    },
    timestamp: new Date().toISOString()
  })

  sessionStore.addLog(sessionId, {
    agentId,
    level: 'info',
    message: `已为 ${agentId} 分配任务`,
    task
  })

  res.json({ success: true, agent })
})

module.exports = router
