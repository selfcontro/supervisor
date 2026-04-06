const { spawn } = require('node:child_process')
const readline = require('node:readline')
const { EventEmitter } = require('node:events')

class CodexRpcClient extends EventEmitter {
  constructor(options = {}) {
    super()
    this.bin = options.bin || process.env.CODEX_BIN || 'codex'
    this.args = Array.isArray(options.args) ? options.args : ['app-server']
    this.cwd = options.cwd || process.env.CODEX_CWD || process.cwd()
    this.env = {
      ...process.env,
      ...(options.env || {})
    }
    this.clientInfo = options.clientInfo || {
      name: 'supervisor_backend',
      title: 'Supervisor Backend',
      version: '0.1.0'
    }
    this.experimentalApi = Boolean(options.experimentalApi)

    this.proc = null
    this.rl = null
    this.nextId = 1
    this.pending = new Map()
    this.initialized = false
    this.started = false
    this.closed = false
  }

  async start() {
    if (this.started) {
      return
    }

    this.proc = spawn(this.bin, this.args, {
      cwd: this.cwd,
      env: this.env,
      stdio: ['pipe', 'pipe', 'pipe']
    })

    this.rl = readline.createInterface({ input: this.proc.stdout })
    this.rl.on('line', line => this.handleLine(line))

    this.proc.stderr?.on('data', chunk => {
      this.emit('stderr', String(chunk))
    })

    this.proc.on('error', error => {
      this.rejectAllPending(error)
      this.emit('error', error)
    })

    this.proc.on('close', (code, signal) => {
      this.closed = true
      const error = new Error(`codex app-server closed (code=${code}, signal=${signal || 'none'})`)
      this.rejectAllPending(error)
      this.emit('close', { code, signal })
    })

    this.started = true
    await this.initialize()
  }

  async stop() {
    if (!this.started) {
      return
    }

    this.closed = true
    if (this.rl) {
      this.rl.close()
      this.rl = null
    }

    if (this.proc && !this.proc.killed) {
      this.proc.kill('SIGTERM')
    }

    this.proc = null
    this.started = false
    this.initialized = false
  }

  async initialize() {
    const result = await this.request('initialize', {
      clientInfo: this.clientInfo,
      capabilities: {
        experimentalApi: this.experimentalApi
      }
    })

    this.notify('initialized', {})
    this.initialized = true
    return result
  }

  request(method, params = {}) {
    if (!this.proc || this.closed) {
      return Promise.reject(new Error('Codex RPC client is not running'))
    }

    const id = this.nextId++
    const payload = { method, id, params }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Codex RPC timeout: ${method}`))
      }, 120000)

      this.pending.set(id, { resolve, reject, timeoutId, method })
      this.proc.stdin.write(`${JSON.stringify(payload)}\n`)
    })
  }

  notify(method, params = {}) {
    if (!this.proc || this.closed) {
      throw new Error('Codex RPC client is not running')
    }

    this.proc.stdin.write(`${JSON.stringify({ method, params })}\n`)
  }

  respond(requestId, result) {
    if (!this.proc || this.closed) {
      throw new Error('Codex RPC client is not running')
    }

    this.proc.stdin.write(`${JSON.stringify({ id: requestId, result })}\n`)
  }

  async startThread(params = {}) {
    return this.request('thread/start', params)
  }

  async resumeThread(params = {}) {
    return this.request('thread/resume', params)
  }

  async unsubscribeThread(params = {}) {
    return this.request('thread/unsubscribe', params)
  }

  async startTurn(params = {}) {
    return this.request('turn/start', params)
  }

  async interruptTurn(params = {}) {
    return this.request('turn/interrupt', params)
  }

  async listModels(params = {}) {
    return this.request('model/list', params)
  }

  handleLine(line) {
    if (!line || !line.trim()) {
      return
    }

    let message
    try {
      message = JSON.parse(line)
    } catch (error) {
      this.emit('parse_error', { line, error })
      return
    }

    // Server response to our request.
    if (typeof message.id !== 'undefined' && !message.method) {
      const pending = this.pending.get(message.id)
      if (!pending) {
        this.emit('orphan_response', message)
        return
      }

      clearTimeout(pending.timeoutId)
      this.pending.delete(message.id)

      if (message.error) {
        const error = new Error(message.error.message || `Codex RPC error for ${pending.method}`)
        error.code = message.error.code
        error.data = message.error.data
        pending.reject(error)
        return
      }

      pending.resolve(message.result || {})
      return
    }

    // Server initiated request/notification.
    if (message.method) {
      if (typeof message.id !== 'undefined') {
        this.emit('server_request', message)
      } else {
        this.emit('notification', message)
      }
    }
  }

  rejectAllPending(error) {
    this.pending.forEach((pending, id) => {
      clearTimeout(pending.timeoutId)
      pending.reject(error)
      this.pending.delete(id)
    })
  }
}

module.exports = { CodexRpcClient }
