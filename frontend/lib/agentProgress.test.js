const test = require('node:test')
const assert = require('node:assert/strict')

const { buildAgentProgressMap } = require('./agentProgress')

test('buildAgentProgressMap summarizes coordinator stage progress and latest command', () => {
  const progress = buildAgentProgressMap(
    [{ id: 'agent-main', status: 'working' }],
    [
      {
        id: 'task-parent',
        agentId: 'agent-main',
        description: 'Build swarm workspace',
        status: 'reviewing',
        createdAt: '2026-04-15T08:00:00.000Z',
        updatedAt: '2026-04-15T08:00:20.000Z',
        subTasks: ['task-parent:planner', 'task-parent:executor', 'task-parent:reviewer'],
      },
      {
        id: 'task-parent:planner',
        agentId: 'task-parent::planner',
        description: 'Build swarm workspace · Task Breakdown',
        status: 'completed',
        createdAt: '2026-04-15T08:00:01.000Z',
      },
      {
        id: 'task-parent:executor',
        agentId: 'task-parent::executor',
        description: 'Build swarm workspace · Primary Build',
        status: 'completed',
        createdAt: '2026-04-15T08:00:05.000Z',
      },
      {
        id: 'task-parent:reviewer',
        agentId: 'task-parent::reviewer',
        description: 'Build swarm workspace · Quality Gate',
        status: 'executing',
        createdAt: '2026-04-15T08:00:10.000Z',
      },
    ],
    [
      {
        id: 'log-1',
        timestamp: '2026-04-15T08:00:21.000Z',
        message: '[task-parent::reviewer] npm run build (exit=0)',
        taskId: 'task-parent:reviewer',
        agentId: 'task-parent::reviewer',
      },
    ]
  )

  assert.equal(progress['agent-main'].label, 'Running task-parent::reviewer')
  assert.equal(progress['agent-main'].detail, 'Build swarm workspace · Quality Gate')
  assert.equal(progress['agent-main'].latestCommand, 'npm run build (exit=0)')
})

test('buildAgentProgressMap summarizes worker detail and latest command', () => {
  const progress = buildAgentProgressMap(
    [{ id: 'task-parent::executor', status: 'working' }],
    [
      {
        id: 'task-parent:executor',
        agentId: 'task-parent::executor',
        description: 'Build swarm workspace · Primary Build',
        status: 'executing',
        createdAt: '2026-04-15T08:00:05.000Z',
        result: null,
      },
    ],
    [
      {
        id: 'log-2',
        timestamp: '2026-04-15T08:00:22.000Z',
        message: '[task-parent::executor] rg -n "workspace" src (exit=0)',
        taskId: 'task-parent:executor',
        agentId: 'task-parent::executor',
      },
    ]
  )

  assert.equal(progress['task-parent::executor'].label, 'Executing now')
  assert.equal(progress['task-parent::executor'].detail, 'Build swarm workspace · Primary Build')
  assert.equal(progress['task-parent::executor'].latestCommand, 'rg -n "workspace" src (exit=0)')
})
