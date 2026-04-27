const BACKEND_OVERRIDE_STORAGE_KEY = 'supervisor.backendOverride'
const LEGACY_LOCAL_BACKEND_URL = 'http://127.0.0.1:3101'
const DEFAULT_LOCAL_BACKEND_URL = 'http://127.0.0.1:3001'

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

  return DEFAULT_LOCAL_BACKEND_URL
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

  return 'ws://127.0.0.1:3001'
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

function shouldIgnoreBrowserOverride(override, env = process.env) {
  const normalizedOverride = normalizeOverrideValue(override)
  if (!normalizedOverride) {
    return true
  }

  if (normalizedOverride !== LEGACY_LOCAL_BACKEND_URL) {
    return false
  }

  const explicitEnvUrl = stripTrailingSlashes(env?.NEXT_PUBLIC_API_URL) || stripTrailingSlashes(env?.NEXT_PUBLIC_API_BASE)
  if (!explicitEnvUrl) {
    return true
  }

  return explicitEnvUrl !== LEGACY_LOCAL_BACKEND_URL
}

function deriveLocalBackendPort(env = process.env) {
  const configuredApiUrl = resolveApiUrl(env)
  try {
    const parsed = new URL(configuredApiUrl)
    if (parsed.port) {
      return parsed.port
    }
  } catch {
    // Fallback handled below.
  }

  try {
    const fallback = new URL(DEFAULT_LOCAL_BACKEND_URL)
    return fallback.port || '3001'
  } catch {
    return '3001'
  }
}

function deriveBrowserLocalApiUrl(browser = globalThis?.window, env = process.env) {
  const protocol = typeof browser?.location?.protocol === 'string' ? browser.location.protocol : 'http:'
  const hostname = typeof browser?.location?.hostname === 'string' ? browser.location.hostname : ''

  if (!/^(localhost|127\.0\.0\.1)$/i.test(hostname)) {
    return ''
  }

  const scheme = protocol === 'https:' ? 'https:' : 'http:'
  const port = deriveLocalBackendPort(env)
  return `${scheme}//${hostname}:${port}`
}

function deriveBrowserLocalWsUrl(browser = globalThis?.window, env = process.env) {
  const apiUrl = deriveBrowserLocalApiUrl(browser, env)
  if (!apiUrl) {
    return ''
  }

  return resolveWsUrl({
    NEXT_PUBLIC_API_URL: apiUrl,
  })
}

function resolveBrowserApiUrl(browser = globalThis?.window, env = process.env) {
  const derivedLocalUrl = deriveBrowserLocalApiUrl(browser, env)
  if (derivedLocalUrl) {
    return derivedLocalUrl
  }

  const override = readBrowserBackendOverride(browser)
  if (override && !shouldIgnoreBrowserOverride(override, env)) {
    return override
  }

  return resolveApiUrl(env)
}

function resolveBrowserWsUrl(browser = globalThis?.window, env = process.env) {
  const derivedLocalWsUrl = deriveBrowserLocalWsUrl(browser, env)
  if (derivedLocalWsUrl) {
    return derivedLocalWsUrl
  }

  const override = readBrowserBackendOverride(browser)
  if (override && !shouldIgnoreBrowserOverride(override, env)) {
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
