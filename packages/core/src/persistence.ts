/**
 * Portal v0.4.0 — SQLite Schema
 * 
 * Changes from v0.3.0:
 *   - nodes: added parent_id (self-referencing FK for folder hierarchy)
 *   - nodes: added source_path (original file/folder path for opening)
 *   - nodes: added is_folder flag
 *   - nodes: added file_modified (denormalized from file_metadata for orbit placement)
 *   - settings: key-value store for user preferences (orbit windows, weekend toggle, etc.)
 */

export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ═══════════════════════════════════════════════════════════
-- Core tables
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#6B7280',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  meta        TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS nodes (
  id            TEXT PRIMARY KEY,
  project_id    TEXT REFERENCES projects(id) ON DELETE SET NULL,
  parent_id     TEXT REFERENCES nodes(id) ON DELETE CASCADE,
  label         TEXT NOT NULL,
  type          TEXT NOT NULL DEFAULT 'file',
  is_folder     INTEGER NOT NULL DEFAULT 0,
  vault_id      TEXT REFERENCES vault_files(id),
  source_path   TEXT,
  file_modified TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  meta          TEXT DEFAULT '{}'
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
CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_nodes_folder ON nodes(is_folder);

-- ═══════════════════════════════════════════════════════════
-- Vault & Metadata
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS vault_files (
  id          TEXT PRIMARY KEY,
  hash        TEXT NOT NULL UNIQUE,
  filename    TEXT NOT NULL,
  ext         TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL,
  source_path TEXT,
  mime_type   TEXT,
  ingested_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_vault_hash ON vault_files(hash);
CREATE INDEX IF NOT EXISTS idx_vault_ext ON vault_files(ext);

CREATE TABLE IF NOT EXISTS file_metadata (
  vault_id      TEXT PRIMARY KEY REFERENCES vault_files(id) ON DELETE CASCADE,
  file_created  TEXT,
  file_modified TEXT,
  word_count    INTEGER,
  dimensions    TEXT,
  extra         TEXT DEFAULT '{}'
);

-- ═══════════════════════════════════════════════════════════
-- Layout & Positions
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS layout_positions (
  node_id     TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  layout_type TEXT NOT NULL,
  x           REAL NOT NULL,
  y           REAL NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (node_id, layout_type)
);

CREATE INDEX IF NOT EXISTS idx_positions_layout ON layout_positions(layout_type);

-- ═══════════════════════════════════════════════════════════
-- Settings (user preferences)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Default orbit settings
INSERT OR IGNORE INTO settings (key, value) VALUES ('orbit.inner_hours', '48');
INSERT OR IGNORE INTO settings (key, value) VALUES ('orbit.mid1_days', '4');
INSERT OR IGNORE INTO settings (key, value) VALUES ('orbit.mid2_weeks', '2');
INSERT OR IGNORE INTO settings (key, value) VALUES ('orbit.outer_weeks', '3');
INSERT OR IGNORE INTO settings (key, value) VALUES ('orbit.weekend_extend', 'false');
INSERT OR IGNORE INTO settings (key, value) VALUES ('orbit.weekend_hours', '72');
INSERT OR IGNORE INTO settings (key, value) VALUES ('view.default_layout', 'orbit');
INSERT OR IGNORE INTO settings (key, value) VALUES ('galaxy.project_orbit_days', '30');

-- ═══════════════════════════════════════════════════════════
-- System Events
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS system_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  level       TEXT NOT NULL DEFAULT 'info',
  category    TEXT NOT NULL,
  message     TEXT NOT NULL,
  detail      TEXT DEFAULT '{}',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sys_events_level ON system_events(level);
CREATE INDEX IF NOT EXISTS idx_sys_events_cat ON system_events(category);

-- ═══════════════════════════════════════════════════════════
-- Workspace Notes (sticky notes on the benchtop)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS workspace_notes (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  content    TEXT NOT NULL DEFAULT '',
  x          REAL NOT NULL DEFAULT 0,
  y          REAL NOT NULL DEFAULT 0,
  width      REAL NOT NULL DEFAULT 200,
  height     REAL NOT NULL DEFAULT 150,
  color      TEXT NOT NULL DEFAULT '#FFF8DC',
  z_order    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ws_notes_project ON workspace_notes(project_id);
`;

// ── Row Types ───────────────────────────────────────────────

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

export interface NodeRow {
  id: string;
  project_id: string | null;
  parent_id: string | null;
  label: string;
  type: string;
  is_folder: number;
  vault_id: string | null;
  source_path: string | null;
  file_modified: string | null;
  created_at: string;
  updated_at: string;
  meta: string;
}

export interface LayoutPositionRow {
  node_id: string;
  layout_type: string;
  x: number;
  y: number;
  updated_at: string;
}

export interface SettingRow {
  key: string;
  value: string;
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

export interface WorkspaceNoteRow {
  id: string;
  project_id: string;
  content: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  z_order: number;
  created_at: string;
  updated_at: string;
}

export interface EdgeRow {
  id: string;
  source_id: string;
  target_id: string;
  type: string;
  weight: number;
  created_at: string;
  meta: string;
}
