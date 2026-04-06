# Wispr Session Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Wispr-style landing page and a URL-scoped workspace (`/workspace/:sessionId`) where the frontend renders backend-controlled session data in real time.

**Architecture:** Add session-aware backend contracts (REST snapshot + WS subscription), then split the frontend into two routes: marketing landing and operational workspace. Reuse existing agent/task/log modules inside a new right-side workspace shell, with a left session rail driven by backend session APIs.

**Tech Stack:** Next.js 14 (App Router), React 18, Tailwind CSS, Express, ws, Node.js.

---

## File Structure and Responsibilities

- Create: `backend/services/sessionStore.js`
  - In-memory session registry, per-session snapshot APIs, helpers for session-scoped state.
- Create: `backend/routes/sessions.js`
  - `GET /api/sessions` and `GET /api/sessions/:sessionId` endpoints.
- Modify: `backend/server.js`
  - Register sessions router and enforce session-aware WS subscribe/unsubscribe.
- Modify: `backend/routes/tasks.js`
  - Accept `sessionId` on create/update and store tasks by session.
- Modify: `backend/routes/agents.js`
  - Read/update agents by session context.
- Create: `frontend/src/types/session.ts`
  - Session DTO contracts (`SessionSummary`, `SessionSnapshot`, WS payload types).
- Create: `frontend/lib/sessionApi.ts`
  - Session REST fetchers and WS subscription helpers.
- Create: `frontend/components/SessionSidebar.tsx`
  - Left rail session list + route navigation.
- Create: `frontend/components/AgentTeamWorkspace.tsx`
  - Right area orchestrator shell (reusing FlowChart/TaskList/TaskInput/LogViewer/AgentCard).
- Create: `frontend/app/workspace/[sessionId]/page.tsx`
  - Route entry for session-scoped workspace.
- Modify: `frontend/app/page.tsx`
  - Replace current dashboard with Wispr-style landing and `Get Started` CTA.
- Modify: `frontend/app/globals.css`
  - Introduce Wispr-inspired design tokens, typography, and shared utility classes.
- Modify: `frontend/components/TaskInput.tsx`
  - English copy and `sessionId` aware submit callback contract.
- Modify: `frontend/components/TaskList.tsx`
  - English status labels and copy updates.
- Modify: `frontend/components/LogViewer.tsx`
  - English labels/copy updates.
- Modify: `frontend/src/constants/agent.ts`
  - English status labels + keep API/WS base URLs.

---

### Task 1: Add Session Domain Model in Backend

**Files:**
- Create: `backend/services/sessionStore.js`
- Test: `backend/tests/sessionStore.test.js`
- Modify: `backend/package.json`

- [ ] **Step 1: Write the failing test**

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const { createSessionStore } = require('../services/sessionStore')

test('returns seeded sessions and snapshot by id', () => {
  const store = createSessionStore()
  const sessions = store.listSessions()
  assert.ok(sessions.length > 0)
  const snap = store.getSnapshot(sessions[0].id)
  assert.equal(snap.session.id, sessions[0].id)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test tests/sessionStore.test.js`  
Expected: FAIL (`Cannot find module '../services/sessionStore.js'`).

- [ ] **Step 3: Write minimal implementation**

```js
function createSessionStore() {
  const sessions = new Map([
    ['default', { id: 'default', title: 'Default Session', updatedAt: new Date().toISOString() }],
  ])
  return {
    listSessions: () => Array.from(sessions.values()),
    getSnapshot: (id) => ({ session: sessions.get(id) || null, agents: [], tasks: [], logs: [] }),
  }
}
module.exports = { createSessionStore }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --test tests/sessionStore.test.js`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/sessionStore.js backend/tests/sessionStore.test.js backend/package.json
git commit -m "feat(backend): add session store foundation"
```

### Task 2: Expose Session REST Endpoints

**Files:**
- Create: `backend/routes/sessions.js`
- Modify: `backend/server.js`
- Test: `backend/tests/sessions.route.test.js`

- [ ] **Step 1: Write failing route test**

```js
test('GET /api/sessions/:id returns snapshot', async () => {
  const res = await request(app).get('/api/sessions/default')
  assert.equal(res.status, 200)
  assert.ok(Array.isArray(res.body.agents))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test tests/sessions.route.test.js`  
Expected: FAIL (`404` or route missing).

- [ ] **Step 3: Implement sessions router**

```js
router.get('/', (req, res) => res.json({ sessions: sessionStore.listSessions() }))
router.get('/:sessionId', (req, res) => {
  const snapshot = sessionStore.getSnapshot(req.params.sessionId)
  if (!snapshot.session) return res.status(404).json({ error: 'Session not found' })
  res.json(snapshot)
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --test tests/sessions.route.test.js`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/sessions.js backend/server.js backend/tests/sessions.route.test.js
git commit -m "feat(backend): add sessions REST API"
```

### Task 3: Make Task and Agent APIs Session-Aware

**Files:**
- Modify: `backend/routes/tasks.js`
- Modify: `backend/routes/agents.js`
- Modify: `backend/services/sessionStore.js`
- Test: `backend/tests/session-scoped-data.test.js`

- [ ] **Step 1: Write failing session-scope tests**

```js
test('task created in session A is not visible in session B', async () => {
  // create with sessionId=a
  // list with sessionId=b
  // expect not found
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test tests/session-scoped-data.test.js`  
Expected: FAIL (data leaks across sessions).

- [ ] **Step 3: Implement session partitioning**

```js
const sessionId = req.body.sessionId || req.query.sessionId || 'default'
const bucket = sessionStore.ensureSession(sessionId)
bucket.tasks.set(task.id, task)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --test tests/session-scoped-data.test.js`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/tasks.js backend/routes/agents.js backend/services/sessionStore.js backend/tests/session-scoped-data.test.js
git commit -m "feat(backend): scope agents and tasks by session"
```

### Task 4: Add Session-Scoped WebSocket Subscriptions

**Files:**
- Modify: `backend/server.js`
- Test: `backend/tests/ws-session-subscribe.test.js`

- [ ] **Step 1: Write failing WS behavior test**

```js
test('client subscribed to session A does not receive session B events', async () => {
  // connect ws clients for A/B
  // emit B event
  // assert A client gets nothing
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && node --test tests/ws-session-subscribe.test.js`  
Expected: FAIL (global broadcast behavior).

- [ ] **Step 3: Implement subscription map and filtered broadcast**

```js
const clientSubs = new Map() // ws -> sessionId
// on subscribe: clientSubs.set(ws, payload.sessionId)
// broadcast: only send when event.sessionId === clientSubs.get(ws)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && node --test tests/ws-session-subscribe.test.js`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/server.js backend/tests/ws-session-subscribe.test.js
git commit -m "feat(ws): add session-scoped subscriptions"
```

### Task 5: Build Frontend Session Data Layer

**Files:**
- Create: `frontend/src/types/session.ts`
- Create: `frontend/lib/sessionApi.ts`
- Test: `frontend/tests/session-api.test.mjs`

- [ ] **Step 1: Write failing API adapter test**

```js
test('maps /api/sessions/:id payload into SessionSnapshot', async () => {
  // mock fetch and assert shape typing/normalization
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && node --test tests/session-api.test.mjs`  
Expected: FAIL (`Cannot find module '../lib/sessionApi'`).

- [ ] **Step 3: Implement REST + WS adapter**

```ts
export async function fetchSessionSnapshot(sessionId: string): Promise<SessionSnapshot> { /* ... */ }
export function subscribeSession(ws: WebSocket, sessionId: string) {
  ws.send(JSON.stringify({ type: 'subscribe', payload: { sessionId } }))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && node --test tests/session-api.test.mjs`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types/session.ts frontend/lib/sessionApi.ts frontend/tests/session-api.test.mjs
git commit -m "feat(frontend): add session API contracts"
```

### Task 6: Add Workspace Route and Session Sidebar

**Files:**
- Create: `frontend/app/workspace/[sessionId]/page.tsx`
- Create: `frontend/components/SessionSidebar.tsx`
- Create: `frontend/components/AgentTeamWorkspace.tsx`
- Test: `frontend/tests/workspace-route-check.test.mjs`
- Modify: `frontend/components/TaskInput.tsx`
- Modify: `frontend/components/TaskList.tsx`
- Modify: `frontend/components/LogViewer.tsx`
- Modify: `frontend/src/constants/agent.ts`

- [ ] **Step 1: Write failing route smoke test**

```js
test('workspace route file exists and exports default page', async () => {
  // verify app/workspace/[sessionId]/page.tsx contains default export
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && node --test tests/workspace-route-check.test.mjs`  
Expected: FAIL (route missing).

- [ ] **Step 3: Implement workspace shell**

```tsx
<div className="workspace-layout">
  <SessionSidebar sessions={sessions} activeSessionId={sessionId} />
  <AgentTeamWorkspace snapshot={snapshot} sessionId={sessionId} />
</div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && node --test tests/workspace-route-check.test.mjs`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/workspace/[sessionId]/page.tsx frontend/components/SessionSidebar.tsx frontend/components/AgentTeamWorkspace.tsx frontend/components/TaskInput.tsx frontend/components/TaskList.tsx frontend/components/LogViewer.tsx frontend/src/constants/agent.ts frontend/tests/workspace-route-check.test.mjs
git commit -m "feat(frontend): add session workspace route and shell"
```

### Task 7: Replace Home with Wispr-Style Landing and Get Started CTA

**Files:**
- Modify: `frontend/app/page.tsx`
- Modify: `frontend/app/globals.css`
- Test: `frontend/tests/landing-check.test.mjs`

- [ ] **Step 1: Write failing UI expectation test**

```js
test('landing includes Get Started href /workspace/default', () => {
  // expect link href and hero headline
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && node --test tests/landing-check.test.mjs`  
Expected: FAIL (old dashboard still on `/`).

- [ ] **Step 3: Implement landing UI**

```tsx
<section className="hero-wispr">
  <h1>Don’t micromanage. Orchestrate.</h1>
  <Link href="/workspace/default">Get Started</Link>
</section>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && node --test tests/landing-check.test.mjs`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/page.tsx frontend/app/globals.css frontend/tests/landing-check.test.mjs
git commit -m "feat(frontend): ship wispr-style landing page"
```

### Task 8: End-to-End Validation and Regression Check

**Files:**
- Modify (if needed): `frontend/.env.local`
- Modify (if needed): `docs/TEST_GUIDE.md`

- [ ] **Step 1: Run backend startup check**

Run: `cd backend && npm run dev`  
Expected: server starts with `/api/sessions` and `/ws`.

- [ ] **Step 2: Run frontend startup check**

Run: `cd frontend && npm run dev`  
Expected: `/` landing loads; `Get Started` navigates to `/workspace/default`.

- [ ] **Step 3: Validate session switching**

Run (manual):
1. Open `/workspace/default`
2. Click another session in left rail
3. Verify URL changes and right panel data refreshes

Expected: no cross-session state bleed.

- [ ] **Step 4: Validate real-time updates**

Run (manual):
1. Trigger task creation for current session
2. Observe task/log/agent updates via WS

Expected: active session updates only.

- [ ] **Step 5: Commit final polish**

```bash
git add docs/TEST_GUIDE.md frontend/.env.local
git commit -m "chore: verify wispr workspace session flow"
```

---

## Notes

- Keep all changes DRY and YAGNI; do not introduce extra onboarding flows.
- If backend already has equivalent session APIs in another branch/service, adapt `sessionApi.ts` to that contract instead of duplicating routes.
- Maintain readability in operational panels while applying Wispr-inspired visual language.
