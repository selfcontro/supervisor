export const statusColors = {
  idle: '#22c55e',
  working: '#2563eb',
  completed: '#3b82f6',
  error: '#ef4444',
} as const

export const statusLabels = {
  idle: 'Idle',
  working: 'Working',
  completed: 'Completed',
  error: 'Error',
} as const

export const agentRoleLabels = {
  planner: 'Planning and task breakdown',
  executor: 'Execution and delivery',
  reviewer: 'Review and validation',
} as const

function normalizeConfiguredUrl(value: string) {
  return value.replace(/\/+$/, '')
}

const configuredApiUrl =
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_API_BASE ||
  'http://localhost:3001'

const derivedWsUrl = configuredApiUrl.startsWith('https://')
  ? `wss://${configuredApiUrl.slice('https://'.length)}`
  : configuredApiUrl.startsWith('http://')
    ? `ws://${configuredApiUrl.slice('http://'.length)}`
    : configuredApiUrl

const configuredWsUrl = process.env.NEXT_PUBLIC_WS_URL || derivedWsUrl || 'ws://localhost:3001'

export const apiUrl = normalizeConfiguredUrl(configuredApiUrl)
export const wsUrl = normalizeConfiguredUrl(configuredWsUrl)
