const express = require('express')

const router = express.Router()

function getOrchestrator(req) {
  const orchestrator = req.app.get('codexOrchestrator')
  if (!orchestrator || !orchestrator.started) {
    const error = new Error('Codex control is unavailable')
    error.status = 503
    throw error
  }
  return orchestrator
}

function sendError(res, error, fallback = 500) {
  const status = Number(error?.status) || fallback
  res.status(status).json({ error: error.message || 'Unknown error' })
}

router.get('/sessions/:sessionId/agents', async (req, res) => {
  try {
    const orchestrator = getOrchestrator(req)
    const agents = orchestrator.listAgents(req.params.sessionId)
    res.json({ agents })
  } catch (error) {
    sendError(res, error)
  }
})

router.post('/sessions/:sessionId/agents', async (req, res) => {
  try {
    const orchestrator = getOrchestrator(req)
    const { agentId, harness } = req.body || {}

    if (typeof agentId !== 'string' || !agentId.trim()) {
      return res.status(400).json({ error: 'agentId is required' })
    }

    const agent = await orchestrator.createOrActivateAgent(req.params.sessionId, agentId, { harness })
    res.status(201).json(agent)
  } catch (error) {
    sendError(res, error)
  }
})

router.post('/sessions/:sessionId/agents/:agentId/tasks', async (req, res) => {
  try {
    const orchestrator = getOrchestrator(req)
    const result = await orchestrator.dispatchTask(req.params.sessionId, req.params.agentId, req.body || {})
    res.status(202).json(result)
  } catch (error) {
    if (error.message.includes('required')) {
      return res.status(400).json({ error: error.message })
    }
    sendError(res, error)
  }
})

router.post('/sessions/:sessionId/agents/:agentId/interrupt', async (req, res) => {
  try {
    const orchestrator = getOrchestrator(req)
    const result = await orchestrator.interrupt(req.params.sessionId, req.params.agentId)
    res.json(result)
  } catch (error) {
    if (error.message.includes('not found') || error.message.includes('no active turn')) {
      return res.status(404).json({ error: error.message })
    }
    sendError(res, error)
  }
})

router.post('/sessions/:sessionId/agents/:agentId/resume', async (req, res) => {
  try {
    const orchestrator = getOrchestrator(req)
    const result = await orchestrator.resume(req.params.sessionId, req.params.agentId, req.body || {})
    res.json(result)
  } catch (error) {
    if (error.message.includes('not found') || error.message.includes('No active task')) {
      return res.status(404).json({ error: error.message })
    }
    sendError(res, error)
  }
})

router.post('/sessions/:sessionId/agents/:agentId/tasks/:taskId/retry', async (req, res) => {
  try {
    const orchestrator = getOrchestrator(req)
    const result = await orchestrator.retry(req.params.sessionId, req.params.agentId, req.params.taskId)
    res.json(result)
  } catch (error) {
    if (error.message.includes('not found')) {
      return res.status(404).json({ error: error.message })
    }
    sendError(res, error)
  }
})

router.post('/sessions/:sessionId/agents/:agentId/close', async (req, res) => {
  try {
    const orchestrator = getOrchestrator(req)
    const result = await orchestrator.closeAgent(req.params.sessionId, req.params.agentId)
    res.json(result)
  } catch (error) {
    if (error.message.includes('not found')) {
      return res.status(404).json({ error: error.message })
    }
    sendError(res, error)
  }
})

router.post('/sessions/:sessionId/agents/:agentId/approvals/:requestId', async (req, res) => {
  try {
    const orchestrator = getOrchestrator(req)
    const { decision } = req.body || {}

    if (typeof decision !== 'string' || !decision.trim()) {
      return res.status(400).json({ error: 'decision is required' })
    }

    const result = await orchestrator.respondApproval(
      req.params.sessionId,
      req.params.agentId,
      req.params.requestId,
      decision.trim()
    )

    res.json(result)
  } catch (error) {
    if (error.message.includes('not found')) {
      return res.status(404).json({ error: error.message })
    }
    sendError(res, error)
  }
})

router.get('/sessions/:sessionId/blackboard', async (req, res) => {
  try {
    const orchestrator = getOrchestrator(req)
    const summary = await orchestrator.getSessionBlackboard(req.params.sessionId)
    res.json(summary)
  } catch (error) {
    sendError(res, error)
  }
})

router.get('/sessions/:sessionId/blackboard/markdown', async (req, res) => {
  try {
    const orchestrator = getOrchestrator(req)
    const markdown = await orchestrator.getSessionMarkdown(req.params.sessionId)
    res.type('text/markdown').send(markdown)
  } catch (error) {
    sendError(res, error)
  }
})

router.get('/sessions/:sessionId/agents/:agentId/blackboard', async (req, res) => {
  try {
    const orchestrator = getOrchestrator(req)
    const detail = await orchestrator.getAgentBlackboard(req.params.sessionId, req.params.agentId)
    res.json(detail)
  } catch (error) {
    sendError(res, error)
  }
})

router.get('/sessions/:sessionId/agents/:agentId/blackboard/markdown', async (req, res) => {
  try {
    const orchestrator = getOrchestrator(req)
    const markdown = await orchestrator.getAgentMarkdown(req.params.sessionId, req.params.agentId)
    res.type('text/markdown').send(markdown)
  } catch (error) {
    sendError(res, error)
  }
})

module.exports = router
