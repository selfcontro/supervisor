# Wispr-Style Frontend with URL-Scoped Session Workspace Design

Date: 2026-04-03
Status: Approved in chat, pending implementation

## 1. Objective

Redesign the frontend into a hybrid product experience:

- A Wispr Flow-inspired marketing landing page (`/`)
- A direct jump to a real workspace (`/workspace/:sessionId`)
- Workspace layout with:
  - Left: session selection
  - Right: full agent-team operating interface

Session state is backend-controlled. Frontend does not own session orchestration logic.

## 2. User-Confirmed Decisions

- Visual direction: Wispr Flow style language
- Content language: English
- Rewrite scope: Full landing rewrite
- Existing core modules to keep: all current modules
- Navigation: no intermediate session onboarding page
- Session authority: backend persistence and control
- URL strategy: `/workspace/:sessionId`
- Data protocol:
  - REST initial snapshot: `GET /api/sessions/:sessionId`
  - WebSocket subscribe by session: `{"type":"subscribe","payload":{"sessionId":"..."}}`

## 3. Scope

### In Scope

- New landing page structure and styling
- New workspace route with split layout (session rail + agent-team console)
- Route-driven session switching
- Session-scoped REST bootstrap and WS incremental updates
- Existing task/agent/log/flow components reused inside workspace

### Out of Scope

- Frontend-local session persistence model
- Redesigning backend business logic for agent execution
- Adding a separate guided onboarding/session wizard page

## 4. Information Architecture

### Route Map

- `/`
  - Marketing/brand narrative in Wispr style
  - Primary CTA: `Get Started`
  - CTA target: `/workspace/:defaultSessionId`
- `/workspace/[sessionId]`
  - Left rail: session list
  - Right content: existing agent-team control surface

### Navigation Behavior

- Clicking a session in left rail updates URL (`router.push('/workspace/' + id)`)
- Route param change triggers:
  1. Initial data reload via REST
  2. WS re-subscribe for new session
  3. Old session subscription cleanup

## 5. Visual Design System (Wispr-Inspired)

### Core Style Tokens

- Background primary: warm cream tone
- Ink primary: near-black
- Accent CTA: light lavender
- Section contrast blocks: deep charcoal / deep teal
- Corner system: large rounded geometry (12 / 24 / 40 / 64 / 80 scale)

### Typography

- Editorial display face for hero and major section headers
- Clean sans-serif for utility text, controls, data-heavy modules
- Strong size contrast between marketing narrative and operational console

### Motion and Interaction

- Subtle transform + opacity transitions (0.2s to 0.35s)
- CTA hover compression (`scale(0.98)`)
- Avoid heavy micro-animations inside operational panels to preserve readability

## 6. Data and State Design

### Backend Contracts (Expected)

- `GET /api/sessions`
  - Returns session summaries for left rail
- `GET /api/sessions/:sessionId`
  - Returns workspace snapshot:
    - agents
    - tasks
    - logs
    - optional metadata
- WS `subscribe` payload includes `sessionId`
- WS events are session-scoped for:
  - `agent_status`
  - `task_update`
  - `task:new`
  - `log_entry`

### Frontend State Model

- `currentSessionId` from route param
- `sessions[]` from backend list
- `agents[]`, `tasks[]`, `logs[]` from active session snapshot + WS diffs
- Connection state: `connected | disconnected | reconnecting`

### Update Rules

- REST snapshot is source of truth on route entry
- WS only mutates active session state
- Ignore WS events that do not match current session
- Task creation requests include current session id

## 7. Component Layout Plan

### Landing (`/`)

- Hero block with editorial headline, supporting copy, and `Get Started`
- Product-story sections (alternating light/dark narrative rhythm)
- Trust/social proof region
- Final CTA strip to workspace

### Workspace (`/workspace/[sessionId]`)

- Left rail:
  - Session list
  - Active session highlight
  - Optional quick create/jump actions
- Right main:
  - Existing Team/Flow/Task/Log UI modules retained
  - Rearranged for visual hierarchy consistency
  - Existing interaction behavior preserved

## 8. Error Handling

- Session not found (`404`): workspace-level empty/error state + link back to home
- REST failure: show non-destructive error state; allow retry
- WS disconnect: keep last known state, show disconnect badge, auto-reconnect
- Subscribe failure: show session-level warning with retry action

## 9. Testing Strategy

### UI and Routing

- Route transitions:
  - `/` -> `/workspace/:id`
  - session A -> session B
- Left rail active state matches route param

### Data Flow

- Snapshot load success/failure
- WS subscribe/unsubscribe on route change
- Event handling correctness by session scope

### Regression

- Existing modules remain functional:
  - Task input
  - Task list updates
  - Agent status updates
  - Flow chart rendering
  - Log viewer updates

## 10. Implementation Risks and Mitigations

- Risk: backend does not yet expose complete session endpoints
  - Mitigation: frontend contract adapter layer; graceful fallback UI
- Risk: WS emits global (not session-scoped) events
  - Mitigation: include and enforce `sessionId` filtering on client
- Risk: visual branding harms operational readability
  - Mitigation: confine high-expression style to narrative containers, keep console clarity-focused

## 11. Execution Summary

Recommended implementation order:

1. Add route structure (`/` + `/workspace/[sessionId]`)
2. Build session-aware data hooks (REST + WS lifecycle)
3. Integrate existing modules into workspace shell
4. Apply Wispr-inspired theme tokens and section composition
5. Validate route/data/error flows and responsive behavior
