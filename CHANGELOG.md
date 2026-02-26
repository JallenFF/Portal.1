# Changelog

All notable changes to Portal are documented here.

Format: [Semantic Versioning](https://semver.org/) with build phases.

---

## [0.1.0-foundation] — 2026-02-25

**Phase: Foundation / Architecture**

### Added
- **`core/types.ts`** — Complete data model: Node, Edge, Project, Event, Snapshot, EntropyMetrics, ArtifactGroup, LaunchAction, EntropyState
- **`core/graph.ts`** — Pure graph operations: add/remove/link nodes and edges, assign nodes to projects, compute entropy, query helpers (getProjectNodes, getStaleNodes, getConnectedNodes, etc.)
- **`core/persistence.ts`** — SQLite schema with WAL mode, indexes, row ↔ domain conversion functions, `hydrateGraph()` for loading full state from DB
- **`layouts/types.ts`** — `LayoutStrategy` interface, `LayoutRegistry`, `LayoutBody`, `LayoutConfig`. Pluggable architecture for organization modes.
- **`layouts/free.ts`** — Free layout: manual scatter workbench with boundary constraint, collision avoidance, core exclusion. Positions persist per node.
- **`layouts/orbit.ts`** — Orbit layout: recency-based ring organization with configurable buckets (0-24h through 180d+), hash-anchored stable angles, core exclusion, depth control.
- **`layouts/grid.ts`** — Grid layout: auto-arrange by type, name, or date. Static positioning, no physics.
- **`physics/forces.ts`** — Reusable force primitives: springAttraction, pairRepulsion, coreExclusion, boundaryConstraint, springLink, centerGravity, sumForces.
- **`physics/solver.ts`** — Generic force integrator with configurable damping, velocity capping, sleep detection. Pure function: bodies + forces → new positions.
- **`physics/seeding.ts`** — Deterministic initialization: hashId, hashToAngle, hashToFloat, seedSpheres, seedFiles. Zero Math.random().
- **`triage/types.ts`** — TriageEngine interface, TriageSuggestion types, LocalTriageEngine stub for Phase 2 AI layer.
- **`README.md`** — Project overview, architecture docs, package descriptions, setup instructions.
- **`CHANGELOG.md`** — This file.
- **`ROADMAP.md`** — Phased delivery plan.

### Design decisions locked
- Nodes + Edges as universal primitives (graph-first)
- Layouts are pluggable strategies, not hardcoded views
- Physics is optional per layout (orbit/free use it, grid doesn't)
- Transient physics state (vx, vy) separated from persisted layout state (positions)
- Entropy computed from graph state, not stored
- Session IDs group related events atomically
- SQLite WAL mode from day one
- Hub is sole DB writer; browser extension POSTs to hub

---

## [Unreleased] — targeting v0.2.0-scaffold

### Planned
- Tauri project scaffold (desktop shell)
- Fastify hub server with REST endpoints
- SQLite integration using `core/persistence.ts` schema
- Renderer package (Canvas-based, consumes layouts + physics)
- Wire interactive prototype to real architecture
- `POST /ingest`, `GET /projects`, `POST /projects`, `POST /projects/:id/launch`
- Entropy meter UI component
- Free/Orbit/Grid toolbar toggle

---

## Version numbering

```
MAJOR.MINOR.PATCH-phase

0.1.0-foundation    Architecture & data model
0.2.0-scaffold      Running app shell (Tauri + Hub + Renderer)
0.3.0-spatial       Full spatial canvas with physics
0.4.0-triage        Entropy meter + manual triage
0.5.0-bridge        Browser extension (Phase 3)
1.0.0               First stable release
```

### Phase tags
- `foundation` — Types, interfaces, architecture
- `scaffold` — Running app, no features
- `spatial` — Canvas, zoom, physics, layouts
- `triage` — Entropy meter, organization prompts
- `bridge` — Browser extension, native messaging
- (no tag) — Stable release
