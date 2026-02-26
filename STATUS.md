# Portal — Status

## Current Version: v0.3.0-hub (in progress)

### What's done
- **v0.1.0-foundation** — Architecture, types, graph ops, layouts, physics, triage stub (2,473 lines)
- **v0.2.0-scaffold** — Tauri desktop shell compiles and runs. Gold test sphere renders.
- **v0.3.0-hub** — Hub server, vault, system logger, updated SQLite schema (in progress)

### v0.3.0 Files
| File | Purpose | Status |
|------|---------|--------|
| `packages/core/src/persistence.ts` | Updated schema (vault_files, file_metadata, system_events, layout_positions) | ✅ |
| `packages/vault/src/vault.ts` | File ingest: copy, hash, dedup, cheap metadata extraction | ✅ |
| `packages/hub/src/logger.ts` | System logger: buffer → SQLite + file logs, diagnostic reports | ✅ |
| `packages/hub/src/server.ts` | Fastify hub: 11 endpoints, sole DB writer | ✅ |

### Dependencies to install
```bash
npm install fastify better-sqlite3
npm install -D @types/better-sqlite3 tsx
```

### Locked Design Decisions (v0.3.0 additions)

**Vault:**
- Files are COPIED into `~/.portal/vault/{sha256}.{ext}`
- Original files are never touched
- Dedup by SHA-256 hash
- vault_files record is immutable after creation
- Classification is a FUTURE separate table — no schema change needed

**Ingest:**
- Copy → extract cheap metadata → place at center
- No NLP, no content parsing, no smart placement at this phase
- Metadata: file type, size, dates, word count (text files only)
- Position = center of active sphere. User places it.
- Future classification writes additional events, doesn't modify ingest

**Untangling guarantee:**
- Ingest is a single event type (`file_ingested`) in the append log
- Position and classification are NEVER on the file record itself
- vault_files = immutable. file_metadata = immutable. layout_positions = separate table.
- Adding smart placement later = new table + new event type. Zero schema migration.

**Logging:**
- system_events table (queryable from app)
- `~/.portal/logs/portal-{date}.log` (readable from PowerShell)
- Categories: startup, shutdown, ingest, physics, vault, db, render, error
- Buffer → flush pattern (off the hot path)
- GET /diagnostics endpoint returns report + DB stats

**Data mining (future, no code yet):**
- Event log is the data source
- Co-access patterns → auto-cluster candidates
- Context switch frequency → relationship weights
- Dwell time → orbit placement
- Dead files → entropy signal
- Navigation patterns → prefetch optimization
- All passive. Queryable layer is Phase 2 with AI triage.

### Hub Endpoints
| Method | Path | Purpose |
|--------|------|---------|
| GET | /health | Alive check |
| GET | /projects | List all projects |
| POST | /projects | Create project |
| GET | /projects/:id | Project with nodes |
| POST | /ingest | Ingest file into vault + create node |
| GET | /events | Query domain events |
| POST | /events | Write domain event |
| GET | /positions/:layout | Get positions for layout |
| PUT | /positions/:layout | Batch update positions |
| GET | /diagnostics | System report + DB stats |
| GET | /diagnostics/events | Query system events |

### What's next
1. Install deps and test hub starts
2. Wire hub into Tauri (Rust spawns hub on app launch)
3. Replace test canvas with real renderer consuming hub API
4. Get file ingest working (drag file onto sphere → vault copy → node appears)

### Git Tags
- `v0.1.0-foundation` — architecture
- `v0.2.0-scaffold` — Tauri shell running
- `v0.3.0-hub` — (tag after hub verified working)
