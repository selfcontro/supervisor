const axios = require('axios')

// Task states
const TaskState = {
  PENDING: 'pending',
  PLANNING: 'planning',
  EXECUTING: 'executing',
  REVIEWING: 'reviewing',
  COMPLETED: 'completed',
  REJECTED: 'rejected'
}

// Agent states
const AgentState = {
  IDLE: 'idle',
  WORKING: 'working',
  COMPLETED: 'completed',
  ERROR: 'error'
}

class AgentManager {
  constructor(broadcast) {
    this.broadcast = broadcast
    this.agents = {
      planner: {
        id: 'planner',
        name: 'Planner',
        role: '任务规划分解',
        status: AgentState.IDLE,
        currentTask: null,
        taskHistory: [],
        logs: []
      },
      executor: {
        id: 'executor',
        name: 'Executor',
        role: '任务执行',
        status: AgentState.IDLE,
        currentTask: null,
        taskHistory: [],
        logs: []
      },
      reviewer: {
        id: 'reviewer',
        name: 'Reviewer',
        role: '结果审查',
        status: AgentState.IDLE,
        currentTask: null,
        taskHistory: [],
        logs: []
      }
    }

    // Task queue
    this.taskQueue = {
      pending: [],
      planning: [],
      executing: [],
      reviewing: [],
      completed: [],
      rejected: []
    }

    // Active tasks tracking
    this.activeTasks = new Map()
    this.retryCount = new Map()
    this.maxRetries = 3
    this.maxReviewLoops = 2
  }

  getAllAgents() {
    return Object.values(this.agents)
  }

  getAgent(id) {
    return this.agents[id] || null
  }

  getTasksByStatus(status) {
    return this.taskQueue[status] || []
  }

  // Log helper
  log(agentId, level, message, metadata = {}) {
    const logEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      level,
      message,
      metadata
    }

    if (this.agents[agentId]) {
      this.agents[agentId].logs.push(logEntry)
      // Keep only last 100 logs
      if (this.agents[agentId].logs.length > 100) {
        this.agents[agentId].logs = this.agents[agentId].logs.slice(-100)
      }
    }

    // Broadcast log entry
    this.broadcast({
      type: 'log_entry',
      payload: {
        logId: logEntry.id,
        data: {
          agentId,
          level,
          message,
          ...metadata
        }
      },
      timestamp: logEntry.timestamp
    })

    return logEntry
  }

  // Broadcast agent status
  broadcastAgentStatus(agentId) {
    const agent = this.agents[agentId]
    if (agent) {
      this.broadcast({
        type: 'agent_status',
        payload: {
          agentId,
          data: {
            status: agent.status,
            currentTask: agent.currentTask
          }
        },
        timestamp: new Date().toISOString()
      })
    }
  }

  // Broadcast task update
  broadcastTaskUpdate(taskId, data) {
    this.broadcast({
      type: 'task_update',
      payload: {
        taskId,
        data
      },
      timestamp: new Date().toISOString()
    })
  }

  // Process pending tasks (called periodically)
  processPendingTasks() {
    // Pick up pending tasks with planner
    const pendingTasks = this.taskQueue[TaskState.PENDING]
    while (pendingTasks.length > 0 && this.agents.planner.status === AgentState.IDLE) {
      const task = pendingTasks.shift()
      this.startPlanning(task)
    }
  }

  // Start planning phase
  startPlanning(task) {
    this.log(task.id, 'info', 'Planner 开始分解任务', { taskId: task.id })
    this.agents.planner.status = AgentState.WORKING
    this.agents.planner.currentTask = task.description
    task.status = TaskState.PLANNING
    task.agentId = 'planner'
    task.startedAt = new Date().toISOString()
    this.activeTasks.set(task.id, task)

    this.broadcastAgentStatus('planner')
    this.broadcastTaskUpdate(task.id, { status: task.status, agentId: 'planner' })

    // Simulate planning (decompose task into subtasks)
    setTimeout(() => {
      this.completePlanning(task)
    }, 1500)
  }

  // Complete planning phase
  completePlanning(task) {
    // Decompose into subtasks (simulated)
    task.subTasks = [
      { id: `${task.id}_st1`, description: `分析: ${task.description}`, status: 'pending' },
      { id: `${task.id}_st2`, description: `实现: ${task.description}`, status: 'pending' },
      { id: `${task.id}_st3`, description: `验证: ${task.description}`, status: 'pending' }
    ]

    this.log(task.id, 'info', `任务已分解为 ${task.subTasks.length} 个子任务`, { taskId: task.id })

    // Move to executing
    this.agents.planner.status = AgentState.IDLE
    this.agents.planner.currentTask = null
    this.broadcastAgentStatus('planner')

    this.startExecuting(task)
  }

  // Start execution phase
  startExecuting(task) {
    this.log(task.id, 'info', 'Executor 开始执行任务', { taskId: task.id })
    this.agents.executor.status = AgentState.WORKING
    this.agents.executor.currentTask = task.description
    task.status = TaskState.EXECUTING
    task.agentId = 'executor'

    this.broadcastAgentStatus('executor')
    this.broadcastTaskUpdate(task.id, { status: task.status, agentId: 'executor' })

    // Call Codex API (simulated)
    this.executeWithCodex(task)
  }

  // Execute with Codex API
  async executeWithCodex(task) {
    const retries = this.retryCount.get(task.id) || 0

    try {
      // In production, this would call the actual Codex/Cohere API
      // For demo, we simulate the API call
      const result = await this.simulateCodexCall(task)

      task.result = result
      task.executedAt = new Date().toISOString()
      this.log(task.id, 'info', 'Codex API 调用成功', { taskId: task.id })

      // Move to reviewing
      this.agents.executor.status = AgentState.IDLE
      this.agents.executor.currentTask = null
      this.broadcastAgentStatus('executor')

      this.startReviewing(task)

    } catch (error) {
      this.log(task.id, 'error', `Codex API 调用失败: ${error.message}`, { taskId: task.id })

      if (retries < this.maxRetries) {
        this.retryCount.set(task.id, retries + 1)
        this.log(task.id, 'warning', `重试 (${retries + 1}/${this.maxRetries})`, { taskId: task.id })

        // Exponential backoff retry
        setTimeout(() => {
          this.executeWithCodex(task)
        }, Math.pow(2, retries) * 1000)
      } else {
        this.log(task.id, 'error', '达到最大重试次数，任务失败', { taskId: task.id })
        this.failTask(task.id, error.message)
      }
    }
  }

  // Simulate Codex API call
  simulateCodexCall(task) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        // Simulate 10% failure rate
        if (Math.random() < 0.1) {
          reject(new Error('Codex API 超时'))
        } else {
          resolve(`已完成: ${task.description} [结果来自 Codex AI]`)
        }
      }, 2000)
    })
  }

  // Start reviewing phase
  startReviewing(task) {
    this.log(task.id, 'info', 'Reviewer 开始审查结果', { taskId: task.id })
    this.agents.reviewer.status = AgentState.WORKING
    this.agents.reviewer.currentTask = task.description
    task.status = TaskState.REVIEWING
    task.agentId = 'reviewer'
    task.reviewLoops = task.reviewLoops || 0

    this.broadcastAgentStatus('reviewer')
    this.broadcastTaskUpdate(task.id, { status: task.status, agentId: 'reviewer' })

    // Simulate review
    setTimeout(() => {
      this.completeReviewing(task)
    }, 1500)
  }

  // Complete reviewing phase
  completeReviewing(task) {
    this.agents.reviewer.status = AgentState.IDLE
    this.agents.reviewer.currentTask = null

    // Simulate review decision (90% pass rate)
    const passed = Math.random() < 0.9

    if (passed) {
      this.log(task.id, 'success', '审查通过，任务完成', { taskId: task.id })
      task.status = TaskState.COMPLETED
      task.completedAt = new Date().toISOString()
      this.taskQueue[TaskState.COMPLETED].push(task)
      this.activeTasks.delete(task.id)
    } else {
      task.reviewLoops++

      if (task.reviewLoops >= this.maxReviewLoops) {
        this.log(task.id, 'error', '审查失败次数过多，任务拒绝', { taskId: task.id })
        task.status = TaskState.REJECTED
        task.rejectedAt = new Date().toISOString()
        task.error = '审查失败次数过多'
        this.taskQueue[TaskState.REJECTED].push(task)
        this.activeTasks.delete(task.id)
      } else {
        this.log(task.id, 'warning', `审查未通过，退回执行 (${task.reviewLoops}/${this.maxReviewLoops})`, { taskId: task.id })
        // Send back to executor
        this.startExecuting(task)
      }
    }

    this.broadcastAgentStatus('reviewer')
    this.broadcastTaskUpdate(task.id, {
      status: task.status,
      completedAt: task.completedAt,
      rejectedAt: task.rejectedAt,
      result: task.result,
      error: task.error
    })
  }

  // Fail a task
  failTask(taskId, error) {
    const task = this.activeTasks.get(taskId)
    if (task) {
      task.status = TaskState.REJECTED
      task.error = error
      task.rejectedAt = new Date().toISOString()

      this.agents.planner.status = AgentState.IDLE
      this.agents.executor.status = AgentState.IDLE
      this.agents.reviewer.status = AgentState.IDLE
      this.agents.planner.currentTask = null
      this.agents.executor.currentTask = null
      this.agents.reviewer.currentTask = null

      this.taskQueue[TaskState.REJECTED].push(task)
      this.activeTasks.delete(taskId)

      this.broadcastAgentStatus('planner')
      this.broadcastAgentStatus('executor')
      this.broadcastAgentStatus('reviewer')
      this.broadcastTaskUpdate(taskId, { status: task.status, error })
    }
  }

  // Create a new task
  createTask(description) {
    const task = {
      id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      description,
      status: TaskState.PENDING,
      createdAt: new Date().toISOString(),
      logs: [],
      subTasks: [],
      result: null,
      reviewLoops: 0
    }

    this.taskQueue[TaskState.PENDING].push(task)
    this.activeTasks.set(task.id, task)

    this.log(task.id, 'info', '新任务已创建', { taskId: task.id })
    this.broadcast({
      type: 'task:new',
      task
    })

    // Start processing
    this.processPendingTasks()

    return task
  }

  // Get task by ID
  getTask(taskId) {
    for (const status of Object.values(TaskState)) {
      const task = this.taskQueue[status].find(t => t.id === taskId)
      if (task) return task
    }
    return this.activeTasks.get(taskId) || null
  }

  // Get all tasks
  getAllTasks() {
    const allTasks = []
    for (const status of Object.values(TaskState)) {
      allTasks.push(...this.taskQueue[status])
    }
    return allTasks
  }

  // Retry failed task
  retryTask(taskId) {
    const task = this.getTask(taskId)
    if (task && (task.status === TaskState.REJECTED || task.status === TaskState.COMPLETED)) {
      // Reset task
      task.status = TaskState.PENDING
      task.error = null
      task.reviewLoops = 0
      task.result = null

      // Move from completed/rejected back to pending
      this.taskQueue[TaskState.COMPLETED] = this.taskQueue[TaskState.COMPLETED].filter(t => t.id !== taskId)
      this.taskQueue[TaskState.REJECTED] = this.taskQueue[TaskState.REJECTED].filter(t => t.id !== taskId)
      this.taskQueue[TaskState.PENDING].push(task)

      this.log(taskId, 'info', '任务已重试', { taskId })
      this.broadcastTaskUpdate(taskId, { status: task.status })

      this.processPendingTasks()
      return true
    }
    return false
  }
}

module.exports = { AgentManager, TaskState, AgentState }
