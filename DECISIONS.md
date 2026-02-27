# Portal — Decision Log

Every significant design decision is recorded here. Each entry states what was decided, why, what was rejected, and what would reopen the decision.

**Status labels:**
- `[LOCKED]` — Settled. Don't relitigate. Build on top of it.
- `[SOFT]` — Provisional. Challenge this if you see a better path or a problem.
- `[REVISIT @ vX.X]` — Intentionally deferred. Revisit at the named milestone.

---

## Architecture

### D-001: Graph-first data model [LOCKED]
**Decision:** Everything is Nodes and Edges. Projects, files, links, groups — all graph primitives.
**Why:** Uniform querying, layout-agnostic traversal, no special cases.
**Rejected:** Hierarchical tree model (too rigid for cross-project references), flat file list (no relationships).
**Reopens if:** We discover a data relationship that fundamentally can't be expressed as nodes + edges.

### D-002: Core imports nothing [LOCKED]
**Decision:** `core/` is the dependency root. It imports no other package.
**Why:** Prevents circular deps. Every package can import core without risk.
**Rejected:** Bidirectional imports with runtime guards (fragile, hard to reason about).
**Reopens if:** Never. This is a structural constraint.

### D-003: Hub is sole DB writer [LOCKED]
**Decision:** Only the hub server writes to SQLite. Renderer, extension, and Tauri shell all go through hub endpoints.
**Why:** Single writer avoids WAL contention, simplifies conflict resolution, makes the event log authoritative.
**Rejected:** Direct DB access from renderer (fast but creates write contention), Tauri Rust-side writes (splits write logic across languages).
**Reopens if:** Performance profiling shows hub is a bottleneck for high-frequency writes (e.g., physics position saves during drag). Mitigation: batch endpoints, not architectural change.

### D-004: Monorepo with packages/ [LOCKED]
**Decision:** Single repo, `packages/{core, layouts, physics, triage, vault, hub, renderer}`.
**Why:** Shared types, atomic commits across packages, single build pipeline.
**Rejected:** Multi-repo (coordination overhead for a solo project).
**Reopens if:** Never for this project scale.

### D-005: SQLite WAL mode [LOCKED]
**Decision:** WAL journal mode set on every connection. Single file at `~/.portal/portal.db`.
**Why:** Concurrent reads during writes. Simple deployment. No server process for the DB.
**Rejected:** Postgres (overkill for single-user desktop app), IndexedDB (no Tauri-side access).
**Reopens if:** Multi-user or multi-device sync becomes a goal (post-1.0).

---

## Data Model

### D-010: Positions in separate table, not on node [LOCKED]
**Decision:** `layout_positions` table. Nodes don't store x/y.
**Why:** Different layouts produce different positions for the same node. Keeps node records layout-agnostic.
**Rejected:** Position fields on node record (breaks when switching layouts).
**Reopens if:** Never. This is correct.

### D-011: vault_files and file_metadata are immutable [LOCKED]
**Decision:** Once a vault_files or file_metadata row is written, it is never updated.
**Why:** Append-only simplifies reasoning about state. New info = new event/table, not mutation.
**Rejected:** Mutable metadata (simpler queries but harder to debug state issues).
**Reopens if:** We find a metadata field that MUST be updated in place (can't think of one).

### D-012: Entropy computed, not stored [LOCKED]
**Decision:** Entropy score is calculated on-the-fly from graph state.
**Why:** No stale cache. Always accurate. Computation is cheap (count nodes by state).
**Rejected:** Stored score updated on events (adds write + staleness risk for negligible perf gain).
**Reopens if:** Node counts reach tens of thousands and computation becomes measurable. Mitigation: cache with invalidation, not stored column.

### D-013: Event session IDs for atomic grouping [LOCKED]
**Decision:** Related events share a `session_id` string.
**Why:** Context switch = multiple events (exit A, save A, enter B, launch B) that must be grouped.
**Rejected:** Transaction-based grouping (ties events to DB implementation).
**Reopens if:** Never.

---

## Layouts & Physics

### D-020: Layouts are pluggable strategies [LOCKED]
**Decision:** Each layout is one file implementing `LayoutStrategy`. Register in `LayoutRegistry`. No other files change.
**Why:** Open for extension, closed for modification. Adding a layout is zero-risk to existing code.
**Rejected:** Switch/case in renderer (every new layout touches shared code).
**Reopens if:** Never.

### D-021: Physics is optional per layout [LOCKED]
**Decision:** `LayoutStrategy.usesPhysics` flag. Orbit and Free use forces. Grid doesn't.
**Why:** Not all layouts need simulation. Forcing physics on Grid would waste cycles and add complexity.
**Rejected:** All layouts run through solver (wasteful for static layouts).
**Reopens if:** Never.

### D-022: Transient physics state separated from persistence [LOCKED]
**Decision:** Velocities (vx, vy) live in memory only. Positions persist to SQLite.
**Why:** Velocities are meaningless across sessions. Persisting them adds writes for no benefit.
**Rejected:** Full state persistence (unnecessary DB churn).
**Reopens if:** Never.

### D-023: Deterministic seeding, zero Math.random() [LOCKED]
**Decision:** All initial positions derived from node ID hashes.
**Why:** Same data = same initial layout. Reproducible for testing. No random jitter between sessions.
**Rejected:** Random seeding (non-reproducible, makes debugging layout issues harder).
**Reopens if:** We need intentional randomness for some future feature (unlikely).

---

## Vault & Ingest

### D-030: Files copied into vault, originals untouched [LOCKED]
**Decision:** Ingest = copy to `~/.portal/vault/{sha256}.{ext}`. Source file is never modified or moved.
**Why:** Safety. Portal never destroys user data. Dedup by hash is free.
**Rejected:** Symlinks (break if original moves), move-into-vault (destructive).
**Reopens if:** Disk space becomes a concern for large vaults. Mitigation: optional dedup-aware pruning, not architectural change.

### D-031: Ingest is dumb at first [SOFT]
**Decision:** Ingest copies file, extracts cheap metadata (type, size, dates, word count for text). No NLP, no content parsing, no smart placement.
**Why:** Ship working ingest fast. Smart features layer on top via new events/tables.
**Reopens if:** We find that even basic ingest needs one more piece of metadata to make the UX not frustrating. Likely candidate: MIME type detection beyond extension.

### D-032: New file appears at center of active sphere [SOFT]
**Decision:** Ingested file's initial position = center of the project the user is currently inside.
**Why:** Simple, predictable. User places it where they want.
**Reopens if:** User testing shows center-placement causes pile-ups. Alternative: slight random offset from center, or place at first empty grid slot.

---

## UX

### D-040: User explicitly toggles layout modes [LOCKED]
**Decision:** Free / Orbit / Grid are user-selected via toolbar. No auto-switching.
**Why:** Spatial memory depends on predictability. Auto-switching would be disorienting.
**Rejected:** Context-aware auto-layout (unpredictable, violates user spatial memory).
**Reopens if:** Never.

### D-041: Locked vs Free toggle (L key) [LOCKED]
**Decision:** Locked = camera only (pan/zoom/click). Free = drag to reposition nodes.
**Why:** Prevents accidental repositioning during navigation.
**Rejected:** Always-draggable (too easy to displace nodes accidentally).
**Reopens if:** Never.

### D-042: Scroll = zoom, drag = pan [LOCKED]
**Decision:** Standard canvas navigation. Zoom close to sphere = enter project.
**Why:** Matches every zoomable canvas tool users already know.
**Reopens if:** Never.

### D-043: File nodes are colored rectangles with type labels [SOFT]
**Decision:** Not dots, not icons. Rectangles with a type label and filename.
**Why:** Readable at zoom levels where icons would be ambiguous. Color = file type.
**Reopens if:** Visual design iteration. This will almost certainly evolve. The shape/style is soft but the principle (readable at working zoom) is locked.

### D-044: Dynamic damping [SOFT]
**Decision:** Low friction zoomed out (flicky, playful). High friction zoomed in (precise, grounded).
**Why:** Different zoom levels have different interaction needs.
**Reopens if:** Playtesting shows it feels weird. Tuning constants are definitely soft.

### D-045: Chromatic salience [SOFT]
**Decision:** Active/recent spheres are vivid. Dormant spheres fade.
**Why:** Visual entropy signal without UI chrome.
**Reopens if:** Color-blind accessibility review. May need alternative signals (size, border, icon).

---

## AI & Triage

### D-050: AI is downstream consumer, never autonomous [LOCKED]
**Decision:** AI reads events and suggests. User accepts/rejects. AI never moves files, creates projects, or modifies state without user action.
**Why:** Trust. Users must feel in control of their spatial environment.
**Rejected:** Auto-organize (violates spatial memory and user trust).
**Reopens if:** Never. This is a core product principle.

### D-051: Local heuristics before Claude API [SOFT]
**Decision:** Phase 1 triage uses local rules (same-extension, similar-name, stale detection). Claude API is Phase 2.
**Why:** Works offline. Fast. Reduces API cost. Claude API adds semantic understanding on top.
**Reopens if:** Local heuristics prove too dumb to be useful, making the whole triage feature feel broken before Claude API ships.

---

## Infrastructure

### D-060: Tauri for desktop shell [LOCKED]
**Decision:** Tauri v2, not Electron.
**Why:** Smaller binary, lower memory, Rust backend for file system ops.
**Rejected:** Electron (bloated), native app (platform-specific code).
**Reopens if:** Tauri v2 proves unstable or missing critical APIs. Very unlikely at this point.

### D-061: Fastify for hub server [SOFT]
**Decision:** Fastify over Express/Koa/Hono.
**Why:** Fast, good TypeScript support, schema validation built in.
**Reopens if:** Fastify causes problems with Tauri's process spawning or bundling. Alternative: Hono (lighter weight).

### D-062: HTML5 Canvas renderer [SOFT → REVISIT @ v0.8.0]
**Decision:** Canvas 2D for now. WebGL is future.
**Why:** Simpler to get working. Canvas handles hundreds of nodes fine. WebGL needed for thousands.
**Reopens if:** Performance issues with 200+ visible nodes. That's the migration trigger.

---

## How to add a decision

```markdown
### D-XXX: Short title [LOCKED|SOFT|REVISIT @ vX.X]
**Decision:** What we decided.
**Why:** The reasoning.
**Rejected:** What we considered and why we said no.
**Reopens if:** The specific condition that would make us reconsider.
```
