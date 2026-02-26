// ============================================================
// Persistence Layer
// ============================================================
// Converts between in-memory Graph and SQLite-friendly
// flat records. The hub uses these to read/write the DB.
//
// Design:
//   - All positions are JSON-serialized into a text column
//   - Edges are their own table
//   - Events are append-only
//   - Snapshots are periodic checkpoints
//
// This file defines the schema + conversion functions.
// Actual SQLite operations live in the hub package.
// ============================================================

import type {
  Node, Edge, Project, PortalEvent, Snapshot,
  NodeId, EdgeId, ProjectId,
} from "./types";
import type { Graph } from "./graph";
import { createGraph, addNode, addEdge, addProject } from "./graph";

// ------------------------------------------------------------
// SQLite Row Types (flat, serializable)
// ------------------------------------------------------------

export interface NodeRow {
  id: string;
  name: string;
  type: string;
  ext: string;
  target: string | null;
  project_id: string | null;
  entropy_state: string;
  created_at: number;
  last_used_at: number;
  last_modified_at: number;
  last_reviewed_at: number;
  positions_json: string;      // JSON string of Record<string, {x,y}>
  color: string | null;
  width: number;
  height: number;
  tags_json: string;           // JSON string of string[]
  meta_json: string;           // JSON string of Record<string, unknown>
}

export interface EdgeRow {
  id: string;
  source_id: string;
  target_id: string;
  type: string;
  weight: number;
  label: string | null;
  directed: number;            // 0 or 1 (SQLite boolean)
  meta_json: string;
}

export interface ProjectRow {
  id: string;
  name: string;
  subtitle: string;
  color: string;
  activity: number;
  pinned: number;              // 0 or 1
  last_interacted_at: number;
  active_layout: string;
  manual_position_json: string | null;  // JSON or null
  manual_radius: number | null;
  launch_recipe_json: string;
  artifact_groups_json: string;
  tags_json: string;
  meta_json: string;
}

export interface EventRow {
  id: string;
  session_id: string;
  type: string;
  project_id: string | null;
  node_id: string | null;
  target_node_id: string | null;
  timestamp: number;
  payload_json: string;
}

// ------------------------------------------------------------
// SQL Schema (CREATE TABLE statements)
// ------------------------------------------------------------

export const SCHEMA_SQL = `
  PRAGMA journal_mode=WAL;
  PRAGMA synchronous=NORMAL;
  PRAGMA busy_timeout=5000;

  CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    ext TEXT NOT NULL DEFAULT '',
    target TEXT,
    project_id TEXT,
    entropy_state TEXT NOT NULL DEFAULT 'unassigned',
    created_at INTEGER NOT NULL,
    last_used_at INTEGER NOT NULL,
    last_modified_at INTEGER NOT NULL,
    last_reviewed_at INTEGER NOT NULL,
    positions_json TEXT NOT NULL DEFAULT '{}',
    color TEXT,
    width INTEGER NOT NULL DEFAULT 64,
    height INTEGER NOT NULL DEFAULT 50,
    tags_json TEXT NOT NULL DEFAULT '[]',
    meta_json TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS edges (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    type TEXT NOT NULL,
    weight REAL NOT NULL DEFAULT 0.5,
    label TEXT,
    directed INTEGER NOT NULL DEFAULT 1,
    meta_json TEXT NOT NULL DEFAULT '{}',
    FOREIGN KEY (source_id) REFERENCES nodes(id),
    FOREIGN KEY (target_id) REFERENCES nodes(id)
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    subtitle TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '#6B7280',
    activity REAL NOT NULL DEFAULT 0,
    pinned INTEGER NOT NULL DEFAULT 0,
    last_interacted_at INTEGER NOT NULL,
    active_layout TEXT NOT NULL DEFAULT 'orbit',
    manual_position_json TEXT,
    manual_radius REAL,
    launch_recipe_json TEXT NOT NULL DEFAULT '[]',
    artifact_groups_json TEXT NOT NULL DEFAULT '[]',
    tags_json TEXT NOT NULL DEFAULT '[]',
    meta_json TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    type TEXT NOT NULL,
    project_id TEXT,
    node_id TEXT,
    target_node_id TEXT,
    timestamp INTEGER NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    active_layout TEXT NOT NULL,
    node_positions_json TEXT NOT NULL,
    camera_state_json TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_nodes_project ON nodes(project_id);
  CREATE INDEX IF NOT EXISTS idx_nodes_entropy ON nodes(entropy_state);
  CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
  CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
  CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
  CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
  CREATE INDEX IF NOT EXISTS idx_events_project ON events(project_id);
`;

// ------------------------------------------------------------
// Conversion: Domain → Row
// ------------------------------------------------------------

export function nodeToRow(node: Node): NodeRow {
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    ext: node.ext,
    target: node.target ?? null,
    project_id: node.projectId,
    entropy_state: node.entropyState,
    created_at: node.createdAt,
    last_used_at: node.lastUsedAt,
    last_modified_at: node.lastModifiedAt,
    last_reviewed_at: node.lastReviewedAt,
    positions_json: JSON.stringify(node.positions),
    color: node.color ?? null,
    width: node.width,
    height: node.height,
    tags_json: JSON.stringify(node.tags),
    meta_json: JSON.stringify(node.meta),
  };
}

export function edgeToRow(edge: Edge): EdgeRow {
  return {
    id: edge.id,
    source_id: edge.sourceId,
    target_id: edge.targetId,
    type: edge.type,
    weight: edge.weight,
    label: edge.label ?? null,
    directed: edge.directed ? 1 : 0,
    meta_json: JSON.stringify(edge.meta),
  };
}

export function projectToRow(project: Project): ProjectRow {
  return {
    id: project.id,
    name: project.name,
    subtitle: project.subtitle,
    color: project.color,
    activity: project.activity,
    pinned: project.pinned ? 1 : 0,
    last_interacted_at: project.lastInteractedAt,
    active_layout: project.activeLayout,
    manual_position_json: project.manualPosition ? JSON.stringify(project.manualPosition) : null,
    manual_radius: project.manualRadius,
    launch_recipe_json: JSON.stringify(project.launchRecipe),
    artifact_groups_json: JSON.stringify(project.artifactGroups),
    tags_json: JSON.stringify(project.tags),
    meta_json: JSON.stringify(project.meta),
  };
}

export function eventToRow(event: PortalEvent): EventRow {
  return {
    id: event.id,
    session_id: event.sessionId,
    type: event.type,
    project_id: event.projectId ?? null,
    node_id: event.nodeId ?? null,
    target_node_id: event.targetNodeId ?? null,
    timestamp: event.timestamp,
    payload_json: JSON.stringify(event.payload),
  };
}

// ------------------------------------------------------------
// Conversion: Row → Domain
// ------------------------------------------------------------

export function rowToNode(row: NodeRow): Node {
  return {
    id: row.id,
    name: row.name,
    type: row.type as Node["type"],
    ext: row.ext,
    target: row.target ?? undefined,
    projectId: row.project_id,
    entropyState: row.entropy_state as Node["entropyState"],
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    lastModifiedAt: row.last_modified_at,
    lastReviewedAt: row.last_reviewed_at,
    positions: JSON.parse(row.positions_json),
    color: row.color ?? undefined,
    width: row.width,
    height: row.height,
    tags: JSON.parse(row.tags_json),
    meta: JSON.parse(row.meta_json),
  };
}

export function rowToEdge(row: EdgeRow): Edge {
  return {
    id: row.id,
    sourceId: row.source_id,
    targetId: row.target_id,
    type: row.type as Edge["type"],
    weight: row.weight,
    label: row.label ?? undefined,
    directed: row.directed === 1,
    meta: JSON.parse(row.meta_json),
  };
}

export function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    subtitle: row.subtitle,
    color: row.color,
    activity: row.activity,
    pinned: row.pinned === 1,
    lastInteractedAt: row.last_interacted_at,
    activeLayout: row.active_layout,
    manualPosition: row.manual_position_json ? JSON.parse(row.manual_position_json) : null,
    manualRadius: row.manual_radius,
    launchRecipe: JSON.parse(row.launch_recipe_json),
    artifactGroups: JSON.parse(row.artifact_groups_json),
    tags: JSON.parse(row.tags_json),
    meta: JSON.parse(row.meta_json),
  };
}

// ------------------------------------------------------------
// Hydrate full graph from rows
// ------------------------------------------------------------

export function hydrateGraph(
  nodeRows: NodeRow[],
  edgeRows: EdgeRow[],
  projectRows: ProjectRow[],
): Graph {
  let graph = createGraph();
  for (const row of projectRows) graph = addProject(graph, rowToProject(row));
  for (const row of nodeRows) graph = addNode(graph, rowToNode(row));
  for (const row of edgeRows) graph = addEdge(graph, rowToEdge(row));
  return graph;
}
