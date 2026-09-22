const test = require('node:test')
const assert = require('node:assert/strict')
const { JevOrchestrator, heuristicDecision } = require('../services/jevOrchestrator')

test('Jev maps a choice response into an orchestration strategy', async () => {
  const jev = new JevOrchestrator({
    enabled: true,
    apiKey: 'test-key',
    fetchImpl: async (_url, request) => {
      const body = JSON.parse(request.body)
      assert.equal(body.model, 'jev-latest')
      assert.equal(body.questions.strategy.type, 'choice')
      return {
        ok: true,
        async json() {
          return { answers: { strategy: { answer: 'parallel_team', probabilities: { parallel_team: 0.91 } } } }
        }
      }
    }
  })

  const result = await jev.judgeSubagentNeed({ prompt: 'compare frontend and backend independently' })
  assert.equal(result.decision, 'parallel_team')
  assert.equal(result.source, 'jev')
  assert.equal(result.probabilities.parallel_team, 0.91)
})

test('heuristic fallback keeps simple requests on one coordinator', () => {
  assert.equal(heuristicDecision('fix the login button').decision, 'none')
  assert.equal(heuristicDecision('create a team to compare frontend and backend').decision, 'parallel_team')
})
