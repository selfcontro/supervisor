const express = require('express')
const router = express.Router()
const axios = require('axios')

const CODEX_API_URL = 'https://api.cohere.ai/v1/chat' // Cohere API (Codex uses similar)

const CODEX_API_KEY = process.env.CODEX_API_KEY || process.env.COHERE_API_KEY

// POST /api/codex/chat - Proxy chat requests to Codex
router.post('/chat', async (req, res) => {
  const { messages } = req.body

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Messages array is required' })
  }

  if (!CODEX_API_KEY) {
    return res.status(500).json({
      error: 'Codex API key not configured',
      reply: '后端未配置 Codex API Key，请在 .env 文件中设置 CODEX_API_KEY'
    })
  }

  try {
    const response = await axios.post(
      CODEX_API_URL,
      {
        model: 'command',
        messages,
        max_tokens: 1000
      },
      {
        headers: {
          'Authorization': `Bearer ${CODEX_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    )

    res.json({ reply: response.data.text || response.data.message })
  } catch (err) {
    console.error('Codex API error:', err.message)
    res.status(500).json({
      error: 'Codex API request failed',
      reply: `Codex 服务调用失败: ${err.message}`
    })
  }
})

// POST /api/codex/completion - Proxy completion requests
router.post('/completion', async (req, res) => {
  const { prompt, max_tokens = 100 } = req.body

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' })
  }

  if (!CODEX_API_KEY) {
    return res.status(500).json({ error: 'Codex API key not configured' })
  }

  try {
    const response = await axios.post(
      'https://api.cohere.ai/v1/generate',
      {
        model: 'command',
        prompt,
        max_tokens
      },
      {
        headers: {
          'Authorization': `Bearer ${CODEX_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    )

    res.json({ completion: response.data.generations?.[0]?.text || '' })
  } catch (err) {
    console.error('Codex completion error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
