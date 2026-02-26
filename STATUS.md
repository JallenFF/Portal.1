# Portal — Project Status

**Last updated:** 2026-02-26
**Current version:** v0.1.0-foundation
**Repo:** https://github.com/JallenFF/Portal.1
**Next milestone:** v0.2.0-scaffold

---

## Current State

### What's built
- Complete TypeScript architecture across 4 packages (core, layouts, physics, triage)
- 19 files, 2,473 lines
- Data model: Node, Edge, Project, Event, Snapshot, EntropyMetrics
- 3 layout strategies: Free (scatter), Orbit (recency rings), Grid (auto-arrange)
- Physics engine: generic solver + reusable force primitives + deterministic seeding
- SQLite persistence layer: schema, row ↔ domain conversion, WAL mode
- Triage interface stub for future AI layer
- README, CHANGELOG, ROADMAP with versioning

### What's NOT built yet
- No running app (no Tauri shell)
- No hub server (no Fastify, no SQLite connection)
- No renderer (no canvas drawing)
- No UI (no toolbar, no zoom, no interaction)

### Interactive prototypes (design exploration, not production code)
Created during initial conversation as React JSX artifacts:
1. `portal-phase1-mockup.jsx` — List-based teleporter overlay
2. `portal-desktop-view.jsx` — Folder-based desktop metaphor
3. `portal-spatial-canvas.jsx` — First physics canvas with zoom
4. `portal-spatial-v2.jsx` — Full canvas: Free/Orbit modes, rectangular file nodes, version links, recency rings, toolbar

These proved the UX. The real codebase replaces them.

---

## Locked Design Decisions

### Architecture
- Monorepo: `packages/{core, layouts, physics, triage, renderer, hub}`
- Core imports nothing. Everything else imports core. No circular deps.
- Layouts are pluggable: implement `LayoutStrategy` interface + register
- Physics is optional per layout
- Transient state (vx, vy) separated from persisted state (positions)
- Hub is sole DB writer. Browser extension POSTs to hub.

### UX / Interaction
- Two modes inside projects: **Free** (manual scatter) and **Orbit** (recency rings)
- User toggles explicitly — no auto-switching
- Toolbar inside focused project: `[Free] [Orbit] [Grid] [Export] [⚙]`
- Locked mode = camera-only (pan/zoom/click). Free mode = drag to reposition.
- Press L to toggle locked/free
- Scroll wheel = zoom. Drag = pan. Zoom into sphere = enter project.
- Files are colored rectangles with type labels (not dots)
- Version links = blue dashed lines between file variants

### Physics
- Top level: full force model (orbit anchor, collision, springs, damping)
- Inside projects: layout-dependent (orbit uses forces, grid doesn't)
- Dynamic damping: low friction zoomed out (flick), high friction zoomed in (grounded)
- Chromatic salience: high activity = vivid, low activity = desaturated
- Deterministic seeding: hash-based, zero Math.random()
- Locked mode: anchors win over physics — system never moves things behind user's back

### Data
- SQLite WAL mode, `~/.portal/portal.db`
- Session IDs group related events atomically
- Entropy = `(unassigned × 1.0 + stale × 0.6 + assigned × 0.3) / total`
- Threshold 0.3 = triage prompt
- Positions persist separately per layout (switching doesn't destroy other layout)

### Future (designed but not built)
- Entropy meter: passive, always visible, triggers triage at threshold
- AI triage: arrow keys (← reject → accept), never autonomous
- Browser extension: Chrome/Edge → native messaging → hub
- Launch recipes: deterministic "open these URLs/files/apps" per project
- Export lens: packet builder with artifact group version selection

---

## Version Plan

```
v0.1.0-foundation  ✅ Architecture & data model
v0.2.0-scaffold       Running app shell (Tauri + Hub + Renderer)
v0.3.0-spatial        Full spatial canvas with physics
v0.4.0-triage         Entropy meter + manual organization
v0.5.0-ai-triage      Claude-powered suggestions
v0.6.0-bridge         Browser extension
v0.7.0-recipes        Launch recipes + workspace restore
v0.8.0-export         Export & sharing
v1.0.0                First stable release
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (strict) |
| Desktop | Tauri |
| API | Fastify |
| Database | SQLite (WAL) |
| Renderer | HTML5 Canvas |
| Browser | Chromium extension (Phase 3) |

---

## Conversation History

| Date | Topic | Key Outcomes |
|------|-------|-------------|
| 2026-02-25 | Initial architecture session | Phased build plan, tech stack, snapshot definition, event schema with session_id, launch recipe format, sandbox reset semantics |
| 2026-02-25 | UX prototyping | 4 interactive prototypes, evolved from list → desktop → spatial canvas → full physics |
| 2026-02-25 | Physics spec | Full force model from J.A.'s mathematical spec, dual Free/Orbit modes, dynamic damping, chromatic salience |
| 2026-02-25 | Architecture build | Foundation codebase: core types, graph ops, persistence, 3 layouts, physics solver, triage stub |
| 2026-02-26 | Versioning + GitHub | README, CHANGELOG, ROADMAP, pushed to GitHub as v0.1.0-foundation |
