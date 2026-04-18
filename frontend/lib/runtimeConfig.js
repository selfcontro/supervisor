const BACKEND_OVERRIDE_STORAGE_KEY = 'supervisor.backendOverride'

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

function normalizeOverrideValue(value) {
  if (typeof value !== 'string') {
    return ''
  }

  const trimmed = stripTrailingSlashes(value)
  if (!trimmed) {
    return ''
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed
  }

  return `http://${trimmed}`
}

function readBrowserBackendOverride(browser = globalThis?.window) {
  try {
    const storedValue = browser?.localStorage?.getItem(BACKEND_OVERRIDE_STORAGE_KEY)
    return normalizeOverrideValue(storedValue)
  } catch {
    return ''
  }
}

function saveBrowserBackendOverride(browser = globalThis?.window, value) {
  const normalizedValue = normalizeOverrideValue(value)
  if (!normalizedValue) {
    clearBrowserBackendOverride(browser)
    return ''
  }

  browser?.localStorage?.setItem(BACKEND_OVERRIDE_STORAGE_KEY, normalizedValue)
  return normalizedValue
}

function clearBrowserBackendOverride(browser = globalThis?.window) {
  browser?.localStorage?.removeItem(BACKEND_OVERRIDE_STORAGE_KEY)
}

function resolveBrowserApiUrl(browser = globalThis?.window, env = process.env) {
  const override = readBrowserBackendOverride(browser)
  if (override) {
    return override
  }

  return resolveApiUrl(env)
}

function resolveBrowserWsUrl(browser = globalThis?.window, env = process.env) {
  const override = readBrowserBackendOverride(browser)
  if (override) {
    return resolveWsUrl({
      NEXT_PUBLIC_API_URL: override,
    })
  }

  return resolveWsUrl(env)
}

function isLocalBackendUrl(value) {
  return (
    typeof value === 'string' &&
    /^(https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?$/i.test(value.trim())
  )
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

function classifyWorkspaceLoadFailure(error, env = process.env) {
  if (Number(error?.status) === 404) {
    return classifySessionSnapshotFailure(error)
  }

  const message = typeof error?.message === 'string' ? error.message : ''
  const apiUrl = resolveApiUrl(env)

  if (
    ['Failed to fetch', 'NetworkError when attempting to fetch resource.'].includes(message) &&
    isLocalBackendUrl(apiUrl)
  ) {
    return 'local_backend_unreachable'
  }

  return 'other'
}

module.exports = {
  BACKEND_OVERRIDE_STORAGE_KEY,
  clearBrowserBackendOverride,
  classifySessionSnapshotFailure,
  classifyWorkspaceLoadFailure,
  readBrowserBackendOverride,
  resolveApiUrl,
  resolveBrowserApiUrl,
  resolveBrowserWsUrl,
  resolveWsUrl,
  saveBrowserBackendOverride,
}
