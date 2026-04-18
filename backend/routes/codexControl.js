const express = require('express')

const router = express.Router()
const LAYOUT_OVERLAP_TEMPLATE_ID = 'layout-overlap-verification'
const LAYOUT_OVERLAP_WORKSTREAMS = ['ui-build', 'backend-integration', 'validation-sweep']
const LAYOUT_OVERLAP_CHECKLIST = [
  'Verify overlap behavior across mobile, tablet, and desktop viewport breakpoints.',
  'Confirm backend stub payload covers overlap sources, impacted regions, and reproduction notes.',
  'Validate the UI draft maps cleanly to the backend response shape without extra transforms.',
  'Record pass/fail outcomes and unresolved collisions for coordinator handoff.'
]
const LAYOUT_OVERLAP_TYPED_CHECKLIST = [
  {
    id: 'viewport-fit',
    label: 'Check mobile, tablet, and desktop overlap breakpoints.',
    required: true,
    status: 'pending'
  },
  {
    id: 'collision-source',
    label: 'Capture overlap sources, impacted regions, and reproduction notes.',
    required: true,
    status: 'pending'
  },
  {
    id: 'api-shape',
    label: 'Confirm the backend stub shape can carry verification evidence.',
    required: true,
    status: 'pending'
  },
  {
    id: 'handoff',
    label: 'Record pass or fail outcomes and unresolved collisions for handoff.',
    required: true,
    status: 'pending'
  }
]

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

function buildLayoutOverlapPrompt(body = {}) {
  const notes = typeof body.notes === 'string' ? body.notes.trim() : ''
  const lines = [
    'Use the agent team to build a UI draft, backend integration stub, and validation checklist in parallel.',
    '',
    'Primary objective: verify and document layout overlap risks before full implementation.',
    '',
    'Expected workstreams:',
    '- UI draft for the overlap scenario and affected surfaces.',
    '- Backend integration stub for overlap verification data and API wiring.',
    '- Validation checklist covering breakpoints, regressions, and handoff evidence.'
  ]

  if (notes) {
    lines.push('', `Context notes: ${notes}`)
  }

  return lines.join('\n')
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

router.post('/sessions/:sessionId/team', async (req, res) => {
  try {
    const orchestrator = getOrchestrator(req)
    const result = await orchestrator.createTeam(req.params.sessionId, req.body || {})
    res.status(202).json(result)
  } catch (error) {
    if (error.message.includes('required')) {
      return res.status(400).json({ error: error.message })
    }
    sendError(res, error)
  }
})

router.post('/sessions/:sessionId/team/layout-overlap-verification', async (req, res) => {
  try {
    const orchestrator = getOrchestrator(req)
    const payload = req.body || {}
    const title = typeof payload.title === 'string' && payload.title.trim()
      ? payload.title.trim()
      : 'Layout overlap verification'
    const result = await orchestrator.createTeam(req.params.sessionId, {
      ...payload,
      title,
      prompt: buildLayoutOverlapPrompt(payload)
    })

    res.status(202).json({
      ...result,
      templateId: LAYOUT_OVERLAP_TEMPLATE_ID,
      workstreams: LAYOUT_OVERLAP_WORKSTREAMS,
      validationChecklist: LAYOUT_OVERLAP_CHECKLIST,
      verification: {
        scope: 'layout-overlap',
        state: 'planned',
        workstreams: LAYOUT_OVERLAP_WORKSTREAMS,
        checklist: LAYOUT_OVERLAP_TYPED_CHECKLIST
      }
    })
  } catch (error) {
    if (error.message.includes('required')) {
      return res.status(400).json({ error: error.message })
    }
    sendError(res, error)
  }
})

router.post('/sessions/:sessionId/tasks/:taskId/finish', async (req, res) => {
  try {
    const orchestrator = getOrchestrator(req)
    const result = await orchestrator.finishTask(req.params.sessionId, req.params.taskId)
    res.json(result)
  } catch (error) {
    if (error.message.includes('not found')) {
      return res.status(404).json({ error: error.message })
    }
    if (error.message.includes('not ready')) {
      return res.status(409).json({ error: error.message })
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
