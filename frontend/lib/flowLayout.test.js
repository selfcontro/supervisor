const test = require('node:test')
const assert = require('node:assert/strict')

const { buildWorkflowLayout } = require('./flowLayout')

test('workflow layout leaves enough vertical room between coordinator, breakdown, workers, and review nodes', () => {
  const agents = [
    { id: 'agent-main', stageId: null, ephemeral: false },
    { id: 'task-1::task-breakdown', stageId: 'task-breakdown', ephemeral: true, workflowParentTaskId: 'task-1' },
    { id: 'task-1::ui-build', stageId: 'ui-build', ephemeral: true, workflowParentTaskId: 'task-1' },
    { id: 'task-1::backend-integration', stageId: 'backend-integration', ephemeral: true, workflowParentTaskId: 'task-1' },
    { id: 'task-1::quality-gate', stageId: 'quality-gate', ephemeral: true, workflowParentTaskId: 'task-1' },
  ]

  const layout = buildWorkflowLayout(agents)

  assert.ok(layout['agent-main'])
  assert.ok(layout['task-1::task-breakdown'])
  assert.ok(layout['task-1::ui-build'])
  assert.ok(layout['task-1::backend-integration'])
  assert.ok(layout['task-1::quality-gate'])

  assert.ok(
    layout['task-1::task-breakdown'].y - layout['agent-main'].y >= 280,
    'breakdown node should sit below the coordinator with enough gap'
  )
  assert.ok(
    layout['task-1::ui-build'].y - layout['task-1::task-breakdown'].y >= 260,
    'worker nodes should sit below breakdown without overlapping it'
  )
  assert.ok(
    layout['task-1::quality-gate'].y - layout['task-1::ui-build'].y >= 260,
    'review node should sit below workers without overlapping them'
  )
  assert.notEqual(
    layout['task-1::ui-build'].x,
    layout['task-1::backend-integration'].x,
    'parallel workers should be horizontally separated'
  )
})

test('workflow layout keeps separate task groups horizontally apart', () => {
  const agents = [
    { id: 'agent-main', stageId: null, ephemeral: false },
    { id: 'task-1::task-breakdown', stageId: 'task-breakdown', ephemeral: true, workflowParentTaskId: 'task-1' },
    { id: 'task-1::ui-build', stageId: 'ui-build', ephemeral: true, workflowParentTaskId: 'task-1' },
    { id: 'task-1::backend-integration', stageId: 'backend-integration', ephemeral: true, workflowParentTaskId: 'task-1' },
    { id: 'task-2::task-breakdown', stageId: 'task-breakdown', ephemeral: true, workflowParentTaskId: 'task-2' },
    { id: 'task-2::primary-build', stageId: 'primary-build', ephemeral: true, workflowParentTaskId: 'task-2' },
    { id: 'task-2::validation-sweep', stageId: 'validation-sweep', ephemeral: true, workflowParentTaskId: 'task-2' },
  ]

  const layout = buildWorkflowLayout(agents)

  assert.ok(
    Math.abs(layout['task-2::task-breakdown'].x - layout['task-1::task-breakdown'].x) >= 600,
    'separate task groups should have enough horizontal separation'
  )
})
