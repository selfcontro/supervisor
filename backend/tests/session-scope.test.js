const test = require('node:test')
const assert = require('node:assert/strict')
const { once } = require('node:events')
const { WebSocket } = require('ws')

const { createServer } = require('../server')

function waitForOpen(ws) {
  return once(ws, 'open')
}

function waitForMessage(ws, predicate, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      cleanup()
      reject(new Error('Timed out waiting for message'))
    }, timeoutMs)

    function cleanup() {
      clearTimeout(timeoutId)
      ws.off('message', onMessage)
      ws.off('error', onError)
    }

    function onError(error) {
      cleanup()
      reject(error)
    }

    function onMessage(raw) {
      const parsed = JSON.parse(raw.toString())
      if (!predicate || predicate(parsed)) {
        cleanup()
        resolve(parsed)
      }
    }

    ws.on('message', onMessage)
    ws.on('error', onError)
  })
}

test('sessions REST and WebSocket traffic are scoped by sessionId', async (t) => {
  const runtime = createServer({ port: 0, host: '127.0.0.1', startProcessing: false })
  const sockets = []
  t.after(async () => {
    await Promise.all(sockets.map(ws => new Promise(resolve => {
      if (ws.readyState === ws.CLOSED) {
        resolve()
        return
      }

      ws.once('close', resolve)
      ws.close()
    })))
    await runtime.stop().catch(() => {})
  })
  await runtime.start()

  const address = runtime.server.address()
  const baseUrl = `http://127.0.0.1:${address.port}`
  const wsUrl = `ws://127.0.0.1:${address.port}/ws`

  await t.test('REST returns isolated snapshots', async () => {
    const createAlpha = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'alpha task', sessionId: 'alpha' })
    })
    assert.equal(createAlpha.status, 201)
    const alphaTask = await createAlpha.json()
    assert.equal(alphaTask.sessionId, 'alpha')

    const createBeta = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'beta task', sessionId: 'beta' })
    })
    assert.equal(createBeta.status, 201)

    const sessionsRes = await fetch(`${baseUrl}/api/sessions`)
    assert.equal(sessionsRes.status, 200)
    const sessionsBody = await sessionsRes.json()
    assert.deepEqual(
      sessionsBody.sessions.map(session => session.id).sort(),
      ['alpha', 'beta']
    )

    const alphaSnapshotRes = await fetch(`${baseUrl}/api/sessions/alpha`)
    assert.equal(alphaSnapshotRes.status, 200)
    const alphaSnapshot = await alphaSnapshotRes.json()
    assert.equal(alphaSnapshot.session.id, 'alpha')
    assert.equal(alphaSnapshot.tasks.length, 1)
    assert.equal(alphaSnapshot.tasks[0].description, 'alpha task')
    assert.ok(Array.isArray(alphaSnapshot.agents))
    assert.ok(Array.isArray(alphaSnapshot.logs))

    const betaTasksRes = await fetch(`${baseUrl}/api/tasks?sessionId=beta`)
    assert.equal(betaTasksRes.status, 200)
    const betaTasks = await betaTasksRes.json()
    assert.equal(betaTasks.tasks.length, 1)
    assert.equal(betaTasks.tasks[0].description, 'beta task')

    const missingSessionRes = await fetch(`${baseUrl}/api/sessions/missing-session`)
    assert.equal(missingSessionRes.status, 404)

    const wrongSessionGet = await fetch(`${baseUrl}/api/tasks/${alphaTask.id}?sessionId=beta`)
    assert.equal(wrongSessionGet.status, 404)

    const wrongSessionPut = await fetch(`${baseUrl}/api/tasks/${alphaTask.id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'beta', status: 'planning' })
    })
    assert.equal(wrongSessionPut.status, 404)

    const wrongSessionDelete = await fetch(`${baseUrl}/api/tasks/${alphaTask.id}?sessionId=beta`, {
      method: 'DELETE'
    })
    assert.equal(wrongSessionDelete.status, 404)

    const missingAgentRes = await fetch(`${baseUrl}/api/agents/planner?sessionId=missing-agents-session`)
    assert.equal(missingAgentRes.status, 404)

    const sessionsAfterMissingAgent = await fetch(`${baseUrl}/api/sessions`)
    const sessionsAfterMissingAgentBody = await sessionsAfterMissingAgent.json()
    assert.deepEqual(
      sessionsAfterMissingAgentBody.sessions.map(session => session.id).sort(),
      ['alpha', 'beta']
    )

    const invalidTaskRes = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: { text: 'bad' }, sessionId: 'alpha' })
    })
    assert.equal(invalidTaskRes.status, 400)
  })

  await t.test('WebSocket subscription only receives matching session events', async () => {
    const alphaClient = new WebSocket(wsUrl)
    const betaClient = new WebSocket(wsUrl)
    sockets.push(alphaClient, betaClient)

    await Promise.all([waitForOpen(alphaClient), waitForOpen(betaClient)])

    const alphaSubscribed = waitForMessage(alphaClient, message => message.type === 'subscribed')
    const betaSubscribed = waitForMessage(betaClient, message => message.type === 'subscribed')
    alphaClient.send(JSON.stringify({ type: 'subscribe', payload: { sessionId: 'alpha', events: ['task:new'] } }))
    betaClient.send(JSON.stringify({ type: 'subscribe', payload: { sessionId: 'beta', events: ['task:new'] } }))
    await Promise.all([alphaSubscribed, betaSubscribed])

    const alphaTaskEvent = waitForMessage(alphaClient, message => message.type === 'task:new' && message.sessionId === 'alpha')
    let betaUnexpected = false
    betaClient.once('message', (raw) => {
      const message = JSON.parse(raw.toString())
      if (message.type === 'task:new') betaUnexpected = true
    })

    const createGamma = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'another alpha task', sessionId: 'alpha' })
    })
    assert.equal(createGamma.status, 201)

    const event = await alphaTaskEvent
    assert.equal(event.task.description, 'another alpha task')

    await new Promise(resolve => setTimeout(resolve, 200))
    assert.equal(betaUnexpected, false)
  })
})
