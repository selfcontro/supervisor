# Layout Overlap Verification Checklist

Scope: validate the agent-team workspace for the split workstream shape `task-breakdown -> ui-build/backend-integration/primary-build/validation-sweep -> quality-gate`, with emphasis on node spacing and panel overlap regressions.

## Automated evidence

- Backend regression suite passes with `node --test tests/*.test.js` on 2026-04-15.
- Existing flow-layout regression coverage lives in `../frontend/lib/flowLayout.test.js`.
- Current layout guards already assert:
  - coordinator to breakdown vertical gap is at least `280`
  - breakdown to worker vertical gap is at least `260`
  - worker to review vertical gap is at least `260`
  - parallel workers do not share the same `x`
  - separate task groups stay at least `600`px apart horizontally

## Validation checklist

- Verify `validation-sweep` appears as a worker-stage agent in session markdown and task cards beside `ui-build`, `backend-integration`, and `primary-build`.
- Verify long-task dispatch still creates the full worker set before `quality-gate`.
- Verify the workspace flow graph keeps breakdown, worker, and review nodes visually separated for a 4-worker team.
- Verify the detail drawer does not cover critical flow content on desktop when selecting a worker node.
- Verify the task composer panel opening/closing does not shift the flow graph into overlapping the sidebar or detail drawer.
- Verify separate workflow groups remain horizontally separated when multiple long tasks exist in one session.
- Verify log growth and live task updates do not re-stack workflow nodes onto the same coordinates after realtime refresh.

## Manual QA path

1. Start backend and frontend runtimes.
2. Open `/workspace/default`.
3. Dispatch a long task mentioning UI, backend, validation, and parallel team work.
4. Confirm the graph shows `Task Breakdown`, multiple worker duties including `Validation Sweep`, then `Quality Gate`.
5. Select each worker node and confirm the right-side detail panel does not hide the node stack so badly that stage order becomes unreadable.
6. Toggle the task input panel and confirm no sidebar/graph/detail-panel overlap appears at common desktop widths.
7. Repeat with a second long task to confirm adjacent workflow groups still have horizontal separation.

## Known blocker

- `npm run build` in `../frontend` is not currently verifiable inside this sandbox because Next.js fails opening `../frontend/.next/trace` with `EPERM`. This is an environment write-permission issue, not a confirmed application build regression.

## Handoff

- Validation status: backend orchestration coverage is green; frontend overlap protection exists at the layout-unit-test level; browser-level confirmation is still required for drawer/panel overlap behavior.
- Recommended next check for coordinator: run the frontend build or live UI pass in an environment that can write to `../frontend/.next`, then execute the manual QA path above.
