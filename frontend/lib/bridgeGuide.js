function normalizeEndpoint(value) {
  if (typeof value !== 'string') {
    return 'http://127.0.0.1:3001'
  }

  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed) {
    return 'http://127.0.0.1:3001'
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed
  }

  return `http://${trimmed}`
}

function toWsUrl(endpoint) {
  if (endpoint.startsWith('https://')) {
    return `wss://${endpoint.slice('https://'.length)}/ws`
  }

  if (endpoint.startsWith('http://')) {
    return `ws://${endpoint.slice('http://'.length)}/ws`
  }

  return `${endpoint}/ws`
}

function buildBridgeGuide(input) {
  const endpoint = normalizeEndpoint(input)

  return {
    endpoint,
    healthUrl: `${endpoint}/health`,
    sessionUrl: `${endpoint}/api/sessions/default`,
    wsUrl: toWsUrl(endpoint),
    startCommand: ['cd backend', 'npm run bridge'].join('\n'),
    verifyCommand: `curl ${endpoint}/health`,
  }
}

module.exports = {
  buildBridgeGuide,
}
