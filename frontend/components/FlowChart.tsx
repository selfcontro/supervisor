'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ReactFlow,
  Controls,
  Background,
  Position,
  BackgroundVariant,
  Panel,
  useNodesState,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { Agent } from '@/src/types/agent'

type FlowAgent = Agent & {
  role?: string
  ephemeral?: boolean
  workflowParentTaskId?: string | null
  stageId?: string | null
}

const primaryFlowIds = ['planner', 'executor', 'subagent', 'reviewer']

const statusPalette: Record<string, { bg: string; text: string; ring: string; glow: string }> = {
  idle: {
    bg: 'linear-gradient(180deg, rgba(17,24,39,0.95) 0%, rgba(15,23,42,0.82) 100%)',
    text: '#dbe4f0',
    ring: 'rgba(148,163,184,0.3)',
    glow: '0 18px 42px -34px rgba(15,23,42,0.92)',
  },
  working: {
    bg: 'linear-gradient(180deg, rgba(8,47,73,0.9) 0%, rgba(14,116,144,0.32) 100%)',
    text: '#7dd3fc',
    ring: 'rgba(56,189,248,0.46)',
    glow: '0 18px 36px -28px rgba(14,165,233,0.88)',
  },
  completed: {
    bg: 'linear-gradient(180deg, rgba(20,83,45,0.82) 0%, rgba(22,101,52,0.24) 100%)',
    text: '#86efac',
    ring: 'rgba(74,222,128,0.4)',
    glow: '0 18px 36px -28px rgba(34,197,94,0.82)',
  },
  error: {
    bg: 'linear-gradient(180deg, rgba(127,29,29,0.82) 0%, rgba(153,27,27,0.22) 100%)',
    text: '#fca5a5',
    ring: 'rgba(248,113,113,0.42)',
    glow: '0 18px 36px -28px rgba(239,68,68,0.8)',
  },
  done: {
    bg: 'linear-gradient(180deg, rgba(20,83,45,0.82) 0%, rgba(22,101,52,0.24) 100%)',
    text: '#86efac',
    ring: 'rgba(74,222,128,0.4)',
    glow: '0 18px 36px -28px rgba(34,197,94,0.82)',
  },
}

interface FlowChartProps {
  agents: FlowAgent[]
  selectedAgentId?: string | null
  onSelectAgent?: (agentId: string | null) => void
}

type FlowPosition = {
  x: number
  y: number
}

function isPrimaryAgent(agentId: string) {
  return primaryFlowIds.includes(agentId)
}

export default function FlowChart({ agents, selectedAgentId = null, onSelectAgent }: FlowChartProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(buildFlowNodes(agents, selectedAgentId))

  useEffect(() => {
    setNodes((currentNodes) => {
      const savedPositions = new Map(
        currentNodes.map((node) => [String(node.id), node.position] as const)
      )

      return buildFlowNodes(agents, selectedAgentId, savedPositions)
    })
  }, [agents, selectedAgentId, setNodes])

  const handleResetLayout = useCallback(() => {
    setNodes(buildFlowNodes(agents, selectedAgentId))
  }, [agents, selectedAgentId, setNodes])

  const edges = useMemo(() => {
    const active = agents.some((agent) => agent.status === 'working')
    const coordinator = agents.find((agent) => agent.id === 'agent-main')
    const workflowGroups = groupWorkflowAgents(agents)
    const nextEdges = []

    workflowGroups.forEach((group) => {
      if (group.length === 0) {
        return
      }

      const firstAgent = group[0]

      if (coordinator && firstAgent) {
        nextEdges.push({
          id: `${coordinator.id}->${firstAgent.id}`,
          source: coordinator.id,
          target: firstAgent.id,
          type: 'default',
          animated: active,
          style: { stroke: 'rgba(56,189,248,0.82)', strokeWidth: 2 },
        })
      }

      for (let index = 0; index < group.length - 1; index += 1) {
        const currentAgent = group[index]
        const nextAgent = group[index + 1]

        nextEdges.push({
          id: `${currentAgent.id}->${nextAgent.id}`,
          source: currentAgent.id,
          target: nextAgent.id,
          type: 'default',
          animated: active,
          style: {
            stroke: active ? 'rgba(56,189,248,0.82)' : 'rgba(148,163,184,0.3)',
            strokeWidth: 1.9,
          },
        })
      }
    })

    return nextEdges
  }, [agents])

  return (
    <div className="h-full w-full overflow-hidden bg-transparent">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        fitViewOptions={{ padding: 0.24, minZoom: 0.68 }}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        onlyRenderVisibleElements
        panOnScroll
        proOptions={{ hideAttribution: true }}
        onNodesChange={onNodesChange}
        onNodeClick={(_, node) => onSelectAgent?.(String(node.id))}
        onPaneClick={() => onSelectAgent?.(null)}
      >
        <Panel position="top-right">
          <button
            type="button"
            onClick={handleResetLayout}
            className="rounded-full border border-[rgba(125,211,252,0.18)] bg-[rgba(2,6,23,0.72)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[rgba(191,219,254,0.74)] backdrop-blur transition hover:border-[rgba(125,211,252,0.38)] hover:text-[rgba(255,255,255,0.96)]"
          >
            Reset layout
          </button>
        </Panel>
        <Controls className="!bottom-4 !left-4 !rounded-xl !border !border-[rgba(148,163,184,0.14)] !bg-[rgba(2,6,23,0.78)] !shadow-none !backdrop-blur [&>button]:!border-[rgba(148,163,184,0.14)] [&>button]:!bg-[rgba(2,6,23,0.72)] [&>button]:!text-[rgba(226,232,240,0.72)]" />
        <Background color="rgba(148,163,184,0.12)" gap={28} size={1} variant={BackgroundVariant.Dots} />
      </ReactFlow>
    </div>
  )
}

function buildMindMapLayout(agents: FlowAgent[]) {
  const layout: Record<string, FlowPosition> = {}
  const coordinator = agents.find((agent) => agent.id === 'agent-main')
  const workflowGroups = groupWorkflowAgents(agents)

  if (coordinator) {
    layout[coordinator.id] = { x: 332, y: 28 }
  }

  workflowGroups.forEach((group, index) => {
    const baseX = 332 + index * 356
    group.forEach((agent) => {
      const stageOrder = primaryFlowIds.indexOf(agent.stageId || '')
      layout[agent.id] = {
        x: baseX,
        y: 232 + Math.max(stageOrder, 0) * 206,
      }
    })
  })

  const extraRuntimeAgents = agents.filter(
    (agent) => agent.id !== 'agent-main' && !agent.ephemeral && !agent.stageId
  )

  extraRuntimeAgents.forEach((agent, index) => {
    layout[agent.id] = { x: 720, y: 232 + index * 164 }
  })

  return layout
}

function buildFlowNodes(
  agents: FlowAgent[],
  selectedAgentId: string | null,
  savedPositions?: Map<string, FlowPosition>
) {
  const defaultLayout = buildMindMapLayout(agents)

  return agents.map((agent) => {
    const palette = statusPalette[agent.status] || statusPalette.idle
    const isPrimary = isPrimaryAgent(agent.stageId || agent.id)
    const isCoordinator = agent.id === 'agent-main'
    const isSelected = selectedAgentId === agent.id
    const roleLabel = isCoordinator ? 'Main coordinator' : 'Workflow duty'
    const position = savedPositions?.get(agent.id) || defaultLayout[agent.id] || { x: 320, y: 220 }

    return {
      id: agent.id,
      position,
      data: {
        label: (
          <div className={`flex h-full flex-col justify-between ${(isPrimary || isCoordinator) ? 'w-[292px]' : 'w-[228px]'} gap-3 text-left`}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p
                  className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em]"
                  style={{ color: (isPrimary || isCoordinator) ? 'rgba(148,163,184,0.82)' : 'rgba(125,211,252,0.78)' }}
                >
                  {roleLabel}
                </p>
                <p
                  className="truncate text-[19px] font-semibold leading-[1.15]"
                  style={{ color: palette.text }}
                  title={agent.name}
                >
                  {agent.name}
                </p>
              </div>
              <span
                className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full"
                style={{
                  background: palette.text,
                  boxShadow: agent.status === 'working' ? `0 0 0 6px ${palette.ring}` : 'none',
                }}
              />
            </div>

            {agent.currentTask ? (
              <p
                className="line-clamp-2 min-h-[2.5rem] text-[12px] leading-5"
                style={{ color: 'rgba(191,219,254,0.8)' }}
                title={agent.currentTask}
              >
                {agent.currentTask}
              </p>
            ) : (
              <p className="min-h-[2.5rem] text-[12px] leading-5" style={{ color: 'rgba(148,163,184,0.68)' }}>
                {isCoordinator
                  ? 'Coordinates the live task workflow and only keeps the current specialist active.'
                  : agent.role
                    ? agent.role
                    : 'Attached to Codex runtime and ready for prompts.'}
              </p>
            )}

            <span
              className="inline-flex w-fit max-w-[190px] items-center justify-center truncate rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.09em] leading-[1.15]"
              style={{
                color: palette.text,
                background: (isPrimary || isCoordinator) ? 'rgba(15,23,42,0.44)' : 'rgba(8,47,73,0.34)',
                border: `1px solid ${palette.ring}`,
                fontFamily: "'JetBrains Mono', 'SFMono-Regular', monospace",
              }}
              title={agent.status}
            >
              {agent.status}
            </span>
          </div>
        ),
      },
      style: {
        background: palette.bg,
        borderRadius: (isPrimary || isCoordinator) ? 24 : 20,
        border: isSelected ? `1px solid ${palette.text}` : `1px solid ${palette.ring}`,
        boxShadow: isSelected
          ? `inset 0 1px 0 rgba(255,255,255,0.08), 0 0 0 2px rgba(191,219,254,0.18), 0 18px 38px -26px rgba(56,189,248,0.38), ${palette.glow}`
          : `inset 0 1px 0 rgba(255,255,255,0.05), 0 10px 24px -22px rgba(15,23,42,0.85), ${palette.glow}`,
        padding: (isPrimary || isCoordinator) ? '18px 20px 16px' : '16px 18px 14px',
        minWidth: (isPrimary || isCoordinator) ? 292 : 228,
        minHeight: (isPrimary || isCoordinator) ? 152 : 132,
        display: 'flex',
        alignItems: 'stretch',
        justifyContent: 'stretch',
        cursor: 'pointer',
      },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
    }
  })
}

function groupWorkflowAgents(agents: FlowAgent[]) {
  const grouped = new Map<string, FlowAgent[]>()

  for (const agent of agents) {
    if (!agent.ephemeral || !agent.workflowParentTaskId) {
      continue
    }

    const bucket = grouped.get(agent.workflowParentTaskId) || []
    bucket.push(agent)
    grouped.set(agent.workflowParentTaskId, bucket)
  }

  return Array.from(grouped.values()).map((group) =>
    group.slice().sort((left, right) => {
      return primaryFlowIds.indexOf(left.stageId || '') - primaryFlowIds.indexOf(right.stageId || '')
    })
  )
}
