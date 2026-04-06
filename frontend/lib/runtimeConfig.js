function stripTrailingSlashes(value) {
  if (typeof value !== 'string') {
    return ''
  }

  return value.trim().replace(/\/+$/, '')
}

function resolveApiUrl(env = process.env) {
  const explicitUrl = stripTrailingSlashes(env?.NEXT_PUBLIC_API_URL)
  if (explicitUrl) {
    return explicitUrl
  }

  const legacyUrl = stripTrailingSlashes(env?.NEXT_PUBLIC_API_BASE)
  if (legacyUrl) {
    return legacyUrl
  }

  return 'http://localhost:3001'
}

function resolveWsUrl(env = process.env) {
  const explicitUrl = stripTrailingSlashes(env?.NEXT_PUBLIC_WS_URL)
  if (explicitUrl) {
    return explicitUrl
  }

  const apiUrl = resolveApiUrl(env)
  if (apiUrl.startsWith('https://')) {
    return `wss://${apiUrl.slice('https://'.length)}`
  }

  if (apiUrl.startsWith('http://')) {
    return `ws://${apiUrl.slice('http://'.length)}`
  }

  if (apiUrl.startsWith('wss://') || apiUrl.startsWith('ws://')) {
    return apiUrl
  }

  return 'ws://localhost:3001'
}

function classifySessionSnapshotFailure(error) {
  if (Number(error?.status) !== 404) {
    return 'other'
  }

  if (error?.message === 'Session not found') {
    return 'not_found'
  }

  return 'backend_mismatch'
}

module.exports = {
  classifySessionSnapshotFailure,
  resolveApiUrl,
  resolveWsUrl,
}
