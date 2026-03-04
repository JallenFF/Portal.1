# Portal Roadmap

---

## v0.1.0-foundation ✅ COMPLETE
**Architecture & data model**

- [x] Core types (Node, Edge, Project, Event, Snapshot)
- [x] Graph operations (pure functions)
- [x] SQLite persistence layer (schema + conversion)
- [x] Layout strategy interface + registry
- [x] Free layout (scatter workbench)
- [x] Orbit layout (recency rings)
- [x] Grid layout (auto-arrange)
- [x] Physics primitives (forces, solver, seeding)
- [x] Triage interface (stub)
- [x] README, CHANGELOG, ROADMAP

---

## v0.2.0-scaffold ✅ COMPLETE
**Tauri desktop shell**

- [x] Tauri v2 project init
- [x] Monorepo setup (workspaces)
- [x] Vite build config
- [x] Gold test sphere renders on Canvas

---

## v0.3.0-hub ✅ COMPLETE
**Hub server, vault, real data**

- [x] Fastify hub server (sole DB writer, 11+ endpoints)
- [x] SQLite integration (WAL mode)
- [x] Vault file ingest (copy, hash, dedup, metadata)
- [x] System logger (buffered → SQLite + file logs)
- [x] Canvas connected to hub API
- [x] 6 real projects ingested
- [x] Windows launcher script

---

## v0.4.0-heat ✅ COMPLETE
**Heat scoring engine**

- [x] Heat types (tiers, weight profiles, decay config)
- [x] Pure heat computation (weighted-sum, 0–100, O(N))
- [x] Heat persistence (heat_metadata, heat_scores, heat_profiles tables)
- [x] Heat drives orbit placement, visibility, compression, tiers
- [x] Weight profiles swappable at runtime

---

## v0.5.0-restructure ✅ COMPLETE
**Modular frontend + Vite pipeline**

- [x] 11 TypeScript modules replace monolithic dist/main.js
- [x] Vite build pipeline with path aliases
- [x] Heat integration in hub (seed from mtime, cache scores, LEFT JOIN)
- [x] Heat-driven orbit (score → radius, tier → opacity/size)
- [x] Click-to-select model (click = select, scroll = enter/exit, double-click = instant)
- [x] New hub endpoints (heat, pin, promote)

---

## v0.6.0-scene-graph ✅ COMPLETE
**Unified scene graph + semantic zoom**

- [x] SceneNode interface (projects, folders, files in one tree)
- [x] Lazy loading (children fetched when screen-space radius > 40px)
- [x] Semantic zoom renderer (detail thresholds: skip/dot/no-children/children/lazy-load)
- [x] World-unit coordinate system (replaces screen-pixel)
- [x] Continuous zoom (0.08–20x, cursor-centered, Miro-style)
- [x] Selection ring with directional arrows
- [x] Loading indicator (rotating dots)
- [x] Minimap (project positions + camera viewport)
- [x] Breadcrumb from ancestor chain (clickable)
- [x] AppStateV2 (roots[], selectedNode, hoveredNode)

---

## v0.7.0-triage (NEXT)
**Entropy meter + manual organization**

- [ ] Entropy meter UI (always visible, passive)
- [ ] Unassigned node detection
- [ ] Stale node detection (configurable threshold)
- [ ] Triage screen: click meter → see unorganized files
- [ ] Manual drag-to-project assignment
- [ ] Manual edge creation (drag node → node)
- [ ] Version linking gesture (V + drag)
- [ ] Entropy score display
- [ ] Triage event logging (accept/reject/defer)

---

## v0.8.0-ai-triage
**AI-assisted organization (Phase 2 AI)**

- [ ] Local heuristics engine (same-extension, similar-name, stale detection)
- [ ] Claude API integration (`POST /insights/run`)
- [ ] Triage UI: arrow keys (← reject, → accept)
- [ ] "Set aside for later" option
- [ ] Manual override always available
- [ ] Pattern learning from accept/reject history

---

## v0.9.0-bridge
**Browser extension (Phase 3)**

- [ ] Chrome/Edge extension scaffold
- [ ] Native messaging host
- [ ] Extension → Hub communication (`POST /ingest`)
- [ ] Tab tracking (URL → node creation)
- [ ] Bookmark import
- [ ] "Send to Portal" context menu
- [ ] Tab group → project mapping

---

## v0.10.0-recipes
**Launch recipes + workspace restore**

- [ ] Launch recipe editor UI
- [ ] "Open these URLs" action
- [ ] "Open these files/folders" action
- [ ] "Launch these apps" action
- [ ] Recipe execution on project enter
- [ ] Recipe recording (watch what you open → suggest recipe)

---

## v0.11.0-export
**Export & sharing**

- [ ] Export lens UI
- [ ] Packet builder (select files → bundle)
- [ ] Artifact group selection (choose version per group)
- [ ] Naming templates
- [ ] Copy to folder / zip export
- [ ] Shareable project snapshot

---

## v1.0.0
**First stable release**

- [ ] All Phase 1-3 features complete
- [ ] Performance optimization (large project handling)
- [ ] Error recovery (corrupt DB, crash state)
- [ ] User settings persistence
- [ ] Onboarding flow
- [ ] Documentation site

---

## Future (post-1.0)

- Systems map layout (flowchart / dependency graph)
- Hierarchy layout (tree view)
- Multi-user shared canvases
- Plugin API for custom layouts
- WebGL renderer upgrade
- Mobile companion app
- Voice-triggered context switches
- Time-travel replay (scrub through event history)
