# Supervisor

Minimal session-scoped workspace for visualizing and driving a Codex-backed agent workflow.

The project is split into a Next.js frontend and an Express/WebSocket backend. The frontend now focuses on a dark, graph-first workspace. The backend owns session state, task state, websocket broadcasting, and Codex control routes.

## Current Product Shape

- Landing page routes users into `/workspace/default`
- Workspace is intentionally minimal:
  - full-screen dark `Flow Graph`
  - in-graph controls (`Reset layout`, zoom, fit view)
  - compact floating task list
- Backend sessions are exposed over REST and kept live over WebSocket
- Codex control endpoints can dispatch team-style tasks through `agent-main`

## Repo Structure

- `frontend/`: Next.js 14, React 18, TypeScript, Tailwind, React Flow
- `backend/`: Express API, WebSocket server, session/task state, Codex orchestration
- `docs/`: notes, design docs, manual verification material

## Local Development

### Prerequisites

- Node.js 18+
- npm

### Install dependencies

```bash
cd frontend && npm install
cd ../backend && npm install
```

### Environment

Backend: `backend/.env`

```env
OPENAI_API_KEY=your_api_key_here
# Optional: custom OpenAI-compatible endpoint. Leave unset for OpenAI default.
# OPENAI_BASE_URL=https://your-openai-compatible-endpoint/v1
# Optional aliases (also supported by backend):
# CODEX_API_KEY=your_api_key_here
# CODEX_BASE_URL=https://your-openai-compatible-endpoint/v1
# Optional Codex binary/path control:
# CODEX_BIN=codex
# CODEX_CWD=/absolute/path/to/workspace
PORT=3001
```

Frontend: `frontend/.env.local`

```env
NEXT_PUBLIC_API_URL=http://127.0.0.1:3001
NEXT_PUBLIC_WS_URL=ws://127.0.0.1:3001
```

### Start backend

```bash
cd backend
npm start
```

Backend listens on `http://127.0.0.1:3001`.

### Start local bridge for the Vercel frontend

```bash
cd backend
npm run bridge
```

Expected local bridge checks:

```bash
curl http://127.0.0.1:3001/health
curl http://127.0.0.1:3001/api/sessions/default
```

The bridge also exposes:

```text
ws://127.0.0.1:3001/ws
```

### Start frontend

```bash
cd frontend
npm run dev
```

Frontend listens on `http://127.0.0.1:3000`.

Open:

```text
http://127.0.0.1:3000/workspace/default
```

Public frontend flow:

- Deploy `frontend` to Vercel
- Open `/connect-local-codex`
- Start the local bridge with `cd backend && npm run bridge`
- Save `http://127.0.0.1:3001` as the browser endpoint override
- Open `/workspace/default`

## Main Routes

### Frontend

- `/`
- `/workspace/default`
- `/workspace/:sessionId`

### Backend

- `GET /health`
- `GET /api/sessions`
- `GET /api/sessions/:sessionId`
- `POST /api/tasks`
- `POST /api/codex-control/sessions/:sessionId/agents`
- `POST /api/codex-control/sessions/:sessionId/agents/:agentId/tasks`
- `POST /api/codex-control/sessions/:sessionId/agents/:agentId/interrupt`
- `POST /api/codex-control/sessions/:sessionId/agents/:agentId/resume`
- `POST /api/codex-control/sessions/:sessionId/agents/:agentId/tasks/:taskId/retry`
- `POST /api/codex-control/sessions/:sessionId/agents/:agentId/close`
- `WS /ws`

## Verification

Frontend production build:

```bash
cd frontend
npm run build
```

Backend tests:

```bash
cd backend
npm test
```

Single backend test file:

```bash
cd backend
node --test tests/codex-session-sync.test.js
```

## Notes

- Runtime blackboard artifacts are stored under `backend/backend/data/blackboard/sessions/`
- The frontend workspace is intentionally sparse; operational panels from earlier dashboard-style versions have been removed
- If Next.js dev cache becomes corrupted, the usual recovery is:

```bash
rm -rf frontend/.next
cd frontend
npm run dev
```
