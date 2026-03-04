# Portal — Resume Prompt

Copy and paste everything below into a new Claude conversation to get it up to speed on Portal.

---

## PROMPT START

I'm building Portal, a spatial desktop application for project context management. Here's the full context:

**What Portal is:**
A Tauri desktop app where projects are spheres on a zoomable canvas. You scroll-zoom into a project to see its files scattered inside. A unified scene graph treats projects, folders, and files as nodes in a single tree with semantic zoom — detail increases as you zoom in (Stellaris-style). Files are positioned by heat score (activity-based 0–100 ranking). Everything saves to one SQLite file (~/.portal/portal.db). No OS hooks, no system modifications.

**Repo:** https://github.com/JallenFF/Portal.1
**Current version:** v0.6.1-workspace
**Next milestone:** v0.7.0-triage (entropy meter + manual organization)

**What's built (v0.1.0 → v0.6.1):**

*Foundation (v0.1.0):*
- `core/`: Node, Edge, Project, Event types + graph operations + SQLite persistence schema (WAL mode)
- `layouts/`: LayoutStrategy interface + LayoutRegistry + Free, Orbit, Grid strategies
- `physics/`: Generic force solver + reusable force primitives + deterministic seeding (zero Math.random)
- `triage/`: TriageEngine interface stub

*Scaffold (v0.2.0):*
- Tauri v2 desktop shell, monorepo workspace, gold test sphere renders

*Hub (v0.3.0):*
- Fastify hub server on :3141 (sole DB writer, 18+ endpoints)
- Vault file ingest (copy, SHA256 hash, dedup, metadata extraction)
- System logger (buffered → SQLite + file logs)
- Canvas wired to real data (6 projects ingested)
- Windows launcher script (portal-launcher.bat)

*Heat (v0.4.0):*
- Heat scoring engine: tiers (active/reference/dormant/cold), weight profiles, decay config
- Pure computation: weighted-sum, clamped 0–100, O(N) update
- Heat persistence: heat_metadata, heat_scores, heat_profiles tables

*Restructure (v0.5.0):*
- 11 TypeScript modules replace monolithic dist/main.js
- Vite build pipeline with @core, @layouts, @physics path aliases
- Heat integration in hub (seed from mtime, cache, LEFT JOIN into queries)
- Heat-driven orbit: score → radius, tier → opacity/size
- Click-to-select model (click=select, scroll=enter/exit, double-click=instant)

*Scene Graph (v0.6.0):*
- SceneNode interface: projects, folders, files in one tree
- Lazy loading: children fetched when screen-space radius > 40px
- Semantic zoom renderer: detail thresholds (<2px skip, <8px dot, <30px no children, ≥30px children, ≥40px lazy load)
- World-unit coordinate system (replaces screen-pixel placement)
- Continuous zoom 0.08–20x, cursor-centered (Miro-style)
- Selection ring, loading indicator, minimap, clickable breadcrumb
- AppStateV2: roots[], selectedNode, hoveredNode

*Workspace (v0.6.1):*
- Project workspace mode: `activeProject` state flag, `enterProject()`/`exitProject()` in navigation
- Toolbar: HTML overlay with project name, color, item count, action buttons
- Node dragging: mousedown on node in workspace = drag, saves position via `PUT /positions/workspace`
- Workspace renderer: dedicated background, project boundary ring, drag indicator
- Dual-mode design: galaxy view (macro org context) vs workspace view (Miro-style deep work)
- Same canvas/camera/renderer, different render branch based on `activeProject`

**Architecture rules:**
- Monorepo: packages/{core, layouts, physics, triage, vault, hub} + src/ (frontend modules)
- Core imports nothing. Everything imports core. No circular deps.
- Layouts are pluggable: one file implements LayoutStrategy + registers
- Physics is optional per layout
- Hub is sole DB writer (D-003). All clients go through hub endpoints.
- Unified scene graph (D-073) replaces binary galaxy/solar-system modes
- World-unit coordinates (D-074), lazy loading (D-075)
- Workspace is a state flag, not a separate page (D-076)

**Key UX decisions:**
- Two views: Galaxy (macro org context) and Workspace (Miro-style interior for deep work)
- Galaxy: semantic zoom, detail emerges as you zoom in. Heat-driven placement.
- Workspace: double-click project → toolbar + draggable file cards. Drag to arrange, dbl-click to open.
- Workspace is a state flag (`activeProject`), not a separate page. Same canvas, different render branch.
- Click = select. Double-click project = enter workspace. Escape = back to galaxy.
- Breadcrumb from ancestor chain, clickable
- Minimap with camera viewport indicator (galaxy mode)

**Version plan:**
- v0.1.0-foundation ✅
- v0.2.0-scaffold ✅
- v0.3.0-hub ✅
- v0.4.0-heat ✅
- v0.5.0-restructure ✅
- v0.6.0-scene-graph ✅
- v0.6.1-workspace ✅ (toolbar, node dragging, workspace mode)
- v0.7.0-triage (entropy meter + manual org)
- v0.8.0-ai-triage (Claude-powered suggestions)
- v0.9.0-bridge (browser extension)
- v1.0.0 (stable)

**Tech stack:** TypeScript, Tauri, Fastify, SQLite (WAL), HTML5 Canvas, Vite

**My preferences:** Be direct, critical, and collaborative. Identify logic gaps. Concise unless I ask for detail. Maintain changelog and task list for ongoing work.

Please review the repo and STATUS.md, then let's continue building from where we left off.

## PROMPT END
