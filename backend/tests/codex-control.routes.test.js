const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const http = require('http')

const codexControlRouter = require('../routes/codexControl')

function createFakeOrchestrator() {
  return {
    started: true,
    teamCalls: [],
    listAgents(sessionId) {
      return [{ sessionId, agentId: 'agent-main', state: 'idle' }]
    },
    async createOrActivateAgent(sessionId, agentId) {
      return { sessionId, agentId, state: 'idle', threadId: 'thread_x' }
    },
    async dispatchTask(sessionId, agentId) {
      return { sessionId, agentId, taskId: 'task_x', turnId: 'turn_x', threadId: 'thread_x', status: 'accepted' }
    },
    async createTeam(sessionId, payload) {
      this.teamCalls.push({ sessionId, payload })
      return { sessionId, agentId: 'agent-main', taskId: 'task_team', turnId: null, threadId: 'thread_x', status: 'accepted' }
    },
    async finishTask(sessionId, taskId) {
      return { ok: true, sessionId, taskId, status: 'completed' }
    },
    async interrupt() {
      return { ok: true }
    },
    async resume() {
      return { ok: true, turnId: 'turn_y' }
    },
    async retry() {
      return { ok: true, turnId: 'turn_z', attempt: 2 }
    },
    async closeAgent() {
      return { ok: true }
    },
    async respondApproval() {
      return { ok: true }
    },
    async getSessionBlackboard(sessionId) {
      return { sessionId, eventCount: 2, tasks: [] }
    },
    async getSessionMarkdown(sessionId) {
      return `# Session Blackboard: ${sessionId}`
    },
    async getAgentBlackboard(sessionId, agentId) {
      return { sessionId, agentId, eventCount: 1, events: [] }
    },
    async getAgentMarkdown(sessionId, agentId) {
      return `# Agent Blackboard: ${agentId} in ${sessionId}`
    }
  }
}

async function withServer(handler) {
  const app = express()
  app.use(express.json())
  app.use('/api/codex-control', codexControlRouter)

  const server = http.createServer(app)
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address()
  const base = `http://127.0.0.1:${address.port}`

  try {
    await handler({ app, base })
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
  }
}

test('returns 503 when codex orchestrator is unavailable', async () => {
  await withServer(async ({ base }) => {
    const response = await fetch(`${base}/api/codex-control/sessions/s1/agents`)
    assert.equal(response.status, 503)
    const payload = await response.json()
    assert.equal(payload.error, 'Codex control is unavailable')
  })
})

test('serves codex control routes when orchestrator is present', async () => {
  await withServer(async ({ app, base }) => {
    app.set('codexOrchestrator', createFakeOrchestrator())

    const listResponse = await fetch(`${base}/api/codex-control/sessions/s1/agents`)
    assert.equal(listResponse.status, 200)
    const listPayload = await listResponse.json()
    assert.equal(listPayload.agents[0].agentId, 'agent-main')

    const createResponse = await fetch(`${base}/api/codex-control/sessions/s1/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: 'agent-main' })
    })
    assert.equal(createResponse.status, 201)

    const taskResponse = await fetch(`${base}/api/codex-control/sessions/s1/agents/agent-main/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'run task' })
    })
    assert.equal(taskResponse.status, 202)

    const teamResponse = await fetch(`${base}/api/codex-control/sessions/s1/team`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'create an agent team' })
    })
    assert.equal(teamResponse.status, 202)
    const teamPayload = await teamResponse.json()
    assert.equal(teamPayload.agentId, 'agent-main')

    const finishResponse = await fetch(`${base}/api/codex-control/sessions/s1/tasks/task_x/finish`, {
      method: 'POST'
    })
    assert.equal(finishResponse.status, 200)

    const approvalResponse = await fetch(`${base}/api/codex-control/sessions/s1/agents/agent-main/approvals/req_1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'approve' })
    })
    assert.equal(approvalResponse.status, 200)

    const markdownResponse = await fetch(`${base}/api/codex-control/sessions/s1/blackboard/markdown`)
    assert.equal(markdownResponse.status, 200)
    const markdownText = await markdownResponse.text()
    assert.match(markdownText, /Session Blackboard/)
  })
})

test('creates a layout overlap verification team stub with fixed workstreams and checklist', async () => {
  await withServer(async ({ app, base }) => {
    const orchestrator = createFakeOrchestrator()
    app.set('codexOrchestrator', orchestrator)

    const response = await fetch(`${base}/api/codex-control/sessions/layout-session/team/layout-overlap-verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Layout overlap verification',
        notes: 'Focus on dashboard header and sidebar collisions.'
      })
    })

    assert.equal(response.status, 202)
    const payload = await response.json()
    assert.equal(payload.templateId, 'layout-overlap-verification')
    assert.deepEqual(payload.workstreams, ['ui-build', 'backend-integration', 'validation-sweep'])
    assert.equal(payload.validationChecklist.length, 4)
    assert.match(payload.validationChecklist[0], /viewport/i)
    assert.equal(payload.verification.scope, 'layout-overlap')
    assert.equal(payload.verification.state, 'planned')
    assert.deepEqual(payload.verification.workstreams, payload.workstreams)
    assert.equal(payload.verification.checklist[0].id, 'viewport-fit')
    assert.equal(payload.verification.checklist[0].status, 'pending')

    assert.equal(orchestrator.teamCalls.length, 1)
    assert.equal(orchestrator.teamCalls[0].sessionId, 'layout-session')
    assert.equal(orchestrator.teamCalls[0].payload.title, 'Layout overlap verification')
    assert.match(orchestrator.teamCalls[0].payload.prompt, /Use the agent team to build a UI draft, backend integration stub, and validation checklist in parallel\./)
    assert.match(orchestrator.teamCalls[0].payload.prompt, /Focus on dashboard header and sidebar collisions\./)
  })
})
