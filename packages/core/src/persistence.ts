/**
 * Portal v0.3.0 — SQLite Schema
 * 
 * Additive over v0.1.0. New tables:
 *   - vault_files: immutable file records (hash, type, size, source)
 *   - file_metadata: cheap extracted metadata per vault file
 *   - system_events: app-level diagnostics (startup, errors, perf)
 *   - layout_positions: per-layout node positions (persisted separately)
 * 
 * Unchanged from v0.1.0:
 *   - nodes, edges, projects, events
 * 
 * Future-safe: classification/tags will be a separate table
 * referencing vault_files.id. No schema change needed.
 */

// ── Schema SQL ──────────────────────────────────────────────

export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ═══════════════════════════════════════════════════════════
-- v0.1.0 tables (unchanged)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#6B7280',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  meta        TEXT DEFAULT '{}'  -- extensible JSON blob
);

CREATE TABLE IF NOT EXISTS nodes (
  id          TEXT PRIMARY KEY,
  project_id  TEXT REFERENCES projects(id) ON DELETE SET NULL,
  label       TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'file',
  vault_id    TEXT REFERENCES vault_files(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  meta        TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS edges (
  id          TEXT PRIMARY KEY,
  source_id   TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  target_id   TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  type        TEXT NOT NULL DEFAULT 'link',
  weight      REAL DEFAULT 1.0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  meta        TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL,
  type        TEXT NOT NULL,
  entity_id   TEXT,
  payload     TEXT DEFAULT '{}',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_entity ON events(entity_id);
CREATE INDEX IF NOT EXISTS idx_nodes_project ON nodes(project_id);

-- ═══════════════════════════════════════════════════════════
-- v0.3.0 additions
-- ═══════════════════════════════════════════════════════════

-- Vault: immutable file records. Never modified after ingest.
CREATE TABLE IF NOT EXISTS vault_files (
  id          TEXT PRIMARY KEY,          -- uuid
  hash        TEXT NOT NULL UNIQUE,      -- sha256 of file content
  filename    TEXT NOT NULL,             -- original filename
  ext         TEXT NOT NULL,             -- extension (lowercase, no dot)
  size_bytes  INTEGER NOT NULL,
  source_path TEXT,                      -- where it came from (informational)
  mime_type   TEXT,
  ingested_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_vault_hash ON vault_files(hash);
CREATE INDEX IF NOT EXISTS idx_vault_ext ON vault_files(ext);

-- Cheap metadata extracted at ingest. One row per vault file.
-- No NLP, no content parsing. Just what the filesystem tells us.
CREATE TABLE IF NOT EXISTS file_metadata (
  vault_id      TEXT PRIMARY KEY REFERENCES vault_files(id) ON DELETE CASCADE,
  file_created  TEXT,           -- OS file creation date
  file_modified TEXT,           -- OS file modified date
  word_count    INTEGER,        -- null for non-text files
  dimensions    TEXT,           -- 'WxH' for images, null otherwise
  extra         TEXT DEFAULT '{}'  -- extensible JSON for future extractors
);

-- Per-layout positions. Switching layouts doesn't destroy other layouts.
CREATE TABLE IF NOT EXISTS layout_positions (
  node_id     TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  layout_type TEXT NOT NULL,    -- 'free', 'orbit', 'grid'
  x           REAL NOT NULL,
  y           REAL NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (node_id, layout_type)
);

CREATE INDEX IF NOT EXISTS idx_positions_layout ON layout_positions(layout_type);

-- System events: diagnostics, not domain events.
-- Separate table so domain queries are never polluted.
CREATE TABLE IF NOT EXISTS system_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  level       TEXT NOT NULL DEFAULT 'info',  -- info, warn, error
  category    TEXT NOT NULL,                  -- startup, shutdown, ingest, physics, vault, db
  message     TEXT NOT NULL,
  detail      TEXT DEFAULT '{}',             -- structured JSON for context
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sys_events_level ON system_events(level);
CREATE INDEX IF NOT EXISTS idx_sys_events_cat ON system_events(category);
`;

// ── Row ↔ Domain Conversion ─────────────────────────────────

export interface VaultFileRow {
  id: string;
  hash: string;
  filename: string;
  ext: string;
  size_bytes: number;
  source_path: string | null;
  mime_type: string | null;
  ingested_at: string;
}

export interface FileMetadataRow {
  vault_id: string;
  file_created: string | null;
  file_modified: string | null;
  word_count: number | null;
  dimensions: string | null;
  extra: string;
}

export interface LayoutPositionRow {
  node_id: string;
  layout_type: string;
  x: number;
  y: number;
  updated_at: string;
}

export interface SystemEventRow {
  id: number;
  level: 'info' | 'warn' | 'error';
  category: string;
  message: string;
  detail: string;
  created_at: string;
}

export interface EventRow {
  id: number;
  session_id: string;
  type: string;
  entity_id: string | null;
  payload: string;
  created_at: string;
}
