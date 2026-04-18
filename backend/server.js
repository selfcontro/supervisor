require('dotenv').config()
const express = require('express')
const http = require('http')
const cors = require('cors')
const { WebSocketServer } = require('ws')
const agentsRouter = require('./routes/agents')
const tasksRouter = require('./routes/tasks')
const sessionsRouter = require('./routes/sessions')
const codexRouter = require('./routes/codex')
const codexControlRouter = require('./routes/codexControl')
const layoutOverlapVerificationRouter = require('./routes/layoutOverlapVerification')
const { SessionStore, DEFAULT_SESSION_ID } = require('./services/sessionStore')
const { CodexRpcClient } = require('./services/codexRpcClient')
const { AgentRegistry } = require('./services/agentRegistry')
const { BlackboardStore } = require('./services/blackboardStore')
const { CodexOrchestrator } = require('./services/codexOrchestrator')
const { clearAllTaskTimeouts } = require('./routes/tasks')

function createServer(options = {}) {
  const {
    port = Number(process.env.PORT) || 3001,
    host = process.env.HOST || '0.0.0.0',
    startProcessing = true
  } = options

  const app = express()
  const server = http.createServer(app)
  const wss = new WebSocketServer({ server, path: '/ws' })
  const sessionStore = new SessionStore()
  const codexClient = new CodexRpcClient()
  const agentRegistry = new AgentRegistry()
  const blackboardStore = new BlackboardStore({
    rootDir: process.env.BLACKBOARD_ROOT_DIR
  })
  const codexOrchestrator = new CodexOrchestrator({
    client: codexClient,
    registry: agentRegistry,
    blackboard: blackboardStore,
    sessionStore,
    broadcast
  })
  const clients = new Map()
  const intervals = []

  app.use(cors())
  app.use(express.json())

  function broadcast(data) {
    const sessionId = sessionStore.normalizeSessionId(data.sessionId)
    const eventType = data.type
    const message = JSON.stringify({
      ...data,
      sessionId,
      timestamp: data.timestamp || new Date().toISOString()
    })

    let sentCount = 0
    clients.forEach((clientState, client) => {
      if (client.readyState !== 1) {
        return
      }

      if (clientState.sessionId !== sessionId) {
        return
      }

      if (Array.isArray(clientState.events) && clientState.events.length > 0 && !clientState.events.includes(eventType)) {
        return
      }

      client.send(message)
      sentCount++
    })

    return sentCount
  }

  function sendInitialSessionState(ws, sessionId) {
    const snapshot = sessionStore.getSessionSnapshot(sessionId)
    if (!snapshot) {
      return
    }

    snapshot.agents.forEach(agent => {
      ws.send(JSON.stringify({
        type: 'agent_status',
        sessionId: snapshot.session.id,
        payload: {
          agentId: agent.id,
          data: {
            status: agent.status,
            currentTask: agent.currentTask
          }
        },
        timestamp: new Date().toISOString()
      }))
    })
  }

  app.set('sessionStore', sessionStore)
  app.set('broadcast', broadcast)
  app.set('codexOrchestrator', codexOrchestrator)

  app.use('/api/agents', agentsRouter)
  app.use('/api/tasks', tasksRouter)
  app.use('/api/sessions', sessionsRouter)
  app.use('/api/codex', codexRouter)
  app.use('/api/codex-control', codexControlRouter)
  app.use('/api/layout-overlap-verification', layoutOverlapVerificationRouter)

  app.get('/health', (req, res) => {
    const apiKeyConfigured = Boolean(process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY)
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      sessions: sessionStore.getSessionIds().length,
      defaultSessionAgents: sessionStore.getAgents(DEFAULT_SESSION_ID).length,
      codexControl: codexOrchestrator.started ? 'ready' : 'starting',
      codexApiKeyConfigured: apiKeyConfigured,
      codexBin: process.env.CODEX_BIN || 'codex',
      uptime: process.uptime()
    })
  })

  sessionStore.subscribe(event => {
    broadcast(event)
  })

  wss.on('connection', (ws) => {
    clients.set(ws, { sessionId: DEFAULT_SESSION_ID, events: null })
    console.log('Client connected. Total:', clients.size)

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message)
        console.log('Received:', data.type)

        switch (data.type) {
          case 'subscribe': {
            const sessionId = sessionStore.normalizeSessionId(data.payload?.sessionId)
            const events = Array.isArray(data.payload?.events) ? data.payload.events : null
            clients.set(ws, { sessionId, events })
            ws.send(JSON.stringify({
              type: 'subscribed',
              payload: {
                events: events || [],
                sessionId
              },
              sessionId,
              timestamp: new Date().toISOString()
            }))
            sendInitialSessionState(ws, sessionId)
            break
          }

          case 'unsubscribe':
            clients.set(ws, { sessionId: DEFAULT_SESSION_ID, events: null })
            ws.send(JSON.stringify({
              type: 'unsubscribed',
              payload: {
                events: data.payload?.events || [],
                sessionId: DEFAULT_SESSION_ID
              },
              sessionId: DEFAULT_SESSION_ID,
              timestamp: new Date().toISOString()
            }))
            break

          case 'ping':
            ws.send(JSON.stringify({ type: 'pong' }))
            break

          case 'task_create': {
            if (data.payload?.description) {
              const sessionId = sessionStore.normalizeSessionId(data.payload?.sessionId || clients.get(ws)?.sessionId)
              sessionStore.createTask({
                sessionId,
                description: data.payload.description,
                priority: data.payload.priority || 'normal'
              })
            }
            break
          }

          case 'task_retry': {
            if (data.payload?.taskId) {
              const sessionId = sessionStore.normalizeSessionId(data.payload?.sessionId || clients.get(ws)?.sessionId)
              const success = sessionStore.getAgentManager(sessionId).retryTask(data.payload.taskId)
              ws.send(JSON.stringify({
                type: success ? 'task_retry_success' : 'task_retry_failed',
                payload: { taskId: data.payload.taskId },
                sessionId,
                timestamp: new Date().toISOString()
              }))
            }
            break
          }

          default:
            console.log('Unknown message type:', data.type)
        }
      } catch (err) {
        console.error('Invalid message:', err)
        ws.send(JSON.stringify({
          type: 'error',
          payload: {
            code: 'INVALID_MESSAGE',
            message: 'Invalid message format'
          },
          timestamp: new Date().toISOString()
        }))
      }
    })

    ws.on('close', () => {
      clients.delete(ws)
      console.log('Client disconnected. Total:', clients.size)
    })

    ws.on('error', (error) => {
      console.error('WebSocket error:', error)
      clients.delete(ws)
    })
  })

  if (startProcessing) {
    intervals.push(setInterval(() => {
      sessionStore.getSessionIds().forEach(sessionId => {
        sessionStore.getAgentManager(sessionId).processPendingTasks()
      })
    }, 5000))

    intervals.push(setInterval(() => {
      // In-memory runtime only.
    }, 60000))
  }

  async function start() {
    try {
      await codexOrchestrator.start()
    } catch (error) {
      console.error('Codex orchestrator failed to start:', error.message)
    }

    try {
      await hydrateSessionStoreFromBlackboard({ sessionStore, blackboardStore })
    } catch (error) {
      console.error('Session hydration from blackboard failed:', error.message)
    }

    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, host, () => {
        server.off('error', reject)
        resolve()
      })
    })

    const address = server.address()
    const resolvedPort = typeof address === 'object' && address ? address.port : port
    console.log(`Server running on port ${resolvedPort}`)
    console.log(`WebSocket available at ws://${host}:${resolvedPort}/ws`)
    console.log(`Session runtime initialized with ${sessionStore.getSessionIds().length} session(s)`)    
  }

  async function stop() {
    intervals.forEach(clearInterval)
    clearAllTaskTimeouts()
    clients.forEach((_, client) => client.close())
    await codexOrchestrator.stop()
    await new Promise((resolve, reject) => {
      server.close(error => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
  }

  return {
    app,
    server,
    wss,
    sessionStore,
    codexOrchestrator,
    start,
    stop,
    broadcast
  }
}

module.exports = { createServer }

if (require.main === module) {
  const runtime = createServer()
  runtime.start().catch(error => {
    console.error('Failed to start server:', error)
    process.exit(1)
  })
}

async function hydrateSessionStoreFromBlackboard({ sessionStore, blackboardStore }) {
  const sessionIds = await blackboardStore.listSessionIds()

  for (const sessionId of sessionIds) {
    const events = await blackboardStore.getSessionEvents(sessionId)
    if (events.length === 0) {
      continue
    }

    const sortedEvents = [...events].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())

    for (const event of sortedEvents) {
      sessionStore.ensureSession(sessionId)

      if (event.task?.taskId) {
        sessionStore.syncTask({
          id: event.task.taskId,
          sessionId,
          description: event.task.title || event.task.taskId,
          status: mapBlackboardTaskStatus(event.task.status),
          createdAt: event.ts,
          updatedAt: event.ts,
          agentId: event.agentId || null,
          result: event.type === 'task_done' ? event.payload?.result || null : null,
          error: event.type === 'task_failed' ? event.payload?.error || null : null,
          priority: event.task.priority || 'normal'
        })
      }

      if (event.agentId && isPersistentSessionAgent(event.agentId)) {
        sessionStore.syncAgent(sessionId, {
          id: event.agentId,
          name: event.agentId,
          role: 'Codex controlled agent',
          status: mapBlackboardAgentStatus(event),
          currentTask: event.task?.title || null
        })
      }
    }
  }
}

function mapBlackboardTaskStatus(status) {
  if (typeof status !== 'string') {
    return 'pending'
  }

  if (status === 'assigned') {
    return 'pending'
  }

  return status
}

function mapBlackboardAgentStatus(event) {
  if (event.type === 'task_done') {
    return 'completed'
  }

  if (event.type === 'task_failed') {
    return 'error'
  }

  if (event.type === 'task_progress' || event.type === 'task_assigned') {
    return 'working'
  }

  if (event.type === 'agent_state') {
    const state = event.payload?.state
    if (state === 'ready') {
      return 'idle'
    }
    if (state === 'error') {
      return 'error'
    }
    if (state === 'completed' || state === 'done') {
      return 'completed'
    }
  }

  return 'idle'
}

function isPersistentSessionAgent(agentId) {
  if (typeof agentId !== 'string' || !agentId.trim()) {
    return false
  }

  if (agentId.includes('::')) {
    return false
  }

  return !['planner', 'executor', 'subagent', 'reviewer'].includes(agentId)
}
