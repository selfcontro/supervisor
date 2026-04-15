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
  type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import agentProgressModule from '@/lib/agentProgress'
import flowLayoutModule from '@/lib/flowLayout'
import type { Agent } from '@/src/types/agent'
import type { SessionLogEntry, SessionTask } from '@/src/types/session'

type FlowAgent = Agent & {
  role?: string
  ephemeral?: boolean
  workflowParentTaskId?: string | null
  stageId?: string | null
}

type AgentProgress = {
  label: string
  detail: string | null
  latestCommand: string | null
} | null

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
  waiting: {
    bg: 'linear-gradient(180deg, rgba(51,65,85,0.86) 0%, rgba(30,41,59,0.44) 100%)',
    text: '#cbd5e1',
    ring: 'rgba(148,163,184,0.46)',
    glow: '0 18px 34px -28px rgba(71,85,105,0.72)',
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
  tasks: SessionTask[]
  logs: SessionLogEntry[]
  selectedAgentId?: string | null
  onSelectAgent?: (agentId: string | null) => void
}

type FlowPosition = {
  x: number
  y: number
}

function isPrimaryAgent(agentId: string) {
  return agentId === 'task-breakdown' || agentId === 'quality-gate'
}

export default function FlowChart({ agents, tasks, logs, selectedAgentId = null, onSelectAgent }: FlowChartProps) {
  const { buildAgentProgressMap } = agentProgressModule
  const { buildWorkflowLayout, groupWorkflowAgents, getWorkflowStageKind } = flowLayoutModule
  const progressByAgent = useMemo(
    () => buildAgentProgressMap(agents, tasks, logs) as Record<string, AgentProgress>,
    [agents, tasks, logs, buildAgentProgressMap]
  )
  const [nodes, setNodes, onNodesChange] = useNodesState(buildFlowNodes(agents, progressByAgent, selectedAgentId))

  useEffect(() => {
    setNodes((currentNodes) => {
      const savedPositions = new Map(
        currentNodes.map((node) => [String(node.id), node.position] as const)
      )

      return buildFlowNodes(agents, progressByAgent, selectedAgentId, savedPositions)
    })
  }, [agents, progressByAgent, selectedAgentId, setNodes])

  const handleResetLayout = useCallback(() => {
    setNodes(buildFlowNodes(agents, progressByAgent, selectedAgentId))
  }, [agents, progressByAgent, selectedAgentId, setNodes])

  const edges = useMemo(() => {
    const active = agents.some((agent) => agent.status === 'working')
    const coordinator = agents.find((agent) => agent.id === 'agent-main')
    const workflowGroups = groupWorkflowAgents(agents)
    const nextEdges: Edge[] = []

    workflowGroups.forEach((group: FlowAgent[]) => {
      if (group.length === 0) {
        return
      }

      const breakdownAgent = group.find((agent: FlowAgent) => getWorkflowStageKind(agent.stageId) === 'breakdown')
      const reviewAgent = group.find((agent: FlowAgent) => getWorkflowStageKind(agent.stageId) === 'review')
      const workerAgents = group.filter((agent: FlowAgent) => getWorkflowStageKind(agent.stageId) === 'worker')

      if (coordinator && breakdownAgent) {
        nextEdges.push({
          id: `${coordinator.id}->${breakdownAgent.id}`,
          source: coordinator.id,
          target: breakdownAgent.id,
          type: 'default',
          animated: active,
          style: { stroke: 'rgba(56,189,248,0.82)', strokeWidth: 2 },
        })
      }

      if (!breakdownAgent && coordinator) {
        workerAgents.forEach((workerAgent: FlowAgent) => {
          nextEdges.push({
            id: `${coordinator.id}->${workerAgent.id}`,
            source: coordinator.id,
            target: workerAgent.id,
            type: 'default',
            animated: active,
            style: { stroke: 'rgba(56,189,248,0.82)', strokeWidth: 2 },
          })
        })
      }

      workerAgents.forEach((workerAgent: FlowAgent) => {
        if (breakdownAgent) {
          nextEdges.push({
            id: `${breakdownAgent.id}->${workerAgent.id}`,
            source: breakdownAgent.id,
            target: workerAgent.id,
            type: 'default',
            animated: active,
            style: {
              stroke: active ? 'rgba(56,189,248,0.82)' : 'rgba(148,163,184,0.3)',
              strokeWidth: 1.9,
            },
          })
        }

        if (reviewAgent) {
          nextEdges.push({
            id: `${workerAgent.id}->${reviewAgent.id}`,
            source: workerAgent.id,
            target: reviewAgent.id,
            type: 'default',
            animated: active,
            style: {
              stroke: active ? 'rgba(56,189,248,0.82)' : 'rgba(148,163,184,0.3)',
              strokeWidth: 1.9,
            },
          })
        }
      })

      if (breakdownAgent && workerAgents.length === 0 && reviewAgent) {
        nextEdges.push({
          id: `${breakdownAgent.id}->${reviewAgent.id}`,
          source: breakdownAgent.id,
          target: reviewAgent.id,
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
  }, [agents, getWorkflowStageKind, groupWorkflowAgents])

  return (
    <div className="h-full w-full overflow-hidden bg-transparent">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        fitViewOptions={{ padding: 0.34, minZoom: 0.58 }}
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

function buildFlowNodes(
  agents: FlowAgent[],
  progressByAgent: Record<string, AgentProgress>,
  selectedAgentId: string | null,
  savedPositions?: Map<string, FlowPosition>
) {
  const { buildWorkflowLayout } = flowLayoutModule
  const defaultLayout = buildWorkflowLayout(agents) as Record<string, FlowPosition>

  return agents.map((agent) => {
    const palette = statusPalette[agent.status] || statusPalette.idle
    const isPrimary = isPrimaryAgent(agent.stageId || agent.id)
    const isCoordinator = agent.id === 'agent-main'
    const isSelected = selectedAgentId === agent.id
    const roleLabel = isCoordinator ? 'Main coordinator' : 'Workflow duty'
    const position = savedPositions?.get(agent.id) || defaultLayout[agent.id] || { x: 320, y: 220 }
    const progress = progressByAgent[agent.id]
    const nodeWidth = isCoordinator ? 280 : isPrimary ? 296 : 236
    const titleSize = isCoordinator ? 'text-[17px]' : 'text-[18px]'
    const taskTextMinHeight = isCoordinator ? 'min-h-[2rem]' : 'min-h-[2.5rem]'
    const statusMaxWidth = isCoordinator ? 150 : 190
    const detailClamp = 'line-clamp-1'

    return {
      id: agent.id,
      position,
      data: {
        label: (
          <div className="flex h-full flex-col justify-between gap-3 text-left" style={{ width: nodeWidth }}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p
                  className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em]"
                  style={{ color: (isPrimary || isCoordinator) ? 'rgba(148,163,184,0.82)' : 'rgba(125,211,252,0.78)' }}
                >
                  {roleLabel}
                </p>
                <p
                  className={`truncate font-semibold leading-[1.15] ${titleSize}`}
                  style={{ color: palette.text }}
                  title={agent.name}
                >
                  {agent.name}
                </p>
              </div>
              <div className="flex shrink-0 items-start justify-end pl-2">
                <span
                  className="mt-1 h-2.5 w-2.5 rounded-full"
                  style={{
                    background: palette.text,
                    boxShadow: agent.status === 'working' ? `0 0 0 4px ${palette.ring}` : 'none',
                  }}
                />
              </div>
            </div>

            {agent.currentTask ? (
              <p
                className={`line-clamp-2 ${taskTextMinHeight} text-[12px] leading-5`}
                style={{ color: 'rgba(191,219,254,0.8)' }}
                title={agent.currentTask}
              >
                {agent.currentTask}
              </p>
            ) : (
              <p className={`${taskTextMinHeight} text-[12px] leading-5`} style={{ color: 'rgba(148,163,184,0.68)' }}>
                {isCoordinator
                  ? 'Coordinates the workflow and waits for your manual finish before reset.'
                  : agent.role
                    ? agent.role
                  : 'Attached to Codex runtime and ready for prompts.'}
              </p>
            )}

            {progress ? (
              <div className="rounded-2xl border border-[rgba(148,163,184,0.16)] bg-[rgba(2,6,23,0.28)] px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[rgba(148,163,184,0.72)]">
                    Task Progress
                  </p>
                  <span className="truncate rounded-full border border-[rgba(148,163,184,0.14)] bg-[rgba(15,23,42,0.42)] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-[rgba(191,219,254,0.76)]">
                    {progress.label}
                  </span>
                </div>
                <p className={`mt-0.5 text-[11px] leading-5 text-[rgba(191,219,254,0.72)] ${detailClamp}`} title={progress.detail || undefined}>
                  {progress.detail || 'Waiting for the next update.'}
                </p>
                <p className="mt-1 truncate rounded-md bg-[rgba(15,23,42,0.34)] px-2 py-1 font-mono text-[10px] text-[rgba(125,211,252,0.82)]" title={progress.latestCommand || undefined}>
                  {progress.latestCommand || 'No command captured yet'}
                </p>
              </div>
            ) : null}

            <span
              className="inline-flex w-fit items-center justify-center truncate rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.09em] leading-[1.15]"
              style={{
                maxWidth: statusMaxWidth,
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
        minWidth: nodeWidth,
        minHeight: progress ? (isCoordinator ? 192 : 210) : (isPrimary || isCoordinator) ? 148 : 128,
        display: 'flex',
        alignItems: 'stretch',
        justifyContent: 'stretch',
        overflow: 'hidden',
        cursor: 'pointer',
      },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
    }
  })
}
