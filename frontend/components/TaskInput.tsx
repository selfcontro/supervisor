'use client'

import { useEffect, useId, useRef, useState } from 'react'

interface TaskInputProps {
  sessionId: string
  onSend: (task: string, sessionId: string) => Promise<void> | void
}

export default function TaskInput({ sessionId, onSend }: TaskInputProps) {
  const inputId = useId()
  const [input, setInput] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sessionIdRef = useRef(sessionId)
  const requestTokenRef = useRef(0)

  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])

  const handleSubmit = async () => {
    const trimmed = input.trim()
    if (!trimmed || isSubmitting) {
      return
    }

    const submitSessionId = sessionId
    const requestToken = requestTokenRef.current + 1
    requestTokenRef.current = requestToken
    setIsSubmitting(true)
    setError(null)

    try {
      await onSend(trimmed, submitSessionId)

      if (sessionIdRef.current !== submitSessionId || requestTokenRef.current !== requestToken) {
        return
      }

      setInput('')
    } catch (submitError) {
      if (sessionIdRef.current !== submitSessionId || requestTokenRef.current !== requestToken) {
        return
      }

      setError(submitError instanceof Error ? submitError.message : 'Failed to submit task.')
    } finally {
      if (sessionIdRef.current !== submitSessionId || requestTokenRef.current !== requestToken) {
        return
      }

      setIsSubmitting(false)
    }
  }

  return (
    <div className="panel frame-surface frame-muted rounded-2xl p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="edge-label">Create Task</p>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">Submit directly into the active session.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="signal-dot bg-[#67e8f9]" />
          <span className="soft-pill">{sessionId}</span>
        </div>
      </div>

      <div className="flex flex-col gap-2.5 sm:flex-row">
        <label htmlFor={inputId} className="sr-only">
          Task description for session {sessionId}
        </label>
        <input
          id={inputId}
          type="text"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              void handleSubmit()
            }
          }}
          placeholder="Describe the next task for this session"
          className="input flex-1 text-sm"
          disabled={isSubmitting}
        />
        <button
          onClick={() => void handleSubmit()}
          disabled={isSubmitting || !input.trim()}
          className="btn-primary whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting ? 'Sending...' : 'Send Task'}
        </button>
      </div>

      {error ? <p className="mt-3 text-sm text-[var(--danger)]">{error}</p> : null}
    </div>
  )
}
