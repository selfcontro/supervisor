# Layout Overlap UI Workstream Handoff

Scope: UI Build only. This handoff packages a UI draft, a backend integration stub, and a validation checklist for layout overlap verification without changing product code.

## UI Draft

### Screen structure
- Top bar: session title, connection or hydration status, and current loading, error, or not-found state.
- Left rail: agent roster with live `agent_status` indicators and selection highlight for the active agent.
- Center workspace: primary conversation and log stream showing `log_entry`, `command_execution`, approvals, and task events in chronological order.
- Right panel: collapsible task panel driven by `taskPanelOpen`, showing active tasks, task updates, retry or finish affordances, and blackboard-linked details.
- Bottom composer: prompt composer anchored to the selected agent, with send or dispatch controls and optional task context.
- Realtime layer: initial hydration from `fetchSessionSnapshot`, then websocket deltas for `agent_status`, `task_update`, `task:new`, `log_entry`, `command_execution`, and approvals.

### Interaction details
- Selecting an agent updates the composer target, task context, and detail pane without replacing the global session stream.
- Opening the task panel should preserve the center stream width and avoid pushing the composer out of view.
- Realtime events should append or patch in place instead of reflowing the full layout.
- Loading should use scoped skeletons in roster, stream, and task panel. Error and not-found states should replace only the affected region when possible.
- Actions from `codexControlApi` should stay scoped to the selected task or agent, with inline confirmation for state-changing actions.

### Overlap-risk hotspots
- Composer vs task panel: the fixed bottom composer can collide with the right-side drawer on narrower widths or shorter heights.
- Live event badges: status chips and approval markers can collide with long agent names in dense roster rows.
- Log stream metadata: long command output blocks can crowd timestamps and adjacent gutters.
- Selected-agent header: status pill, selection state, and action buttons can compress into the same row.
- Empty or error overlays: full-page overlays can obscure floating controls if not region-scoped.

### Recommended visual states
- Default: three-column layout with clear gutters, fixed-height composer, and independent scrolling for roster, stream, and task panel.
- Hydrating: subtle skeletons plus a single session-sync banner, not a modal blocker.
- Connected: active status dot and restrained live-update treatment.
- Task active: stronger task-panel emphasis while keeping the center stream readable.
- Error: inline recovery card with retry while preserving as much workspace context as possible.
- Not found: centered empty state with session identifier and fallback navigation, without overlapping persistent controls.

## Backend Stub

### Minimal contract
- No new backend workflow is required for the draft.
- If the UI needs an explicit hook, add an optional snapshot field:
  - `layoutOverlap?: { status, lastCheckedAt, summary, findings, source, message? }`
- Existing snapshot hydration remains unchanged for `agents`, `workflowAgents`, `tasks`, and `logs`.

### Sample snapshot shape
```json
{
  "agents": [],
  "workflowAgents": [],
  "tasks": [],
  "logs": [],
  "layoutOverlap": {
    "status": "idle",
    "lastCheckedAt": null,
    "summary": null,
    "findings": [],
    "source": "ui-draft"
  }
}
```

### Sample result shape
```json
{
  "status": "ok",
  "summary": "No overlaps detected in draft layout.",
  "findings": [
    {
      "id": "overlap-1",
      "severity": "warning",
      "nodeA": "sidebar",
      "nodeB": "canvas",
      "message": "Potential overlap at 1280px width"
    }
  ]
}
```

### Event wiring expectations
- Reuse existing socket events rather than adding a new event type.
- Use `task_update` for overlap-check lifecycle changes.
- Use `log_entry` for diagnostics.
- Use `error` for hard failures.
- If the UI wants simulated progress, include `kind: "layout_overlap_verification"` on relevant `task_update` payloads.

### Failure and loading behavior
- Missing `layoutOverlap` should render as idle or skeleton.
- Empty state should use `status: "idle"` with `findings: []`.
- Failure should surface inline via `layoutOverlap.message` or fallback copy, while leaving the session workspace visible.
- Retry can be a snapshot refresh or reuse existing task retry control flow while backend remains a no-op.

## Validation Checklist

### Responsive viewport checks
- Verify narrow, medium, and wide widths: roster, task list, logs, prompt composer, task detail panel, and flow chart content must remain visible or intentionally collapsible without overlap.
- Check for horizontal overflow when the task panel is open and the flow chart is present.
- Confirm the prompt composer stays anchored and does not cover the task detail panel or live log area on shorter heights.
- Validate that the roster and task panel stack or resize cleanly on mobile and tablet widths.
- Ensure long agent names, task titles, and log lines wrap or truncate without pushing adjacent panels out of bounds.

### State-based overlap checks
- Loading state must not leave skeletons or spinners sitting on top of composer, roster, or task panel.
- Error state must not obscure roster, task list, or flow chart content.
- Not-found state must not overlap persistent chrome or floating controls.
- Sending-prompt and finishing-task states must not create z-index collisions around composer and task actions.
- Selected-agent state must not expand into logs or flow-chart space.
- Task-panel-open state must not cover critical controls unless intentionally modal and dismissible.
- Live websocket updates must not trigger transient overlap during in-place task and agent mutations.

### Realtime and log growth checks
- Append bursts of log lines and confirm the log pane scrolls instead of expanding over neighboring panels.
- Simulate rapid task and agent updates and ensure flow chart and roster remain aligned.
- Verify auto-scroll behavior does not hide the prompt composer or task panel controls.
- Test long-running sessions with sustained log growth for layout drift or clipping.
- Confirm websocket inserts preserve container height limits and scroll boundaries.

### Keyboard and accessibility checks
- Tab through roster, task list, panel controls, composer, and flow interactions with logical, visible focus order.
- Ensure focused elements are never hidden behind overlays, sticky regions, or expanding panels.
- Validate escape-to-close behavior for the task panel or any transient overlay.
- Check screen-reader labels for loading, error, selected agent, and task-panel-open state changes.
- Confirm browser zoom and text scaling do not introduce overlap.

### Acceptance criteria
- No visible overlap between roster, tasks, logs, composer, task detail panel, and flow chart at supported viewport sizes.
- No state transition introduces persistent or flickering clipping, collision, or z-index regressions.
- Live updates can append logs and mutate tasks or agents without breaking containment or scroll behavior.
- Keyboard navigation remains usable across all workspace states.
- Any overlap bug can be reproduced with a specific viewport and state combination.

## Coordinator Notes

- This workstream intentionally stopped at draft-contract-checklist level to respect the design gate and the handed-off scope.
- No product code was modified.
- Most likely implementation pressure points are the fixed bottom composer, the floating task drawer, and dynamic flow/log growth within `AgentTeamWorkspace.tsx`.
