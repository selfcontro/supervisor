'use client'

import { useMemo } from 'react'
import {
  ReactFlow,
  Controls,
  Background,
  Position,
  BackgroundVariant,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { Agent } from '@/src/types/agent'

type FlowAgent = Agent & {
  role?: string
}

const primaryFlowIds = ['planner', 'executor', 'reviewer']

const primaryAgentPositionMap = new Map([
  ['planner', { x: 84, y: 36 }],
  ['executor', { x: 84, y: 254 }],
  ['reviewer', { x: 84, y: 472 }],
])

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

function isPrimaryAgent(agentId: string) {
  return primaryFlowIds.includes(agentId)
}

export default function FlowChart({ agents, selectedAgentId = null, onSelectAgent }: FlowChartProps) {
  const edges = useMemo(() => {
    const active = agents.some((agent) => agent.status === 'working')
    return [
      {
        id: 'planner->executor',
        source: 'planner',
        target: 'executor',
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
    const runtimeAgents = agents.filter((agent) => !isPrimaryAgent(agent.id))

    return agents.map((agent) => {
      const palette = statusPalette[agent.status] || statusPalette.idle
      const isPrimary = isPrimaryAgent(agent.id)
      const isSelected = selectedAgentId === agent.id
      const runtimeIndex = runtimeAgents.findIndex((runtimeAgent) => runtimeAgent.id === agent.id)
      const roleLabel = isPrimary ? `${agent.name} stage` : 'Runtime agent'
      const position = isPrimary
        ? primaryAgentPositionMap.get(agent.id) || { x: 84, y: 84 }
        : { x: 452, y: 108 + Math.max(runtimeIndex, 0) * 164 }

      return {
        id: agent.id,
        position,
        data: {
          label: (
            <div className={`flex h-full flex-col justify-between ${isPrimary ? 'w-[292px]' : 'w-[228px]'} gap-3 text-left`}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p
                    className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em]"
                    style={{ color: isPrimary ? 'rgba(148,163,184,0.82)' : 'rgba(125,211,252,0.78)' }}
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
                  {isPrimary ? 'Waiting for the next orchestration step.' : 'Attached to Codex runtime and ready for prompts.'}
                </p>
              )}

              <span
                className="inline-flex w-fit max-w-[190px] items-center justify-center truncate rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.09em] leading-[1.15]"
                style={{
                  color: palette.text,
                  background: isPrimary ? 'rgba(15,23,42,0.44)' : 'rgba(8,47,73,0.34)',
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
          borderRadius: isPrimary ? 24 : 20,
          border: isSelected ? `1px solid ${palette.text}` : `1px solid ${palette.ring}`,
          boxShadow: isSelected
            ? `inset 0 1px 0 rgba(255,255,255,0.08), 0 0 0 2px rgba(191,219,254,0.18), 0 18px 38px -26px rgba(56,189,248,0.38), ${palette.glow}`
            : `inset 0 1px 0 rgba(255,255,255,0.05), 0 10px 24px -22px rgba(15,23,42,0.85), ${palette.glow}`,
          padding: isPrimary ? '18px 20px 16px' : '16px 18px 14px',
          minWidth: isPrimary ? 292 : 228,
          minHeight: isPrimary ? 152 : 132,
          display: 'flex',
          alignItems: 'stretch',
          justifyContent: 'stretch',
          cursor: 'pointer',
        },
        sourcePosition: isPrimary ? Position.Bottom : Position.Left,
        targetPosition: isPrimary ? Position.Top : Position.Left,
      }
    })
  }, [agents, selectedAgentId])

  return (
    <div className="frame-surface frame-muted h-full w-full overflow-hidden rounded-2xl border border-[var(--line)] bg-[rgba(8,12,18,0.52)]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        fitViewOptions={{ padding: 0.16, minZoom: 0.72 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnScroll
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, node) => onSelectAgent?.(String(node.id))}
        onPaneClick={() => onSelectAgent?.(null)}
      >
        <Controls className="!bottom-4 !left-4 !rounded-xl !border !border-[var(--line)] !bg-[rgba(15,23,42,0.82)] !shadow-md [&>button]:!border-[rgba(148,163,184,0.25)] [&>button]:!bg-[rgba(15,23,42,0.72)] [&>button]:!text-[var(--ink-soft)]" />
        <Background color="rgba(148,163,184,0.22)" gap={22} size={1} variant={BackgroundVariant.Dots} />
      </ReactFlow>
    </div>
  )
}
