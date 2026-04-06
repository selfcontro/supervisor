export type AgentStatus = 'idle' | 'working' | 'completed' | 'error'

export interface Agent {
  id: string
  name: string
  status: AgentStatus
  currentTask?: string
}

export interface Task {
  id: string
  description: string
  status: string
  logs: string[]
}
