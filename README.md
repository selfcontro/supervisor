# Supervisor

Session-scoped control surface for a three-agent team: planner, executor, and reviewer.

The repo is split into a Next.js frontend and an Express backend. The frontend provides a dark control-room UI for session navigation, task submission, flow visualization, and live logs. The backend exposes REST and WebSocket endpoints, stores session state, and proxies Codex control operations.

## Structure

- `frontend/`: Next.js 14, React 18, TypeScript, Tailwind CSS, React Flow
- `backend/`: Express, WebSocket server, session/task routes, Codex control routes
- `docs/`: PRD and manual test notes

## What The App Does

- Opens directly into a session-specific workspace at `/workspace/:sessionId`
- Hydrates the workspace from the session API, then stays live through WebSocket updates
- Shows the planner, executor, and reviewer pipeline in a single flow graph
- Lets operators create tasks, inspect logs, switch sessions, and interact with Codex agent controls

## Local Setup

### Prerequisites

- Node.js 18+
- npm

### 1. Install dependencies

```bash
cd frontend && npm install
cd ../backend && npm install
```

### 2. Configure environment

Backend uses `backend/.env`:

```env
CODEX_API_KEY=your_api_key_here
PORT=3001
```

Frontend uses `frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://127.0.0.1:3001
NEXT_PUBLIC_WS_URL=ws://127.0.0.1:3001
```

### 3. Start the backend

```bash
cd backend
npm run dev
```

Backend listens on `http://localhost:3001`.

### 4. Start the frontend

```bash
cd frontend
npm run dev
```

Frontend listens on `http://localhost:3000`.

Open `http://localhost:3000/workspace/default`.

## Key Routes

### Frontend

- `/`: landing page
- `/workspace/default`: default operator workspace
- `/workspace/:sessionId`: session-scoped control surface

### Backend

- `GET /health`
- `GET /api/sessions`
- `GET /api/sessions/:sessionId`
- `POST /api/tasks`
- `GET /api/agents`
- `POST /api/codex-control/*`
- `WS /ws`

## Verification

Run the frontend production build:

```bash
cd frontend
npm run build
```

Run backend tests:

```bash
cd backend
npm test
```

Note: the backend currently exposes tests under `backend/tests/`, but `package.json` does not yet define a `test` script. Add one before relying on the command above in CI.

## Runtime Data

The blackboard files under `backend/backend/data/blackboard/sessions/` are runtime session artifacts. They are useful for local inspection, but they should not be treated as durable seeded content for the default session unless the session-level and per-agent views are intentionally kept in sync.
