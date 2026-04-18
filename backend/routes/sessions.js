const express = require('express')
const { DEFAULT_SESSION_ID } = require('../services/sessionStore')

const router = express.Router()

router.get('/', (req, res) => {
  const sessionStore = req.app.get('sessionStore')
  res.json({ sessions: sessionStore.getSessionSummaries() })
})

router.get('/:sessionId/settings', (req, res) => {
  const sessionStore = req.app.get('sessionStore')
  const sessionId = sessionStore.normalizeSessionId(req.params.sessionId)

  sessionStore.ensureSession(sessionId)

  const snapshot = sessionStore.getSessionSnapshot(sessionId)

  res.json({
    sessionId,
    settings: snapshot.settings,
  })
})

router.put('/:sessionId/settings', (req, res) => {
  const sessionStore = req.app.get('sessionStore')
  const sessionId = sessionStore.normalizeSessionId(req.params.sessionId)
  const { autoDispatch, compactMode, reviewMode } = req.body || {}

  if (reviewMode !== undefined && !['balanced', 'strict'].includes(reviewMode)) {
    return res.status(400).json({ error: 'reviewMode must be one of: balanced, strict' })
  }

  const settings = sessionStore.updateSessionSettings(sessionId, {
    autoDispatch,
    compactMode,
    reviewMode,
  })

  sessionStore.addLog(sessionId, {
    level: 'info',
    message: `Settings synced via mock backend (${settings.reviewMode})`,
    source: 'settings',
  })

  res.json({
    sessionId,
    settings,
  })
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
