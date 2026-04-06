const express = require('express')
const { DEFAULT_SESSION_ID } = require('../services/sessionStore')

const router = express.Router()

router.get('/', (req, res) => {
  const sessionStore = req.app.get('sessionStore')
  res.json({ sessions: sessionStore.getSessionSummaries() })
})

router.get('/:sessionId', (req, res) => {
  const sessionStore = req.app.get('sessionStore')
  const sessionId = sessionStore.normalizeSessionId(req.params.sessionId)

  if (sessionId === DEFAULT_SESSION_ID) {
    sessionStore.ensureSession(DEFAULT_SESSION_ID)
  }

  const snapshot = sessionStore.getSessionSnapshot(sessionId)

  if (!snapshot) {
    return res.status(404).json({ error: 'Session not found' })
  }

  res.json(snapshot)
})

module.exports = router
