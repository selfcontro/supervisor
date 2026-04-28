'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  type BlackboardDocument,
  fetchAgentBlackboard,
  fetchSessionBlackboard,
  saveAgentBlackboard,
  saveSessionBlackboard,
} from '@/lib/codexControlApi'
import type { SessionLogEntry, SessionTask } from '@/src/types/session'

interface BlackboardPanelProps {
  open: boolean
  sessionId: string
  selectedAgentId: string | null
  selectedAgentName?: string | null
  tasks: SessionTask[]
  logs: SessionLogEntry[]
  onClose: () => void
}

type BlackboardTab = 'session' | 'agent'
type BlackboardMode = 'structured' | 'markdown'

function sectionsToMarkdown(title: string, sections: BlackboardDocument['sections']) {
  const lines = [`# ${title}`, '']

  for (const section of sections) {
    lines.push(`## ${section.title}`)
    lines.push(section.content || '')
    lines.push('')
  }

  return lines.join('\n').trimEnd()
}

export default function BlackboardPanel({
  open,
  sessionId,
  selectedAgentId,
  selectedAgentName,
  tasks,
  logs,
  onClose,
}: BlackboardPanelProps) {
  const [activeTab, setActiveTab] = useState<BlackboardTab>('session')
  const [mode, setMode] = useState<BlackboardMode>('structured')
  const [sessionDoc, setSessionDoc] = useState<BlackboardDocument | null>(null)
  const [agentDoc, setAgentDoc] = useState<BlackboardDocument | null>(null)
  const [sessionMarkdownDraft, setSessionMarkdownDraft] = useState('')
  const [agentMarkdownDraft, setAgentMarkdownDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)

      try {
        const [nextSessionDoc, nextAgentDoc] = await Promise.all([
          fetchSessionBlackboard(sessionId),
          selectedAgentId ? fetchAgentBlackboard(sessionId, selectedAgentId) : Promise.resolve(null),
        ])

        if (cancelled) {
          return
        }

        setSessionDoc(nextSessionDoc)
        setSessionMarkdownDraft(nextSessionDoc.markdown)

        setAgentDoc(nextAgentDoc)
        setAgentMarkdownDraft(nextAgentDoc?.markdown || '')
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load blackboard')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [open, sessionId, selectedAgentId])

  useEffect(() => {
    if (activeTab === 'agent' && !selectedAgentId) {
      setActiveTab('session')
    }
  }, [activeTab, selectedAgentId])

  const currentDoc = activeTab === 'session' ? sessionDoc : agentDoc
  const currentMarkdownDraft = activeTab === 'session' ? sessionMarkdownDraft : agentMarkdownDraft
  const setCurrentMarkdownDraft = activeTab === 'session' ? setSessionMarkdownDraft : setAgentMarkdownDraft
  const title = activeTab === 'session' ? 'Session Blackboard' : `${selectedAgentName || selectedAgentId} Blackboard`

  const structuredSections = useMemo(() => currentDoc?.sections || [], [currentDoc])
  const proposedCandidates = useMemo(() => buildProposedMemoryCandidates(tasks, logs), [tasks, logs])
  const proposedMemoryLines = useMemo(() => {
    const proposedSection = sessionDoc?.sections.find((section) => section.id === 'proposed_memory')
    if (!proposedSection || typeof proposedSection.content !== 'string') {
      return []
    }

    return proposedSection.content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  }, [sessionDoc])

  function updateSection(sectionId: string, content: string) {
    if (!currentDoc) {
      return
    }

    const nextSections = currentDoc.sections.map((section) =>
      section.id === sectionId ? { ...section, content } : section
    )
    const nextMarkdown = sectionsToMarkdown(activeTab === 'session' ? 'Session Blackboard' : 'Agent Blackboard', nextSections)

    if (activeTab === 'session') {
      setSessionDoc({ ...currentDoc, sections: nextSections, markdown: nextMarkdown })
      setSessionMarkdownDraft(nextMarkdown)
      return
    }

    setAgentDoc({ ...currentDoc, sections: nextSections, markdown: nextMarkdown })
    setAgentMarkdownDraft(nextMarkdown)
  }

  function queueCandidateToProposedMemory(candidate: string) {
    if (!sessionDoc) {
      return
    }

    const proposedSection = sessionDoc.sections.find((section) => section.id === 'proposed_memory')
    const currentContent = proposedSection?.content?.trim() || ''
    const nextContent = currentContent ? `${currentContent}\n- ${candidate}` : `- ${candidate}`
    updateSessionSection('proposed_memory', nextContent)
    setActiveTab('session')
  }

  function promoteProposedLine(line: string) {
    if (!sessionDoc) {
      return
    }

    const shared = sessionDoc.sections.find((section) => section.id === 'shared_memory')?.content?.trim() || ''
    const proposed = sessionDoc.sections.find((section) => section.id === 'proposed_memory')?.content || ''

    const normalizedLine = line.trim()
    const sharedNext = shared ? `${shared}\n${normalizedLine}` : normalizedLine
    const proposedNext = proposed
      .split('\n')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .filter((entry) => entry !== normalizedLine)
      .join('\n')

    updateSessionSection('shared_memory', sharedNext)
    updateSessionSection('proposed_memory', proposedNext)
  }

  function updateSessionSection(sectionId: string, content: string) {
    if (!sessionDoc) {
      return
    }

    const nextSections = sessionDoc.sections.map((section) =>
      section.id === sectionId ? { ...section, content } : section
    )
    const nextMarkdown = sectionsToMarkdown('Session Blackboard', nextSections)
    setSessionDoc({ ...sessionDoc, sections: nextSections, markdown: nextMarkdown })
    setSessionMarkdownDraft(nextMarkdown)
  }

  async function handleSave() {
    if (!currentMarkdownDraft.trim()) {
      setError('Blackboard markdown cannot be empty.')
      return
    }

    setSaving(true)
    setError(null)
    try {
      if (activeTab === 'session') {
        const saved = await saveSessionBlackboard(sessionId, currentMarkdownDraft)
        setSessionDoc(saved)
        setSessionMarkdownDraft(saved.markdown)
      } else if (selectedAgentId) {
        const saved = await saveAgentBlackboard(sessionId, selectedAgentId, currentMarkdownDraft)
        setAgentDoc(saved)
        setAgentMarkdownDraft(saved.markdown)
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save blackboard')
    } finally {
      setSaving(false)
    }
  }

  return (
    <aside className="max-h-[min(76vh,820px)] w-[420px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-[1.4rem] border border-[rgba(148,163,184,0.14)] bg-[rgba(2,6,23,0.88)] shadow-[0_24px_80px_-40px_rgba(2,6,23,0.92)] backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-[rgba(148,163,184,0.12)] px-4 py-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[rgba(148,163,184,0.72)]">Blackboard</p>
          <p className="mt-1 text-sm text-[rgba(226,232,240,0.92)]">{title}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-[rgba(148,163,184,0.74)] transition hover:text-white"
        >
          Close
        </button>
      </div>

      <div className="flex items-center justify-between gap-3 border-b border-[rgba(148,163,184,0.08)] px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('session')}
            className={`rounded-full px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] transition ${
              activeTab === 'session'
                ? 'bg-[rgba(56,189,248,0.16)] text-cyan-100'
                : 'bg-[rgba(15,23,42,0.64)] text-[rgba(148,163,184,0.76)] hover:text-white'
            }`}
          >
            Session
          </button>
          <button
            type="button"
            onClick={() => selectedAgentId && setActiveTab('agent')}
            disabled={!selectedAgentId}
            className={`rounded-full px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] transition ${
              activeTab === 'agent'
                ? 'bg-[rgba(56,189,248,0.16)] text-cyan-100'
                : 'bg-[rgba(15,23,42,0.64)] text-[rgba(148,163,184,0.76)] hover:text-white disabled:cursor-not-allowed disabled:opacity-40'
            }`}
          >
            Selected Agent
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMode('structured')}
            className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] transition ${
              mode === 'structured'
                ? 'bg-[rgba(125,211,252,0.16)] text-cyan-50'
                : 'text-[rgba(148,163,184,0.72)] hover:text-white'
            }`}
          >
            Structured
          </button>
          <button
            type="button"
            onClick={() => setMode('markdown')}
            className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] transition ${
              mode === 'markdown'
                ? 'bg-[rgba(125,211,252,0.16)] text-cyan-50'
                : 'text-[rgba(148,163,184,0.72)] hover:text-white'
            }`}
          >
            Markdown
          </button>
        </div>
      </div>

      <div className="max-h-[calc(min(76vh,820px)-150px)] overflow-y-auto px-4 py-4">
        {loading ? (
          <p className="text-sm text-[rgba(148,163,184,0.74)]">Loading blackboard…</p>
        ) : currentDoc ? (
          mode === 'structured' ? (
            <div className="space-y-4">
              {activeTab === 'session' && proposedCandidates.length > 0 ? (
                <div className="rounded-2xl border border-[rgba(56,189,248,0.16)] bg-[rgba(8,47,73,0.18)] p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[rgba(125,211,252,0.78)]">
                    Candidate Memory
                  </p>
                  <div className="mt-3 space-y-2">
                    {proposedCandidates.map((candidate) => (
                      <div
                        key={candidate}
                        className="flex items-start justify-between gap-3 rounded-xl border border-[rgba(148,163,184,0.1)] bg-[rgba(2,6,23,0.48)] px-3 py-2"
                      >
                        <p className="text-sm leading-6 text-[rgba(226,232,240,0.86)]">{candidate}</p>
                        <button
                          type="button"
                          onClick={() => queueCandidateToProposedMemory(candidate)}
                          className="shrink-0 rounded-full border border-[rgba(125,211,252,0.22)] bg-[rgba(8,47,73,0.4)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[rgba(191,219,254,0.9)] transition hover:border-[rgba(125,211,252,0.42)] hover:text-white"
                        >
                          Queue
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {activeTab === 'session'
                ? proposedMemoryLines.length
                  ? (
                    <div className="rounded-2xl border border-[rgba(34,197,94,0.14)] bg-[rgba(20,83,45,0.14)] p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[rgba(134,239,172,0.8)]">
                        Promote to Shared Memory
                      </p>
                      <div className="mt-3 space-y-2">
                        {proposedMemoryLines.map((line) => (
                            <div
                              key={line}
                              className="flex items-start justify-between gap-3 rounded-xl border border-[rgba(148,163,184,0.1)] bg-[rgba(2,6,23,0.48)] px-3 py-2"
                            >
                              <p className="text-sm leading-6 text-[rgba(226,232,240,0.86)]">{line}</p>
                              <button
                                type="button"
                                onClick={() => promoteProposedLine(line)}
                                className="shrink-0 rounded-full border border-[rgba(134,239,172,0.22)] bg-[rgba(20,83,45,0.3)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[rgba(220,252,231,0.92)] transition hover:border-[rgba(134,239,172,0.42)] hover:text-white"
                              >
                                Promote
                              </button>
                            </div>
                          ))}
                      </div>
                    </div>
                  )
                  : null
                : null}

              <div className="space-y-4">
              {structuredSections.map((section) => (
                <div
                  key={section.id}
                  className="rounded-2xl border border-[rgba(148,163,184,0.12)] bg-[rgba(15,23,42,0.52)] p-3"
                >
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[rgba(148,163,184,0.68)]">
                    {section.title}
                  </p>
                  <textarea
                    value={section.content}
                    onChange={(event) => updateSection(section.id, event.target.value)}
                    rows={Math.max(3, String(section.content || '').split('\n').length || 1)}
                    className="mt-2 min-h-[84px] w-full resize-y rounded-xl border border-[rgba(148,163,184,0.12)] bg-[rgba(2,6,23,0.64)] px-3 py-2 text-sm leading-6 text-[rgba(241,245,249,0.94)] outline-none placeholder:text-[rgba(148,163,184,0.5)]"
                  />
                </div>
              ))}
              </div>
            </div>
          ) : (
            <textarea
              value={currentMarkdownDraft}
              onChange={(event) => setCurrentMarkdownDraft(event.target.value)}
              rows={24}
              className="min-h-[520px] w-full resize-y rounded-2xl border border-[rgba(148,163,184,0.12)] bg-[rgba(2,6,23,0.64)] px-4 py-3 font-mono text-sm leading-7 text-[rgba(241,245,249,0.94)] outline-none"
            />
          )
        ) : (
          <p className="text-sm text-[rgba(148,163,184,0.74)]">
            {activeTab === 'agent' ? 'Select an agent to inspect its local blackboard.' : 'No blackboard available yet.'}
          </p>
        )}
      </div>

      <div className="border-t border-[rgba(148,163,184,0.08)] px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] text-[rgba(148,163,184,0.68)]">
            {currentDoc?.updatedAt ? `Updated ${new Date(currentDoc.updatedAt).toLocaleString()}` : 'Unsaved draft'}
          </p>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || loading || !currentDoc}
            className="rounded-full border border-[rgba(125,211,252,0.24)] bg-[rgba(8,47,73,0.5)] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgba(191,219,254,0.92)] transition hover:border-[rgba(125,211,252,0.46)] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
        {error ? <p className="mt-2 text-xs text-[rgba(248,113,113,0.86)]">{error}</p> : null}
      </div>
    </aside>
  )
}

function buildProposedMemoryCandidates(tasks: SessionTask[], logs: SessionLogEntry[]) {
  const candidates = new Set<string>()

  tasks
    .filter((task) => !task.parentTaskId)
    .slice()
    .sort((left, right) => new Date(right.updatedAt || right.createdAt).getTime() - new Date(left.updatedAt || left.createdAt).getTime())
    .slice(0, 4)
    .forEach((task) => {
      if (task.status === 'completed' || task.status === 'awaiting_finish') {
        candidates.add(`Task outcome: "${task.description}" reached ${task.status}.`)
      } else if (task.status === 'failed' || task.status === 'error' || task.status === 'interrupted') {
        candidates.add(`Task issue: "${task.description}" ended as ${task.status}.`)
      }
    })

  logs
    .slice()
    .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
    .slice(0, 12)
    .forEach((log) => {
      if (log.level === 'error') {
        candidates.add(`Error note: ${log.message}`)
      }
    })

  return Array.from(candidates).slice(0, 6)
}
