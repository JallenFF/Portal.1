# Portal — Status

## Current Phase: v0.3.0-hub (in progress)

### Completed Milestones

| Version | Summary | Lines |
|---------|---------|-------|
| v0.1.0-foundation | Types, graph ops, persistence schema, layouts, physics, triage stub | 2,473 |
| v0.2.0-scaffold | Tauri desktop shell compiles and runs. Gold test sphere renders. | — |
| v0.3.0-hub | Hub server, vault, system logger, updated schema | In progress |

### v0.3.0 Files

| File | Purpose | Status |
|------|---------|--------|
| `packages/core/src/persistence.ts` | Updated schema (vault_files, file_metadata, system_events, layout_positions) | ✅ |
| `packages/vault/src/vault.ts` | File ingest: copy, hash, dedup, cheap metadata extraction | ✅ |
| `packages/hub/src/logger.ts` | System logger: buffer → SQLite + file logs, diagnostic reports | ✅ |
| `packages/hub/src/server.ts` | Fastify hub: 11 endpoints, sole DB writer | ✅ |

### v0.3.0 Remaining Tasks

1. [ ] Install deps and verify hub starts
2. [ ] Wire hub into Tauri (Rust spawns hub on app launch)
3. [ ] Replace test canvas with renderer consuming hub API
4. [ ] File ingest end-to-end (drag file → vault copy → node appears)
5. [ ] Tag v0.3.0-hub

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

### Dependencies to Install

```bash
npm install fastify better-sqlite3
npm install -D @types/better-sqlite3 tsx
```

### Git Tags

- `v0.1.0-foundation` — architecture
- `v0.2.0-scaffold` — Tauri shell running
- `v0.3.0-hub` — (tag after hub verified working)

---

## What's After v0.3.0

**v0.4.0-spatial** — Canvas renders real data from hub. Zoom into projects. Free/Orbit/Grid layouts work inside projects. See ROADMAP.md.
