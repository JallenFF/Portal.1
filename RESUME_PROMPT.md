# Portal — Resume Prompt

Copy and paste everything below into a new Claude conversation to get it up to speed on Portal.

---

## PROMPT START

I'm building Portal, a spatial desktop application for project context management. Here's the full context:

**What Portal is:**
A Tauri desktop app where projects are spheres on a zoomable canvas. You scroll-zoom into a project to see its files scattered inside. Files are organized by pluggable layout strategies (Free scatter, Orbit recency rings, Grid auto-arrange). Everything saves to one SQLite file (~/.portal/portal.db). No OS hooks, no system modifications.

**Repo:** https://github.com/JallenFF/Portal.1
**Current version:** v0.1.0-foundation
**Next milestone:** v0.2.0-scaffold (running Tauri app + Fastify hub + Canvas renderer)

**What's built (v0.1.0):**
- 19 TypeScript files, 2,473 lines across 4 packages
- `core/`: Node, Edge, Project, Event types + graph operations + SQLite persistence schema (WAL mode)
- `layouts/`: LayoutStrategy interface + LayoutRegistry + Free, Orbit, Grid strategies
- `physics/`: Generic force solver + reusable force primitives + deterministic seeding (zero Math.random)
- `triage/`: TriageEngine interface stub for future AI-assisted organization

**Architecture rules:**
- Monorepo: packages/{core, layouts, physics, triage, renderer, hub}
- Core imports nothing. Everything imports core. No circular deps.
- Layouts are pluggable: one file implements LayoutStrategy + registers. No other files change.
- Physics is optional per layout. Orbit/Free use forces. Grid doesn't.
- Transient physics state (vx, vy) is separated from persisted layout state (positions in SQLite)
- Hub is sole DB writer. Browser extension (Phase 3) POSTs to hub.
- Session IDs group related events atomically

**Key UX decisions:**
- Two modes inside projects: Free (toys on the floor, manual scatter) and Orbit (push outward by recency)
- User toggles modes explicitly — no auto-switching
- Toolbar: [Free] [Orbit] [Grid] [Export] [⚙]
- Locked = camera only (pan/zoom/click). Free = drag to reposition. Toggle with L key.
- Scroll = zoom. Drag = pan. Zoom close to sphere = enter project.
- File nodes are colored rectangles with type labels, not dots
- Version links are blue dashed lines connecting file variants
- Dynamic damping: low friction zoomed out, high friction zoomed in
- Chromatic salience: active spheres vivid, dormant spheres fade
- Entropy meter tracks unorganized files (score 0-1, threshold 0.3 triggers triage)
- AI triage (future): suggestions via arrow keys, never autonomous

**Version plan:**
- v0.1.0-foundation ✅ (architecture)
- v0.2.0-scaffold (Tauri + Hub + Renderer)
- v0.3.0-spatial (full canvas with physics)
- v0.4.0-triage (entropy meter + manual org)
- v0.5.0-ai-triage (Claude-powered suggestions)
- v0.6.0-bridge (browser extension)
- v1.0.0 (stable)

**Tech stack:** TypeScript, Tauri, Fastify, SQLite (WAL), HTML5 Canvas

**My preferences:** Be direct, critical, and collaborative. Identify logic gaps. Concise unless I ask for detail. Maintain changelog and task list for ongoing work.

Please review the repo and STATUS.md, then let's continue building from where we left off.

## PROMPT END
