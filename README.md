# Portal

**A spatial operating environment for project context management.**

Portal replaces tab-hopping and folder-diving with a zoomable canvas where projects are spatial territories, files are objects you scatter and organize, and context switches are instant.

---

## Version

**v0.6.1-workspace** — Project workspace mode with toolbar, node dragging, and Miro-style interior view.

See [CHANGELOG.md](./CHANGELOG.md) for full history.

---

## Two views

Portal has two zoom levels that serve different purposes:

**Galaxy (macro)** — All projects as spheres on a zoomable canvas. For organizational context: which projects exist, how active they are, how they relate. Semantic zoom reveals detail as you zoom in.

**Workspace (interior)** — Double-click a project to enter its workspace. Files appear as draggable cards with content previews. Toolbar appears at top. This is where deep work happens: arrange files, open them, annotate with sticky notes (planned). Escape returns to galaxy.

---

## Architecture

```
portal/
├── src/               ← Frontend modules (15 TypeScript files)
│   ├── main.ts        ← Boot + workspace toolbar wiring
│   ├── scene-graph.ts ← SceneNode tree (projects/folders/files)
│   ├── lazy-loader.ts ← On-demand API fetching
│   ├── state.ts       ← AppStateV2 (roots[], activeProject, selected, hovered, drag)
│   ├── placement.ts   ← World-unit positioning, heat-ranked orbit
│   ├── navigation.ts  ← selectNode, enterProject, exitProject, zoomInto, goUp
│   ├── input.ts       ← Zoom, pan, node dragging (workspace mode), click detection
│   ├── renderer.ts    ← Dual-mode: galaxy renderer + workspace renderer
│   ├── hud.ts         ← Breadcrumb, context-sensitive hints
│   ├── file-window.ts ← HTML overlay windows for file preview
│   ├── content-cache.ts ← Text/image preview cache
│   ├── api.ts         ← Hub API client + position persistence
│   ├── colors.ts      ← Color utilities
│   ├── math.ts        ← Math utilities
│   └── types.ts       ← Camera + Mouse types
├── packages/
│   ├── core/          ← Data model, graph ops, persistence, heat engine
│   ├── layouts/       ← Pluggable organization strategies
│   ├── physics/       ← Force solver, seeding, reusable force primitives
│   ├── triage/        ← AI-assisted organization (stub)
│   ├── vault/         ← File ingest, hash-based dedup
│   └── hub/           ← Fastify server + SQLite (sole DB writer)
├── index.html         ← Canvas + toolbar + HUD
├── vite.config.js
├── CHANGELOG.md
├── ROADMAP.md
├── STATUS.md
├── DECISIONS.md
├── COMMANDS.md
└── README.md
```

### Package dependency graph

```
core ← layouts ← src/placement
core ← physics ← layouts
core ← triage
core ← hub
core ← vault ← hub
src/ → hub (via API calls to :3141)
```

No circular dependencies. Core imports nothing. Everything else imports core.

### Key design decisions

1. **Nodes and Edges are the universal primitives.** Everything is a graph.
2. **Unified scene graph.** Projects, folders, and files are all SceneNodes in one tree. No dual-mode state machine.
3. **Semantic zoom.** Detail emerges as you zoom in — skip, dot, shape, children, lazy load.
4. **Heat-driven placement.** Active files orbit near center, cold files in compressed outer belt. Score 0–100 per node.
5. **Layouts are pluggable.** Adding a new organization mode = one file implementing `LayoutStrategy`.
6. **Hub is sole DB writer.** All clients go through hub endpoints.
7. **Workspace is a state flag, not a separate page.** Same canvas, camera, renderer — different render branch and input behavior.
8. **The AI layer is a downstream consumer.** It reads events and suggests. It never acts autonomously.

---

## Running Portal

The easiest way is the launcher: double-click **`portal-launcher.bat`** in the project root.

Or manually:

```bash
# Terminal 1: Start hub server
npx tsx packages/hub/src/server.ts

# Terminal 2: Start UI dev server
npm run dev:ui

# Then open http://localhost:5173
```

Hub runs on port 3141, UI on port 5173. See [COMMANDS.md](./COMMANDS.md) for full reference.

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (strict) |
| Desktop shell | Tauri v2 |
| API server | Fastify on :3141 |
| Database | SQLite (WAL mode) |
| Renderer | HTML5 Canvas (→ WebGL later) |
| Build | Vite |
| Browser bridge | Chromium extension (future) |

---

## Data model

### Scene graph

```
Root (galaxy)
├── Project A (sphere)  ← double-click to enter workspace
│   ├── Folder X        ← draggable in workspace
│   │   ├── file1.ts    ← draggable card with content preview
│   │   └── file2.md
│   └── file3.pdf
└── Project B (sphere)
    └── ...
```

All SceneNodes. Lazy-loaded. World-unit coordinates. Heat score determines orbit radius within parent.

### Heat tiers

| Tier | Score | Behavior |
|------|-------|----------|
| Active | 70–100 | Near center, full opacity, large |
| Reference | 40–69 | Mid-orbit, normal size |
| Dormant | 15–39 | Outer belt, reduced opacity |
| Cold | 0–14 | Compressed outer ring, small, faded |

### Event stream

Every user action emits an event with a `session_id` that groups related events atomically.

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
