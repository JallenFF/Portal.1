// ============================================================
// Portal Heat Scoring — Persistence Layer
// ============================================================
// Extends the existing SQLite schema with tables for heat
// metadata tracking. Integrates with persistence.ts.
//
// New tables:
//   - heat_metadata: per-node usage signals, overrides
//   - heat_scores:   cached computed scores (avoid recalc)
//   - heat_profiles: saved custom weight profiles
//
// All writes go through the hub (D-003).
// Heat recalculation is triggered, not continuous.
// ============================================================

// ------------------------------------------------------------
// Schema migration SQL
// ------------------------------------------------------------

/**
 * Run this AFTER the main SCHEMA_SQL from persistence.ts.
 * Safe to run multiple times (CREATE IF NOT EXISTS).
 */
export const HEAT_SCHEMA_SQL = `
-- ═══════════════════════════════════════════════════════════
-- Heat Metadata (tracked per node)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS heat_metadata (
  node_id             TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
  project_id          TEXT REFERENCES projects(id) ON DELETE SET NULL,

  -- Direct usage signals
  last_opened         TEXT,     -- ISO datetime
  last_executed       TEXT,     -- ISO datetime
  open_count          INTEGER NOT NULL DEFAULT 0,
  edit_count          INTEGER NOT NULL DEFAULT 0,

  -- Structural signals
  reference_count     INTEGER NOT NULL DEFAULT 0,
  import_count        INTEGER NOT NULL DEFAULT 0,

  -- User overrides
  pinned              INTEGER NOT NULL DEFAULT 0,
  locked              INTEGER NOT NULL DEFAULT 0,
  promoted            INTEGER NOT NULL DEFAULT 0,
  archived            INTEGER NOT NULL DEFAULT 0,

  -- Project context
  project_last_active TEXT,     -- ISO datetime

  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_heat_project ON heat_metadata(project_id);
CREATE INDEX IF NOT EXISTS idx_heat_pinned ON heat_metadata(pinned) WHERE pinned = 1;
CREATE INDEX IF NOT EXISTS idx_heat_archived ON heat_metadata(archived) WHERE archived = 1;

-- ═══════════════════════════════════════════════════════════
-- Cached Heat Scores
-- ═══════════════════════════════════════════════════════════
-- Avoids recalculating on every read.
-- Invalidated on: session start, project entry, background tick.

CREATE TABLE IF NOT EXISTS heat_scores (
  node_id       TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
  score         REAL NOT NULL DEFAULT 0,
  tier          TEXT NOT NULL DEFAULT 'cold',
  profile_name  TEXT NOT NULL DEFAULT 'balanced',
  computed_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_heat_scores_tier ON heat_scores(tier);
CREATE INDEX IF NOT EXISTS idx_heat_scores_score ON heat_scores(score DESC);

-- ═══════════════════════════════════════════════════════════
-- Custom Weight Profiles
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS heat_profiles (
  name                    TEXT PRIMARY KEY,
  direct_usage            REAL NOT NULL,
  project_inheritance     REAL NOT NULL,
  structural_importance   REAL NOT NULL,
  user_boost              REAL NOT NULL,
  staleness_penalty       REAL NOT NULL,
  created_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Insert default profiles
INSERT OR IGNORE INTO heat_profiles (name, direct_usage, project_inheritance, structural_importance, user_boost, staleness_penalty)
VALUES
  ('balanced',        0.40, 0.20, 0.15, 0.20, 0.05),
  ('usage_heavy',     0.55, 0.15, 0.10, 0.15, 0.05),
  ('project_context', 0.25, 0.35, 0.15, 0.20, 0.05),
  ('structural',      0.25, 0.15, 0.35, 0.20, 0.05);

-- Default heat settings
INSERT OR IGNORE INTO settings (key, value) VALUES ('heat.active_profile', 'balanced');
INSERT OR IGNORE INTO settings (key, value) VALUES ('heat.decay_half_life_days', '14');
INSERT OR IGNORE INTO settings (key, value) VALUES ('heat.project_decay_per_day', '2');
INSERT OR IGNORE INTO settings (key, value) VALUES ('heat.max_project_penalty', '30');
INSERT OR IGNORE INTO settings (key, value) VALUES ('heat.pinned_floor', '60');
INSERT OR IGNORE INTO settings (key, value) VALUES ('heat.archived_ceiling', '5');
`;

// ------------------------------------------------------------
// Row types
// ------------------------------------------------------------

export interface HeatMetadataRow {
  node_id: string;
  project_id: string | null;
  last_opened: string | null;
  last_executed: string | null;
  open_count: number;
  edit_count: number;
  reference_count: number;
  import_count: number;
  pinned: number;       // 0 or 1
  locked: number;
  promoted: number;
  archived: number;
  project_last_active: string | null;
  updated_at: string;
}

export interface HeatScoreRow {
  node_id: string;
  score: number;
  tier: string;
  profile_name: string;
  computed_at: string;
}

export interface HeatProfileRow {
  name: string;
  direct_usage: number;
  project_inheritance: number;
  structural_importance: number;
  user_boost: number;
  staleness_penalty: number;
  created_at: string;
}

// ------------------------------------------------------------
// Row ↔ Domain conversion
// ------------------------------------------------------------

import type { HeatMetadata, WeightProfile, HeatScore, HeatTier } from "./heat-types";

/** Convert a DB row to the domain HeatMetadata type. */
export function rowToHeatMetadata(row: HeatMetadataRow): HeatMetadata {
  return {
    nodeId: row.node_id,
    projectId: row.project_id,
    lastOpened: row.last_opened ? new Date(row.last_opened).getTime() : 0,
    lastExecuted: row.last_executed ? new Date(row.last_executed).getTime() : 0,
    openCount: row.open_count,
    editCount: row.edit_count,
    referenceCount: row.reference_count,
    importCount: row.import_count,
    pinned: row.pinned === 1,
    locked: row.locked === 1,
    promoted: row.promoted === 1,
    archived: row.archived === 1,
    projectLastActive: row.project_last_active
      ? new Date(row.project_last_active).getTime()
      : 0,
  };
}

/** Convert domain HeatMetadata to a row for DB insert/update. */
export function heatMetadataToRow(meta: HeatMetadata): Omit<HeatMetadataRow, "updated_at"> {
  return {
    node_id: meta.nodeId,
    project_id: meta.projectId,
    last_opened: meta.lastOpened ? new Date(meta.lastOpened).toISOString() : null,
    last_executed: meta.lastExecuted ? new Date(meta.lastExecuted).toISOString() : null,
    open_count: meta.openCount,
    edit_count: meta.editCount,
    reference_count: meta.referenceCount,
    import_count: meta.importCount,
    pinned: meta.pinned ? 1 : 0,
    locked: meta.locked ? 1 : 0,
    promoted: meta.promoted ? 1 : 0,
    archived: meta.archived ? 1 : 0,
    project_last_active: meta.projectLastActive
      ? new Date(meta.projectLastActive).toISOString()
      : null,
  };
}

/** Convert a DB profile row to domain WeightProfile. */
export function rowToWeightProfile(row: HeatProfileRow): WeightProfile {
  return {
    name: row.name,
    directUsage: row.direct_usage,
    projectInheritance: row.project_inheritance,
    structuralImportance: row.structural_importance,
    userBoost: row.user_boost,
    stalenessPenalty: row.staleness_penalty,
  };
}

/** Convert a cached score row back to domain HeatScore. */
export function rowToHeatScore(row: HeatScoreRow): Pick<HeatScore, "nodeId" | "score" | "tier" | "computedAt"> {
  return {
    nodeId: row.node_id,
    score: row.score,
    tier: row.tier as HeatTier,
    computedAt: new Date(row.computed_at).getTime(),
  };
}

// ------------------------------------------------------------
// Prepared statement templates (for hub to use)
// ------------------------------------------------------------

/** SQL for upserting heat metadata when a node event occurs. */
export const UPSERT_HEAT_METADATA_SQL = `
INSERT INTO heat_metadata (node_id, project_id, last_opened, open_count, updated_at)
VALUES (?, ?, datetime('now'), 1, datetime('now'))
ON CONFLICT(node_id) DO UPDATE SET
  last_opened = datetime('now'),
  open_count = open_count + 1,
  project_id = excluded.project_id,
  updated_at = datetime('now')
`;

/** SQL for recording a file execution. */
export const RECORD_EXECUTE_SQL = `
UPDATE heat_metadata SET
  last_executed = datetime('now'),
  updated_at = datetime('now')
WHERE node_id = ?
`;

/** SQL for updating project_last_active when entering a project. */
export const UPDATE_PROJECT_ACTIVE_SQL = `
UPDATE heat_metadata SET
  project_last_active = datetime('now'),
  updated_at = datetime('now')
WHERE project_id = ?
`;

/** SQL for toggling pinned status. */
export const TOGGLE_PIN_SQL = `
UPDATE heat_metadata SET
  pinned = CASE WHEN pinned = 1 THEN 0 ELSE 1 END,
  updated_at = datetime('now')
WHERE node_id = ?
`;

/** SQL for caching a computed score. */
export const CACHE_SCORE_SQL = `
INSERT INTO heat_scores (node_id, score, tier, profile_name, computed_at)
VALUES (?, ?, ?, ?, datetime('now'))
ON CONFLICT(node_id) DO UPDATE SET
  score = excluded.score,
  tier = excluded.tier,
  profile_name = excluded.profile_name,
  computed_at = datetime('now')
`;

/** SQL for reading all heat metadata for a project. */
export const GET_PROJECT_HEAT_SQL = `
SELECT * FROM heat_metadata WHERE project_id = ?
`;

/** SQL for reading cached scores for a project, sorted by score desc. */
export const GET_PROJECT_SCORES_SQL = `
SELECT * FROM heat_scores
WHERE node_id IN (SELECT node_id FROM heat_metadata WHERE project_id = ?)
ORDER BY score DESC
`;

/** SQL for incrementing reference count (e.g., when an edge is created). */
export const INCREMENT_REFS_SQL = `
UPDATE heat_metadata SET
  reference_count = reference_count + 1,
  updated_at = datetime('now')
WHERE node_id = ?
`;

/** SQL for decrementing reference count (e.g., when an edge is deleted). */
export const DECREMENT_REFS_SQL = `
UPDATE heat_metadata SET
  reference_count = MAX(0, reference_count - 1),
  updated_at = datetime('now')
WHERE node_id = ?
`;
