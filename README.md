# Portal

**A spatial operating environment for project context management.**

Portal replaces tab-hopping and folder-diving with a zoomable canvas where projects are spatial territories, files are objects you scatter and organize, and context switches are instant.

---

## Version

**v0.1.0-foundation** — Architecture & data model only. No running app yet.

See [CHANGELOG.md](./CHANGELOG.md) for full history.

---

## Architecture

```
portal/
├── packages/
│   ├── core/          ← Data model, graph ops, persistence, entropy
│   ├── layouts/       ← Pluggable organization strategies
│   ├── physics/       ← Force solver, seeding, reusable force primitives
│   ├── triage/        ← AI-assisted organization (stub)
│   ├── renderer/      ← Canvas drawing (TODO)
│   └── hub/           ← Fastify + SQLite server (TODO)
├── CHANGELOG.md
├── ROADMAP.md
└── README.md
```

### Package dependency graph

```
core ← layouts ← renderer
core ← physics ← layouts
core ← triage
core ← hub
```

No circular dependencies. Core imports nothing. Everything else imports core.

### Key design decisions

1. **Nodes and Edges are the universal primitives.** Everything is a graph.
2. **Layouts are pluggable.** Adding a new organization mode = one file implementing `LayoutStrategy`.
3. **Physics is optional per layout.** Some layouts use forces (orbit, free). Some don't (grid).
4. **Transient state is separate from persisted state.** Physics velocities live in memory. Positions live in SQLite.
5. **Entropy is computed, not stored.** The meter reads the graph and returns a score.
6. **The AI layer is a downstream consumer.** It reads events and suggests. It never acts autonomously.

---

## Packages

### `core/`
The foundation. Every other package imports from here.

| File | Purpose |
|------|---------|
| `types.ts` | Node, Edge, Project, Event, Snapshot, EntropyMetrics, ArtifactGroup, LaunchAction |
| `graph.ts` | Pure functions: add/remove/link nodes, assign to projects, compute entropy, query relationships |
| `persistence.ts` | SQLite schema (WAL mode), row ↔ domain conversion, `hydrateGraph()` |

### `layouts/`
Pluggable organization strategies. Each implements the `LayoutStrategy` interface.

| File | Strategy | Physics? | Purpose |
|------|----------|----------|---------|
| `types.ts` | — | — | `LayoutStrategy` interface, `LayoutRegistry`, `LayoutBody`, `LayoutConfig` |
| `free.ts` | Free | Yes | Manual scatter workbench. Drag and drop. Positions persist. |
| `orbit.ts` | Orbit | Yes | Recency rings. Files pushed outward by last-used time. Core exclusion. |
| `grid.ts` | Grid | No | Auto-arrange by type, name, or date. Static snap. |

**To add a new layout:**
```typescript
import type { LayoutStrategy } from "./types";

export const myLayout: LayoutStrategy = {
  name: "my-layout",
  label: "My Layout",
  usesPhysics: false,
  computePositions(nodes, edges, config) {
    // Return Record<NodeId, { x, y }>
  },
};

// Then register it:
registry.register(myLayout);
```

### `physics/`
Layout-agnostic force simulation. Layouts compose these primitives.

| File | Purpose |
|------|---------|
| `forces.ts` | Primitive force functions: `springAttraction`, `pairRepulsion`, `coreExclusion`, `boundaryConstraint`, `springLink`, `centerGravity` |
| `solver.ts` | Generic integrator: bodies + forces → new positions. Handles damping, velocity cap, sleep detection. |
| `seeding.ts` | Deterministic initialization from hashes. Zero `Math.random()`. `seedSpheres`, `seedFiles`. |

### `triage/`
AI-assisted organization layer. Phase 1 is manual; Phase 2 adds AI suggestions.

| File | Purpose |
|------|---------|
| `types.ts` | `TriageEngine` interface, `TriageSuggestion`, `LocalTriageEngine` stub |

### `renderer/` (TODO — v0.2.0)
Canvas drawing. Consumes layouts + physics, renders to HTML5 Canvas or WebGL.

### `hub/` (TODO — v0.2.0)
Fastify server + SQLite. Uses `core/persistence.ts` schema. REST API for the Tauri frontend.

---

## Data model

### Node states (entropy)

```
unassigned → assigned → organized
                ↓
              stale (after N days without interaction)
```

### Entropy meter

```
score = (unassigned × 1.0 + stale × 0.6 + assigned × 0.3) / total_nodes
```

Score 0 = fully organized. Score 1 = chaos. Threshold 0.3 = triage prompt.

### Event stream

Every user action emits an event with a `session_id` that groups related events atomically.

```
session_id: "abc-123" → project_exit(A)
session_id: "abc-123" → snapshot_saved(A)
session_id: "abc-123" → project_enter(B)
session_id: "abc-123" → project_launched(B)
```

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (strict) |
| Desktop shell | Tauri |
| API server | Fastify |
| Database | SQLite (WAL mode) |
| Renderer | HTML5 Canvas (→ WebGL later) |
| Browser bridge | Chromium extension (Phase 3) |

---

## Setup (when app scaffold exists)

```bash
git clone <repo>
cd portal
npm install
npm run dev        # starts hub + renderer
npm run tauri dev  # starts desktop app
```

---

## SQLite pragmas (set on every connection)

```sql
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA busy_timeout=5000;
```

All state lives in `~/.portal/portal.db`. Delete the file to reset. No system hooks, no OS modifications.

---

## Contributing

This is a solo project by J.A. / Altigad. Architecture discussions happen in Claude conversations. The codebase is the source of truth.
