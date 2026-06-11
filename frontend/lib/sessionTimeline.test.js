const test = require('node:test')
const assert = require('node:assert/strict')

const { buildSessionTimeline, filterSessionLogs } = require('./sessionTimeline')

test('buildSessionTimeline combines task lifecycle events and logs newest first', () => {
  const tasks = [
    {
      id: 'task-1',
      description: 'Build timeline panel',
      status: 'completed',
      createdAt: '2026-06-11T08:00:00.000Z',
      updatedAt: '2026-06-11T08:05:00.000Z',
      agentId: 'agent-main',
    },
  ]
  const logs = [
    {
      id: 'log-1',
      timestamp: '2026-06-11T08:03:00.000Z',
      level: 'info',
      message: 'implementation started',
      agentId: 'agent-main',
      taskId: 'task-1',
    },
  ]

  const timeline = buildSessionTimeline(tasks, logs)

  assert.deepEqual(
    timeline.map((event) => event.id),
    ['task:task-1:updated', 'log:log-1', 'task:task-1:created']
  )
  assert.equal(timeline[0].kind, 'task')
  assert.equal(timeline[0].status, 'completed')
  assert.equal(timeline[1].kind, 'log')
  assert.equal(timeline[1].level, 'info')
})

test('buildSessionTimeline omits duplicate task update events when createdAt equals updatedAt', () => {
  const timeline = buildSessionTimeline(
    [
      {
        id: 'task-2',
        description: 'Single event task',
        status: 'executing',
        createdAt: '2026-06-11T08:00:00.000Z',
        updatedAt: '2026-06-11T08:00:00.000Z',
        agentId: 'agent-main',
      },
    ],
    []
  )

  assert.deepEqual(
    timeline.map((event) => event.id),
    ['task:task-2:created']
  )
})

test('filterSessionLogs narrows logs by selected agent and related task ids', () => {
  const logs = [
    { id: 'agent-log', timestamp: '2026-06-11T08:00:00.000Z', level: 'info', message: 'agent event', agentId: 'agent-main' },
    { id: 'task-log', timestamp: '2026-06-11T08:01:00.000Z', level: 'info', message: 'task event', taskId: 'task-1' },
    { id: 'other-log', timestamp: '2026-06-11T08:02:00.000Z', level: 'info', message: 'other event', agentId: 'agent-worker' },
  ]

  const filtered = filterSessionLogs(logs, {
    agentId: 'agent-main',
    taskIds: ['task-1'],
  })

  assert.deepEqual(
    filtered.map((log) => log.id),
    ['task-log', 'agent-log']
  )
})
