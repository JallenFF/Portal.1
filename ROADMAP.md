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

## v0.2.0-scaffold
**Running app shell**

- [ ] Tauri project init (`npm create tauri-app`)
- [ ] Monorepo setup (workspaces)
- [ ] Fastify hub server
  - [ ] `POST /ingest` (event ingestion)
  - [ ] `GET /projects`
  - [ ] `POST /projects`
  - [ ] `POST /projects/:id/launch` (writes events + returns recipe)
  - [ ] `GET /export`
  - [ ] `POST /sandbox/reset` (SANDBOX=1)
- [ ] SQLite integration (run schema, WAL mode)
- [ ] Basic renderer (Canvas, draws spheres from DB data)
- [ ] Tauri ↔ Hub communication (localhost fetch)
- [ ] Seed data fixture for development

---

## v0.3.0-spatial
**Full spatial canvas**

- [ ] Top-level sphere physics (orbit anchor, collision, springs)
- [ ] Scroll-to-zoom with camera transform
- [ ] Zoom-into-project transition
- [ ] Free mode inside projects (drag, boundary, persist)
- [ ] Orbit mode inside projects (recency rings, core exclusion)
- [ ] Grid mode inside projects (auto-arrange)
- [ ] Layout toolbar: [Free] [Orbit] [Grid] [Export] [⚙]
- [ ] Locked/Free toggle (L key)
- [ ] Minimap
- [ ] Dynamic damping (global = flicky, local = grounded)
- [ ] Chromatic salience (activity → vividness)
- [ ] Version link edges (visual + data)
- [ ] Staggered file entrance animation
- [ ] Recency ring labels
- [ ] Save/restore positions to DB on layout change

---

## v0.4.0-triage
**Entropy meter + organization**

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

## v0.5.0-ai-triage
**AI-assisted organization (Phase 2 AI)**

- [ ] Local heuristics engine
  - [ ] Same-extension matching
  - [ ] Similar-name version detection
  - [ ] Stale file archival suggestions
- [ ] Claude API integration (`POST /insights/run`)
  - [ ] Batched event context
  - [ ] Summarized project state
  - [ ] Suggestion generation
- [ ] Triage UI: arrow keys (← reject, → accept)
- [ ] "Set aside for later" option
- [ ] Manual override always available
- [ ] Pattern learning from accept/reject history
- [ ] Transition frequency analysis (A↔B → suggest merge/parent)

---

## v0.6.0-bridge
**Browser extension (Phase 3)**

- [ ] Chrome/Edge extension scaffold
- [ ] Native messaging host
- [ ] Extension → Hub communication (`POST /ingest`)
- [ ] Tab tracking (URL → node creation)
- [ ] Bookmark import
- [ ] "Send to Portal" context menu
- [ ] Tab group → project mapping

---

## v0.7.0-recipes
**Launch recipes + workspace restore**

- [ ] Launch recipe editor UI
- [ ] "Open these URLs" action
- [ ] "Open these files/folders" action
- [ ] "Launch these apps" action
- [ ] Recipe execution on project enter
- [ ] Recipe recording (watch what you open → suggest recipe)

---

## v0.8.0-export
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
