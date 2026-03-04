# Portal — Status

## Current Phase: v0.6.1-workspace (in progress)

### Completed Milestones

| Version | Summary | Date |
|---------|---------|------|
| v0.1.0-foundation | Types, graph ops, persistence schema, layouts, physics, triage stub (2,473 lines) | 2026-02-25 |
| v0.2.0-scaffold | Tauri desktop shell compiles and runs. Gold test sphere renders. | 2026-02-26 |
| v0.3.0-hub | Hub server (Fastify on :3141), vault, system logger, updated schema, canvas wired to real data | 2026-02-26/27 |
| v0.4.0-heat | Heat scoring engine: tiers, weight profiles, decay config, 0–100 scalar per node | 2026-02-27 |
| v0.5.0-restructure | Frontend modularized to 11 TypeScript modules, Vite build pipeline, heat integration in hub | 2026-02-27 |
| v0.6.0-scene-graph | Unified scene graph, semantic zoom (Stellaris-style), lazy loading, world-unit coordinates | 2026-02-28 |
| v0.6.1-workspace | Project workspace mode: toolbar, node dragging, position persistence, Miro-style interior | 2026-03-01 |

### v0.6.0 Key Files

| File | Purpose | Status |
|------|---------|--------|
| `src/scene-graph.ts` | SceneNode interface, hitTest(), getAncestorChain(), findNode() | ✅ |
| `src/lazy-loader.ts` | On-demand API fetching, screen-space radius trigger (40px), cached in scene graph | ✅ |
| `src/state.ts` | AppStateV2: roots[], selectedNode, hoveredNode | ✅ |
| `src/placement.ts` | World-unit placement, heat-ranked orbit, folder placement at 80% radius | ✅ |
| `src/navigation.ts` | selectNode() + zoomInto() + goUp() — no coordinate resets | ✅ |
| `src/input.ts` | Continuous zoom (0.08–20x), cursor-centered (Miro-style), hitTest click detection | ✅ |
| `src/renderer.ts` | Recursive renderNode() with semantic detail thresholds | ✅ |
| `src/hud.ts` | Breadcrumb from getAncestorChain(), clickable ancestors | ✅ |
| `src/main.ts` | Boot: fetchProjects → place → buildProjectNodes → state.roots | ✅ |
| `src/colors.ts` | Color utilities | ✅ |
| `src/math.ts` | Math utilities | ✅ |
| `src/api.ts` | Hub API client | ✅ |
| `src/types.ts` | Camera + Mouse types only (dead types removed) | ✅ |

### Hub Endpoints (current)

| Method | Path | Purpose |
|--------|------|---------|
| GET | /health | Alive check |
| GET | /projects | List all projects |
| POST | /projects | Create project |
| GET | /projects/:id | Project with nodes |
| GET | /projects/:id/heat | Heat scores for project |
| POST | /heat/recalc/:projectId | Recalculate heat scores |
| POST | /ingest | Ingest file into vault + create node |
| POST | /ingest/folder | Ingest folder (preserves hierarchy) |
| GET | /nodes/:id/children | Get node children |
| PUT | /nodes/:id/pin | Pin a node |
| PUT | /nodes/:id/promote | Promote a node |
| GET | /events | Query domain events |
| POST | /events | Write domain event |
| GET | /positions/:layout | Get positions for layout |
| PUT | /positions/:layout | Batch update positions |
| GET | /diagnostics | System report + DB stats |
| GET | /diagnostics/events | Query system events |
| GET | /settings | Get settings |
| GET | /open | Open file in OS default app |

### Git Tags

- `v0.1.0-foundation` — architecture
- `v0.2.0-scaffold` — Tauri shell running
- `v0.3.0-hub` — hub server + vault + canvas wired
- `v0.4.0-heat` — heat scoring engine
- `v0.5.0-restructure` — modular frontend + Vite
- `v0.6.0-scene-graph` — unified scene graph + semantic zoom

---

## What's Next

**v0.6.1-workspace** — Complete. Workspace mode with toolbar, node dragging, position persistence.

**Next:** Position persistence round-trip (load saved positions on project enter), sticky notes, context menu, drag-from-Explorer ingest. Then v0.7.0-triage (entropy meter + manual org).
