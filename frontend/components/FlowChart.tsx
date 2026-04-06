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

const agentPositionMap = new Map([
  ['planner', { x: 132, y: 24 }],
  ['executor', { x: 132, y: 230 }],
  ['reviewer', { x: 132, y: 436 }],
])

const statusPalette: Record<string, { bg: string; text: string; ring: string; glow: string }> = {
  idle: { bg: 'rgba(15,23,42,0.72)', text: '#cbd5e1', ring: 'rgba(148,163,184,0.32)', glow: '0 0 0 rgba(0,0,0,0)' },
  working: { bg: 'rgba(14,165,233,0.16)', text: '#7dd3fc', ring: 'rgba(14,165,233,0.38)', glow: '0 14px 30px -24px rgba(14,165,233,0.82)' },
  completed: { bg: 'rgba(34,197,94,0.16)', text: '#86efac', ring: 'rgba(34,197,94,0.34)', glow: '0 14px 30px -24px rgba(34,197,94,0.82)' },
  error: { bg: 'rgba(239,68,68,0.16)', text: '#fca5a5', ring: 'rgba(239,68,68,0.36)', glow: '0 14px 30px -24px rgba(239,68,68,0.82)' },
  done: { bg: 'rgba(34,197,94,0.16)', text: '#86efac', ring: 'rgba(34,197,94,0.34)', glow: '0 14px 30px -24px rgba(34,197,94,0.82)' },
}

interface FlowChartProps {
  agents: Agent[]
}

export default function FlowChart({ agents }: FlowChartProps) {
  const edges = useMemo(() => {
    const active = agents.some(agent => agent.status === 'working')
    return [
      {
        id: 'planner->executor',
        source: 'planner',
        target: 'executor',
        animated: active,
        style: { stroke: active ? '#38bdf8' : 'rgba(148,163,184,0.34)', strokeWidth: 1.8 },
      },
      {
        id: 'executor->reviewer',
        source: 'executor',
        target: 'reviewer',
        animated: active,
        style: { stroke: active ? '#2dd4bf' : 'rgba(148,163,184,0.34)', strokeWidth: 1.8 },
      },
    ]
  }, [agents])

  const nodes = useMemo(() => {
    return agents.map(agent => {
      const palette = statusPalette[agent.status] || statusPalette.idle
      return {
        id: agent.id,
        position: agentPositionMap.get(agent.id) || { x: 180, y: 346 },
        data: {
          label: (
            <div className="grid h-full w-[248px] place-items-center content-center gap-2 text-center">
              <p
                className="w-full truncate text-[15px] font-semibold leading-[1.25]"
                style={{ color: palette.text }}
                title={agent.name}
              >
                {agent.name}
              </p>
              <span
                className="inline-flex max-w-[190px] items-center justify-center truncate rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.09em] leading-[1.15]"
                style={{
                  color: palette.text,
                  background: 'rgba(15,23,42,0.24)',
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
          borderRadius: 18,
          border: `1px solid ${palette.ring}`,
          boxShadow: `0 10px 24px -22px rgba(15,23,42,0.85), ${palette.glow}`,
          padding: '0 20px',
          minWidth: 248,
          minHeight: 106,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        },
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
      }
    })
  }, [agents])

  return (
    <div className="frame-surface frame-muted h-full w-full overflow-hidden rounded-2xl border border-[var(--line)] bg-[rgba(8,12,18,0.52)]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        fitViewOptions={{ padding: 0.14 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnScroll
        proOptions={{ hideAttribution: true }}
      >
        <Controls className="!bottom-4 !left-4 !rounded-xl !border !border-[var(--line)] !bg-[rgba(15,23,42,0.82)] !shadow-md [&>button]:!border-[rgba(148,163,184,0.25)] [&>button]:!bg-[rgba(15,23,42,0.72)] [&>button]:!text-[var(--ink-soft)]" />
        <Background color="rgba(148,163,184,0.22)" gap={22} size={1} variant={BackgroundVariant.Dots} />
      </ReactFlow>
    </div>
  )
}
