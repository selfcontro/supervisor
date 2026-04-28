const test = require('node:test')
const assert = require('node:assert/strict')

const {
  BACKEND_OVERRIDE_STORAGE_KEY,
  clearBrowserBackendOverride,
  resolveApiUrl,
  resolveBrowserApiUrl,
  resolveBrowserWsUrl,
  resolveWsUrl,
  saveBrowserBackendOverride,
  classifySessionSnapshotFailure,
  classifyWorkspaceLoadFailure,
} = require('./runtimeConfig')

test('resolveApiUrl prefers NEXT_PUBLIC_API_URL when provided', () => {
  const apiUrl = resolveApiUrl({
    NEXT_PUBLIC_API_URL: 'http://127.0.0.1:4001/',
    NEXT_PUBLIC_API_BASE: 'http://127.0.0.1:3101/',
  })

  assert.equal(apiUrl, 'http://127.0.0.1:4001')
})

test('resolveApiUrl falls back to NEXT_PUBLIC_API_BASE for backward compatibility', () => {
  const apiUrl = resolveApiUrl({
    NEXT_PUBLIC_API_BASE: 'http://127.0.0.1:3101/',
  })

  assert.equal(apiUrl, 'http://127.0.0.1:3101')
})

test('resolveWsUrl derives from api url when explicit websocket url is missing', () => {
  const wsUrl = resolveWsUrl({
    NEXT_PUBLIC_API_BASE: 'https://example.com/internal-api/',
  })

  assert.equal(wsUrl, 'wss://example.com/internal-api')
})

test('classifySessionSnapshotFailure marks explicit session misses as not_found', () => {
  const kind = classifySessionSnapshotFailure({
    status: 404,
    message: 'Session not found',
  })

  assert.equal(kind, 'not_found')
})

test('classifySessionSnapshotFailure marks generic 404 responses as backend_mismatch', () => {
  const kind = classifySessionSnapshotFailure({
    status: 404,
    message: 'Cannot GET /api/sessions/default',
  })

  assert.equal(kind, 'backend_mismatch')
})

test('classifyWorkspaceLoadFailure marks failed fetches against localhost as local_backend_unreachable', () => {
  const kind = classifyWorkspaceLoadFailure(
    {
      message: 'Failed to fetch',
    },
    {
      NEXT_PUBLIC_API_URL: 'http://127.0.0.1:3001',
    }
  )

  assert.equal(kind, 'local_backend_unreachable')
})

test('classifyWorkspaceLoadFailure keeps non-local failed fetches as other', () => {
  const kind = classifyWorkspaceLoadFailure(
    {
      message: 'Failed to fetch',
    },
    {
      NEXT_PUBLIC_API_URL: 'https://api.example.com',
    }
  )

  assert.equal(kind, 'other')
})

test('resolveBrowserApiUrl prefers saved browser override over env defaults', () => {
  const localStorage = createStorage()
  saveBrowserBackendOverride(
    {
      localStorage,
      location: {
        protocol: 'https:',
        hostname: 'supervisor-eta.vercel.app',
        port: '',
      },
    },
    'http://127.0.0.1:4312/'
  )

  const apiUrl = resolveBrowserApiUrl(
    {
      localStorage,
      location: {
        protocol: 'https:',
        hostname: 'supervisor-eta.vercel.app',
        port: '',
      },
    },
    {
      NEXT_PUBLIC_API_URL: 'https://api.example.com',
    }
  )

  assert.equal(apiUrl, 'http://127.0.0.1:4312')
})

test('resolveBrowserWsUrl derives websocket url from saved browser override', () => {
  const localStorage = createStorage()
  saveBrowserBackendOverride(
    {
      localStorage,
      location: {
        protocol: 'https:',
        hostname: 'supervisor-eta.vercel.app',
        port: '',
      },
    },
    'http://127.0.0.1:4312/'
  )

  const wsUrl = resolveBrowserWsUrl(
    {
      localStorage,
      location: {
        protocol: 'https:',
        hostname: 'supervisor-eta.vercel.app',
        port: '',
      },
    },
    {
      NEXT_PUBLIC_WS_URL: 'wss://api.example.com',
    }
  )

  assert.equal(wsUrl, 'ws://127.0.0.1:4312')
})

test('resolveBrowserApiUrl ignores legacy 3101 override when env explicitly points elsewhere', () => {
  const localStorage = createStorage()
  saveBrowserBackendOverride(
    {
      localStorage,
      location: {
        protocol: 'https:',
        hostname: 'supervisor-eta.vercel.app',
        port: '',
      },
    },
    'http://127.0.0.1:3101/'
  )

  const apiUrl = resolveBrowserApiUrl(
    {
      localStorage,
      location: {
        protocol: 'https:',
        hostname: 'supervisor-eta.vercel.app',
        port: '',
      },
    },
    {
      NEXT_PUBLIC_API_URL: 'http://127.0.0.1:3001',
    }
  )

  assert.equal(apiUrl, 'http://127.0.0.1:3001')
})

test('resolveBrowserWsUrl ignores legacy 3101 override when env explicitly points elsewhere', () => {
  const localStorage = createStorage()
  saveBrowserBackendOverride(
    {
      localStorage,
      location: {
        protocol: 'https:',
        hostname: 'supervisor-eta.vercel.app',
        port: '',
      },
    },
    'http://127.0.0.1:3101/'
  )

  const wsUrl = resolveBrowserWsUrl(
    {
      localStorage,
      location: {
        protocol: 'https:',
        hostname: 'supervisor-eta.vercel.app',
        port: '',
      },
    },
    {
      NEXT_PUBLIC_API_URL: 'http://127.0.0.1:3001',
      NEXT_PUBLIC_WS_URL: 'ws://127.0.0.1:3001',
    }
  )

  assert.equal(wsUrl, 'ws://127.0.0.1:3001')
})

test('resolveBrowserApiUrl falls back to derived local backend when legacy 3101 override is stale', () => {
  const localStorage = createStorage()
  saveBrowserBackendOverride(
    {
      localStorage,
      location: {
        protocol: 'http:',
        hostname: '127.0.0.1',
        port: '3000',
      },
    },
    'http://127.0.0.1:3101/'
  )

  const apiUrl = resolveBrowserApiUrl(
    {
      localStorage,
      location: {
        protocol: 'http:',
        hostname: '127.0.0.1',
        port: '3000',
      },
    },
    {}
  )

  assert.equal(apiUrl, 'http://127.0.0.1:3001')
})

test('resolveBrowserWsUrl falls back to derived local backend websocket when legacy 3101 override is stale', () => {
  const localStorage = createStorage()
  saveBrowserBackendOverride(
    {
      localStorage,
      location: {
        protocol: 'http:',
        hostname: '127.0.0.1',
        port: '3000',
      },
    },
    'http://127.0.0.1:3101/'
  )

  const wsUrl = resolveBrowserWsUrl(
    {
      localStorage,
      location: {
        protocol: 'http:',
        hostname: '127.0.0.1',
        port: '3000',
      },
    },
    {}
  )

  assert.equal(wsUrl, 'ws://127.0.0.1:3001')
})

test('resolveBrowserApiUrl always prefers local backend on localhost pages regardless of saved override', () => {
  const localStorage = createStorage()
  saveBrowserBackendOverride(
    {
      localStorage,
      location: {
        protocol: 'http:',
        hostname: '127.0.0.1',
        port: '3010',
      },
    },
    'https://stale.example.com'
  )

  const apiUrl = resolveBrowserApiUrl(
    {
      localStorage,
      location: {
        protocol: 'http:',
        hostname: '127.0.0.1',
        port: '3010',
      },
    },
    {
      NEXT_PUBLIC_API_URL: 'https://api.example.com',
    }
  )

  assert.equal(apiUrl, 'http://127.0.0.1:3001')
})

test('resolveBrowserWsUrl always prefers local websocket on localhost pages regardless of saved override', () => {
  const localStorage = createStorage()
  saveBrowserBackendOverride(
    {
      localStorage,
      location: {
        protocol: 'http:',
        hostname: 'localhost',
        port: '3000',
      },
    },
    'https://stale.example.com'
  )

  const wsUrl = resolveBrowserWsUrl(
    {
      localStorage,
      location: {
        protocol: 'http:',
        hostname: 'localhost',
        port: '3000',
      },
    },
    {
      NEXT_PUBLIC_WS_URL: 'wss://api.example.com',
    }
  )

  assert.equal(wsUrl, 'ws://localhost:3001')
})

test('resolveBrowserApiUrl uses env local port when page is localhost', () => {
  const apiUrl = resolveBrowserApiUrl(
    {
      location: {
        protocol: 'http:',
        hostname: '127.0.0.1',
        port: '3000',
      },
      localStorage: createStorage(),
    },
    {
      NEXT_PUBLIC_API_URL: 'http://127.0.0.1:3101',
    }
  )

  assert.equal(apiUrl, 'http://127.0.0.1:3101')
})

test('resolveBrowserWsUrl uses env local port when page is localhost', () => {
  const wsUrl = resolveBrowserWsUrl(
    {
      location: {
        protocol: 'http:',
        hostname: 'localhost',
        port: '3000',
      },
      localStorage: createStorage(),
    },
    {
      NEXT_PUBLIC_API_URL: 'http://127.0.0.1:3101',
    }
  )

  assert.equal(wsUrl, 'ws://localhost:3101')
})

test('clearBrowserBackendOverride removes persisted override', () => {
  const localStorage = createStorage()
  saveBrowserBackendOverride(
    {
      localStorage,
    },
    'http://127.0.0.1:4312'
  )

  clearBrowserBackendOverride({
    localStorage,
  })

  assert.equal(localStorage.getItem(BACKEND_OVERRIDE_STORAGE_KEY), null)
})

function createStorage() {
  const values = new Map()

  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null
    },
    setItem(key, value) {
      values.set(key, String(value))
    },
    removeItem(key) {
      values.delete(key)
    },
  }
}
