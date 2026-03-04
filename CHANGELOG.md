# Changelog

All notable changes to Portal are documented here.

Format: [Semantic Versioning](https://semver.org/) with build phases. Portal is in beta — phase names and scope shift as the interface takes shape. This log tracks what actually shipped, not what was planned.

---

## [0.6.1-workspace] — 2026-03-01

**Project workspace mode — Miro-style interior view**

### Added
- **Workspace mode** — Double-click a project sphere to enter a dedicated workspace view. `activeProject` state flag drives the mode switch. Escape or toolbar button exits back to galaxy.
- **Toolbar** — HTML overlay bar at top of viewport when inside a project workspace. Shows project name, color dot, item count, and action buttons (Open, Auto-arrange, Galaxy exit).
- **Node dragging** — In workspace mode, mousedown on any child node (file or folder) initiates drag. Nodes move in world-space, positions saved to hub via `PUT /positions/workspace` on drag-end.
- **Workspace renderer** — Dedicated background (subtle radial gradient in project color), dashed project boundary ring, drag indicator (highlight ring around node being moved).
- **Position persistence API** — `saveNodePosition()` and `fetchPositions()` in api.ts. Uses existing `/positions/:layout` hub endpoints.
- **`moveNode()` API** — Frontend wrapper for `PUT /nodes/:id/move` to re-parent nodes between projects.

### Changed
- **`state.ts`** — Added `activeProject`, `dragNode`, `dragOffsetX`, `dragOffsetY` to `AppStateV2`.
- **`navigation.ts`** — Added `enterProject()`, `exitProject()`, `onEnterProject()`, `onExitProject()` callbacks. `zoomInto()` now routes to `enterProject()` for project/folder targets. `goUp()` handles workspace exit and folder-up navigation.
- **`input.ts`** — Workspace mode: mousedown on node starts drag (not pan). Drag-end saves position. Single click selects without auto-centering camera. Zoom always cursor-centered in workspace.
- **`renderer.ts`** — Render loop branches: workspace mode renders only active project's children with workspace background. Galaxy mode unchanged.
- **`hud.ts`** — Workspace-aware hints. Galaxy HUD elements hidden when toolbar is active.
- **`main.ts`** — Wires toolbar DOM, `onEnterProject`/`onExitProject` callbacks, toolbar button actions.
- **`index.html`** — Added toolbar HTML, workspace-active CSS class for layout shifts.

### Removed
- 24 duplicate "Copy" files cleaned from repo root.

### Architecture
- Workspace mode is a state flag, not a separate page. Same canvas, camera, renderer — just different render branch and input behavior (D-076).

---

## [0.6.0-scene-graph] — 2026-02-28

**Unified scene graph + semantic zoom (Stellaris-style)**

### Added
- **`src/scene-graph.ts`** — `SceneNode` interface unifying projects, folders, and files into a single tree. `hitTest()` for world-space click detection, `getAncestorChain()` for breadcrumbs, `findNode()` for tree search.
- **`src/lazy-loader.ts`** — On-demand API fetching: children loaded only when parent's screen-space radius exceeds 40px. Caches in scene graph. No prefetching.
- **Semantic zoom renderer** — Recursive `renderNode()` with detail thresholds: <2px skip, <8px dot, <30px no children, ≥30px children visible, ≥40px lazy load trigger. Single render pass replaces dual galaxy/solar-system modes.
- **Selection ring** — Pulsing white ring with 4 rotating directional arrows around selected node.
- **Loading indicator** — Three rotating dots shown while a node's children are being fetched.
- **Minimap** — Bottom-right minimap showing project positions and camera viewport.

### Changed
- **`src/state.ts`** — Replaced `AppState` with `AppStateV2`: `roots: SceneNode[]`, `selectedNode`, `hoveredNode`. Removed `focusedProject`, `navStack`, `sunLabel`, `spheres[]`, `currentChildren[]`, `hoveredItem`, `selectedItem`, `selectedType`.
- **`src/placement.ts`** — World-unit placement. `placeProjectsInGalaxy()` positions root projects. `placeChildrenInWorld()` places children relative to parent center/radius. Files orbit at 15–55% of parent radius (by heat rank), folders at 80%.
- **`src/navigation.ts`** — `selectNode()` + `zoomInto()` + `goUp()` replace `enterProject()`/`enterFolder()`/`goBack()`. No coordinate resets. Camera smoothly moves to selected node.
- **`src/input.ts`** — Continuous zoom (0.08–20x) with cursor-centered zoom (Miro-style). `hitTest()` for click detection. No enter/exit zoom thresholds.
- **`src/hud.ts`** — Breadcrumb derived from `getAncestorChain()` on selected node instead of `navStack`. Clickable ancestors.
- **`src/main.ts`** — Boot: fetchProjects → placeProjectsInGalaxy → buildProjectNodes → state.roots.
- **`src/types.ts`** — Stripped to Camera + Mouse only. Dead types removed.

### Architecture
- Unified scene graph (D-073) replaces binary galaxy/solar-system state machine
- World-unit coordinate system (D-074) replaces screen-pixel placement
- Lazy loading (D-075) enables infinite depth without upfront data fetching

---

## [0.5.0-restructure] — 2026-02-27

**Frontend modularized to TypeScript + heat integration**

### Added
- **`src/` modular frontend** — 11 TypeScript modules replace monolithic `dist/main.js`. Modules: types, state, api, colors, math, placement, navigation, input, renderer, hud, main. Zero circular dependencies.
- **Vite build pipeline** — `src/main.ts` compiles via Vite with `@core`, `@layouts`, `@physics` path aliases. Root `index.html` with `<script type="module">`.
- **Heat integration in hub** — `server.ts` seeds `heat_metadata` from mtime, recalculates on project entry, caches scores in `heat_scores`, LEFT JOINs into children queries.
- **Heat-driven orbit** — `placement.ts` maps heat score (0–100) to orbit radius. Active files orbit near center, cold files in compressed outer belt. Tier-driven opacity and size scaling.
- **Click-to-select model** — Single click selects and centers camera. Scroll-to-enter (zoom past threshold enters selected item). Scroll-to-exit (zoom out past threshold goes back). Double-click = instant enter/open.
- **New hub endpoints** — `GET /projects/:id/heat`, `POST /heat/recalc/:projectId`, `PUT /nodes/:id/pin`, `PUT /nodes/:id/promote`.

### Changed
- `vite.config.js` — root changed from `dist/` to `.`, added resolve aliases
- `tsconfig.json` — added baseUrl, paths, unified include for src/ + packages/
- `index.html` — moved to root, script tag changed to `type="module" src="/src/main.ts"`

### Architecture
- Callback injection pattern (D-070) breaks navigation ↔ hud circular dependency
- `dist/main.js` preserved as reference but no longer served by Vite

---

## [0.4.0-heat] — 2026-02-27

**Heat scoring engine**

### Added
- **`core/heat-types.ts`** — Heat score types: tiers (active/reference/dormant/cold), weight profiles, decay config, tier thresholds, metadata signals. Score is a 0–100 scalar per node.
- **`core/heat.ts`** — Pure heat computation engine. Weighted-sum scoring (not multiplicative), clamped 0–100, O(N) update, O(N log N) sort. Recalculated on triggers (session start, project entry, background tick), not continuously.
- **`core/heat-persistence.ts`** — Heat schema extension: `heat_metadata`, `heat_scores`, `heat_profiles` tables. Runs after main schema. All writes through hub (D-003).

### Design notes
- Heat drives orbit ring placement, visibility priority, compression eligibility, and tier assignment
- Weight profiles are swappable at runtime (config, not code)
- Background decay updates scores only, never positions
- Inner ring + workspace positions are sacred (user-placed)

---

## [0.3.0-hub] — 2026-02-26 / 2026-02-27

**Hub server, vault, canvas wired to real data**

### Added
- **`hub/server.ts`** — Fastify hub server, sole DB writer. Original 11 endpoints plus v0.4.0 additions: `/ingest/folder` (preserves hierarchy), `/nodes/:id/children`, `/settings`, `/open` (OS default app).
- **`hub/logger.ts`** — System logger: buffered writes → SQLite `system_events` table + file logs, diagnostic report generation.
- **`vault/vault.ts`** — File ingest: copy to `~/.portal/vault/{sha256}.{ext}`, hash-based dedup, cheap metadata extraction (type, size, dates, word count).
- **`core/persistence.ts`** — Updated schema: `vault_files`, `file_metadata`, `system_events`, `layout_positions` tables.
- Canvas connected to hub API with 6 real projects ingested.
- Windows launcher script (`portal-launcher.bat`) and shortcut.

---

## [0.2.0-scaffold] — 2026-02-26

**Tauri desktop shell**

### Added
- Tauri v2 project scaffold (`src-tauri/`)
- Monorepo workspace setup (`packages/`)
- Vite build config
- Gold test sphere renders on Canvas — app compiles and runs

---

## [0.1.0-foundation] — 2026-02-25

**Architecture & data model**

### Added
- **`core/types.ts`** — Complete data model: Node, Edge, Project, Event, Snapshot, EntropyMetrics, ArtifactGroup, LaunchAction, EntropyState
- **`core/graph.ts`** — Pure graph operations: add/remove/link nodes and edges, assign nodes to projects, compute entropy, query helpers
- **`core/persistence.ts`** — SQLite schema with WAL mode, indexes, row ↔ domain conversion, `hydrateGraph()`
- **`layouts/types.ts`** — `LayoutStrategy` interface, `LayoutRegistry`, `LayoutBody`, `LayoutConfig`
- **`layouts/free.ts`** — Free layout: scatter workbench with boundary constraint, collision avoidance, core exclusion
- **`layouts/orbit.ts`** — Orbit layout: recency rings, hash-anchored stable angles, configurable buckets
- **`layouts/grid.ts`** — Grid layout: auto-arrange by type/name/date, static positioning, no physics
- **`physics/forces.ts`** — Force primitives: spring, repulsion, core exclusion, boundary, gravity, link, sum
- **`physics/solver.ts`** — Generic force integrator with damping, velocity cap, sleep detection
- **`physics/seeding.ts`** — Deterministic initialization from node ID hashes. Zero Math.random()
- **`triage/types.ts`** — TriageEngine interface, TriageSuggestion types, LocalTriageEngine stub

### Design decisions locked
- Graph-first data model (D-001)
- Core imports nothing (D-002)
- Hub is sole DB writer (D-003)
- Monorepo with packages/ (D-004)
- SQLite WAL mode (D-005)
- Positions in separate table (D-010)
- Vault files immutable (D-011)
- Entropy computed not stored (D-012)
- Layouts are pluggable strategies (D-020)
- Physics optional per layout (D-021)
- Transient state never persisted (D-022)
- Deterministic seeding (D-023)

---

## Version numbering

```
MAJOR.MINOR.PATCH-phase

0.1.0-foundation    Architecture & data model
0.2.0-scaffold      Tauri desktop shell
0.3.0-hub           Hub server, vault, real data
0.4.0-heat          Heat scoring engine
0.5.0-restructure   Modular frontend + Vite
0.6.0-scene-graph   Unified scene graph + semantic zoom
0.7.0-???           TBD — see ROADMAP.md
1.0.0               First stable release
```
