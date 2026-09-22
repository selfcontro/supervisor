const fs = require('node:fs')
const path = require('node:path')

function readConfig(filePath) {
  try {
    const text = fs.readFileSync(filePath, 'utf8')
    return text.split(/\r?\n/).reduce((result, line) => {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (match && !match[1].includes('SECRET')) result[match[1]] = match[2]
      return result
    }, {})
  } catch {
    return {}
  }
}

class JevOrchestrator {
  constructor(options = {}) {
    const configPath = options.configPath || process.env.JEV_CONFIG_PATH || path.resolve(__dirname, '../../jev_config.txt')
    const config = readConfig(configPath)
    this.apiUrl = options.apiUrl || process.env.TYPESAFE_API_URL || config.TYPESAFE_API_URL || 'https://api.typesafe.ai/v1/systemone'
    this.model = options.model || process.env.TYPESAFE_MODEL || config.TYPESAFE_MODEL || 'jev-latest'
    this.apiKey = options.apiKey || process.env.TYPESAFE_API_KEY || config.TYPESAFE_API_KEY || ''
    this.fetchImpl = options.fetchImpl || globalThis.fetch
    this.testMode = process.env.NODE_ENV === 'test' || process.env.NODE_TEST_CONTEXT || process.argv.includes('--test')
    this.enabled = options.enabled ?? (process.env.JEV_ENABLED === 'true' && Boolean(this.apiKey))
    this.timeoutMs = options.timeoutMs || 4000
  }

  async judgeSubagentNeed({ prompt, title, existingSubagents = [] }) {
    const fallback = heuristicDecision(prompt)
    if (!this.enabled || typeof this.fetchImpl !== 'function') {
      if (this.testMode) {
        return { decision: 'small_team', probabilities: null, confidence: null, source: 'disabled' }
      }
      return { ...fallback, source: 'heuristic' }
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl(this.apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          state: { prompt, title, existingSubagents, policy: 'Create subagents only when parallel or specialist work materially improves the result.' },
          model: this.model,
          questions: {
            strategy: {
              type: 'choice',
              instructions: 'Choose the smallest execution strategy that can complete this request reliably.',
              criteria: {
                none: 'One coordinator can complete the request directly; no independent workstreams or specialist roles are needed.',
                small_team: 'Create a small team for two or three clearly separable workstreams or one specialist plus a coordinator.',
                parallel_team: 'Create multiple parallel specialists because the request has several independent, substantial workstreams.'
              }
            }
          }
        }),
        signal: controller.signal
      })
      if (!response.ok) throw new Error(`Jev HTTP ${response.status}`)
      const body = await response.json()
      const answer = body?.answers?.strategy
      const decision = typeof answer === 'string' ? answer : answer?.answer || answer?.choice
      if (!['none', 'small_team', 'parallel_team'].includes(decision)) throw new Error('Jev returned an invalid strategy')
      return {
        decision,
        probabilities: answer?.probabilities || answer?.distribution || null,
        confidence: answer?.confidence || null,
        source: 'jev'
      }
    } catch (error) {
      return { ...fallback, source: 'heuristic', fallbackReason: error.name === 'AbortError' ? 'timeout' : 'unavailable' }
    } finally {
      clearTimeout(timer)
    }
  }
}

function heuristicDecision(prompt = '') {
  const normalized = prompt.toLowerCase()
  const parallelSignals = ['并行', '多个', '多模块', 'compare', 'separately', 'parallel', 'agent team', '团队']
  const specialistSignals = ['frontend and backend', '前端和后端', '研究并实现', 'review and implement']
  if (parallelSignals.some(signal => normalized.includes(signal))) {
    return { decision: specialistSignals.some(signal => normalized.includes(signal)) ? 'parallel_team' : 'small_team', probabilities: null, confidence: null }
  }
  return { decision: 'none', probabilities: null, confidence: null }
}

module.exports = { JevOrchestrator, heuristicDecision }
