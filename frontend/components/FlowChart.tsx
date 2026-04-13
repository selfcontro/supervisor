'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ReactFlow,
  Controls,
  Background,
  Position,
  BackgroundVariant,
  Panel,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { Agent } from '@/src/types/agent'

type FlowAgent = Agent & {
  role?: string
}

const primaryFlowIds = ['planner', 'executor', 'reviewer']

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
  const [nodePositions, setNodePositions] = useState<Record<string, FlowPosition>>(() => buildMindMapLayout(agents))

  useEffect(() => {
    const layout = buildMindMapLayout(agents)
    setNodePositions((current) => {
      const next: Record<string, FlowPosition> = {}

      agents.forEach((agent) => {
        next[agent.id] = current[agent.id] || layout[agent.id]
      })

      return next
    })
  }, [agents])

  const handleResetLayout = useCallback(() => {
    setNodePositions(buildMindMapLayout(agents))
  }, [agents])

  const handleNodeDragStop = useCallback((_: unknown, node: { id: string; position: FlowPosition }) => {
    setNodePositions((current) => ({
      ...current,
      [String(node.id)]: {
        x: node.position.x,
        y: node.position.y,
      },
    }))
  }, [])

  const edges = useMemo(() => {
    const active = agents.some((agent) => agent.status === 'working')
    const hasCoordinator = agents.some((agent) => agent.id === 'agent-main')
    return [
      ...(hasCoordinator
        ? primaryFlowIds.map((targetId, index) => ({
            id: `agent-main->${targetId}`,
            source: 'agent-main',
            target: targetId,
            type: 'smoothstep',
            animated: active,
            style: {
              stroke: index === 0
                ? 'rgba(56,189,248,0.82)'
                : index === 1
                  ? 'rgba(45,212,191,0.74)'
                  : 'rgba(125,211,252,0.62)',
              strokeWidth: 1.7,
            },
          }))
        : []),
      {
        id: 'planner->executor',
        source: 'planner',
        target: 'executor',
        type: 'smoothstep',
        animated: active,
        style: {
          stroke: active ? 'rgba(56,189,248,0.82)' : 'rgba(148,163,184,0.3)',
          strokeWidth: 1.9,
        },
      },
      {
        id: 'executor->reviewer',
        source: 'executor',
        target: 'reviewer',
        animated: active,
        style: {
          stroke: active ? 'rgba(45,212,191,0.82)' : 'rgba(148,163,184,0.3)',
          strokeWidth: 1.9,
        },
      },
    ]
  }, [agents])

  const nodes = useMemo(() => {
    return agents.map((agent) => {
      const palette = statusPalette[agent.status] || statusPalette.idle
      const isPrimary = isPrimaryAgent(agent.id)
      const isCoordinator = agent.id === 'agent-main'
      const isSelected = selectedAgentId === agent.id
      const roleLabel = isPrimary ? `${agent.name} stage` : isCoordinator ? 'Main coordinator' : 'Runtime agent'
      const position = nodePositions[agent.id] || { x: 320, y: 220 }

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
                    ? 'Coordinating the planning, execution, and review lanes.'
                    : isPrimary
                      ? 'Waiting for the next orchestration step.'
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
        sourcePosition: isCoordinator ? Position.Right : isPrimary ? Position.Right : Position.Left,
        targetPosition: isCoordinator ? Position.Left : isPrimary ? Position.Left : Position.Left,
      }
    })
  }, [agents, nodePositions, selectedAgentId])

  return (
    <div className="frame-surface frame-muted h-full w-full overflow-hidden rounded-2xl border border-[var(--line)] bg-[rgba(8,12,18,0.52)]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        fitViewOptions={{ padding: 0.16, minZoom: 0.72 }}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        panOnScroll
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, node) => onSelectAgent?.(String(node.id))}
        onNodeDragStop={handleNodeDragStop}
        onPaneClick={() => onSelectAgent?.(null)}
      >
        <Panel position="top-right">
          <button
            type="button"
            onClick={handleResetLayout}
            className="rounded-full border border-[rgba(125,211,252,0.24)] bg-[rgba(8,47,73,0.46)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[rgba(191,219,254,0.9)] transition hover:border-[rgba(125,211,252,0.5)] hover:bg-[rgba(14,116,144,0.34)]"
          >
            Reset layout
          </button>
        </Panel>
        <Controls className="!bottom-4 !left-4 !rounded-xl !border !border-[var(--line)] !bg-[rgba(15,23,42,0.82)] !shadow-md [&>button]:!border-[rgba(148,163,184,0.25)] [&>button]:!bg-[rgba(15,23,42,0.72)] [&>button]:!text-[var(--ink-soft)]" />
        <Background color="rgba(148,163,184,0.22)" gap={22} size={1} variant={BackgroundVariant.Dots} />
      </ReactFlow>
    </div>
  )
}

function buildMindMapLayout(agents: FlowAgent[]) {
  const layout: Record<string, FlowPosition> = {}
  const runtimeAgents = agents.filter((agent) => !primaryFlowIds.includes(agent.id) && agent.id !== 'agent-main')

  agents.forEach((agent) => {
    if (agent.id === 'agent-main') {
      layout[agent.id] = { x: 300, y: 208 }
      return
    }

    if (agent.id === 'planner') {
      layout[agent.id] = { x: 56, y: 70 }
      return
    }

    if (agent.id === 'executor') {
      layout[agent.id] = { x: 610, y: 208 }
      return
    }

    if (agent.id === 'reviewer') {
      layout[agent.id] = { x: 56, y: 388 }
      return
    }
  })

  runtimeAgents.forEach((agent, index) => {
    layout[agent.id] = {
      x: 600 + (index % 2) * 12,
      y: 40 + index * 150,
    }
  })

  return layout
}
