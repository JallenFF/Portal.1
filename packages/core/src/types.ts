// ============================================================
// Portal Core Types
// ============================================================
// These types define the entire data model. Every other package
// (layouts, physics, renderer, hub, triage) imports from here.
// 
// Design principles:
//   - Nodes and Edges are the universal primitives
//   - Layout is a strategy, not baked into the data
//   - Entropy is computed, not stored (except lastReviewedAt)
//   - Persisted state is separate from transient physics state
//   - Everything is serializable to JSON → SQLite
// ============================================================

// ------------------------------------------------------------
// Identifiers
// ------------------------------------------------------------
export type NodeId = string;    // e.g. "f01", "f02"
export type EdgeId = string;    // e.g. "e01"
export type ProjectId = string; // e.g. "proj-001"

// ------------------------------------------------------------
// Entropy
// ------------------------------------------------------------
/**
 * Entropy state tracks how "organized" a node is.
 * Used to compute the global entropy meter.
 * 
 * - unassigned: no project, no edges, no position → high entropy
 * - assigned:   belongs to a project but has no layout position → medium
 * - organized:  positioned in a layout with edges → low
 * - stale:      hasn't been interacted with in N days → needs review
 */
export type EntropyState = "unassigned" | "assigned" | "organized" | "stale";

// ------------------------------------------------------------
// Node
// ------------------------------------------------------------
/**
 * A Node is anything that exists in the system:
 * files, URLs, apps, folders, concepts, notes.
 * 
 * Nodes are the universal primitive. They can belong to
 * zero or more projects and be connected by edges.
 */
export interface Node {
  id: NodeId;
  
  // Identity
  name: string;
  type: "file" | "url" | "app" | "folder" | "concept" | "note";
  ext: string;              // "pdf", "docx", "web", "app", etc.
  target?: string;          // file path, URL, or app command
  
  // Organization
  projectId: ProjectId | null;  // null = unassigned (entropy)
  entropyState: EntropyState;
  
  // Timestamps (ms since epoch)
  createdAt: number;
  lastUsedAt: number;       // last opened/interacted
  lastModifiedAt: number;   // last content change
  lastReviewedAt: number;   // last time user triaged this node
  
  // Layout positions (persisted per layout strategy)
  // Each key is a layout strategy name (e.g. "free", "orbit")
  // Positions are relative to project center (0,0)
  positions: Record<string, { x: number; y: number }>;
  
  // Visual
  color?: string;           // override; defaults to ext-based color
  width: number;            // default 64
  height: number;           // default 50
  
  // Metadata (extensible)
  tags: string[];
  meta: Record<string, unknown>;
}

// ------------------------------------------------------------
// Edge
// ------------------------------------------------------------
/**
 * An Edge connects two nodes. Edges have types that determine
 * how they're rendered and how layouts use them.
 * 
 * - "version":      v1 → v2 of same logical artifact
 * - "dependency":   A requires B
 * - "reference":    A mentions/links to B
 * - "flow":         A → B in a process/workflow
 * - "group":        A and B belong together (soft clustering)
 * - "custom":       user-defined relationship
 */
export type EdgeType = 
  | "version" 
  | "dependency" 
  | "reference" 
  | "flow" 
  | "group" 
  | "custom";

export interface Edge {
  id: EdgeId;
  sourceId: NodeId;
  targetId: NodeId;
  type: EdgeType;
  weight: number;           // 0-1, used by physics springs
  label?: string;           // optional display label
  directed: boolean;        // true = arrow, false = bidirectional
  meta: Record<string, unknown>;
}

// ------------------------------------------------------------
// Project
// ------------------------------------------------------------
/**
 * A Project is a container for nodes. It has its own spatial
 * region on the canvas and its own layout mode.
 * 
 * At the top level, projects are positioned by the sphere
 * physics model. Inside a project, nodes are arranged by
 * whichever layout strategy is active.
 */
export interface Project {
  id: ProjectId;
  name: string;
  subtitle: string;
  color: string;
  
  // Activity & positioning
  activity: number;         // 0-1, derived from event frequency
  pinned: boolean;
  lastInteractedAt: number;
  
  // Layout
  activeLayout: string;     // "free" | "orbit" | "grid" | etc.
  
  // Persisted sphere position (top-level canvas)
  // null = let physics compute from activity + hash
  manualPosition: { x: number; y: number } | null;
  
  // Sphere sizing
  // null = auto-compute from item count
  manualRadius: number | null;
  
  // Launch recipe
  launchRecipe: LaunchAction[];
  
  // Version link groups within this project
  artifactGroups: ArtifactGroup[];
  
  // Metadata
  tags: string[];
  meta: Record<string, unknown>;
}

// ------------------------------------------------------------
// Launch Recipe
// ------------------------------------------------------------
export interface LaunchAction {
  type: "url" | "file" | "folder" | "app" | "shell" | "vscode_workspace";
  target: string;
  label?: string;
  order?: number;
}

// ------------------------------------------------------------
// Artifact Groups (version linking)
// ------------------------------------------------------------
/**
 * An ArtifactGroup represents a logical artifact that has
 * multiple versions (e.g. "Resume" with v1, v2, v3).
 * 
 * The currentVersionId is what gets exported/used by default.
 * The versions array preserves lineage.
 */
export interface ArtifactGroup {
  id: string;
  name: string;                 // "Resume", "Executive Brief"
  currentVersionId: NodeId;
  versionIds: NodeId[];         // ordered: oldest → newest
}

// ------------------------------------------------------------
// Event (for the event stream / hub)
// ------------------------------------------------------------
export type EventType =
  | "project_enter"
  | "project_exit"
  | "project_launched"
  | "snapshot_saved"
  | "node_opened"
  | "node_created"
  | "node_moved"
  | "node_linked"
  | "node_unlinked"
  | "layout_changed"
  | "mode_toggled"
  | "triage_accepted"
  | "triage_rejected"
  | "triage_deferred"
  | "entropy_threshold";

export interface PortalEvent {
  id: string;
  sessionId: string;          // groups related events atomically
  type: EventType;
  projectId?: ProjectId;
  nodeId?: NodeId;
  targetNodeId?: NodeId;      // for link events
  timestamp: number;
  payload: Record<string, unknown>;
}

// ------------------------------------------------------------
// Entropy Meter (computed, not stored)
// ------------------------------------------------------------
export interface EntropyMetrics {
  totalNodes: number;
  unassigned: number;
  assigned: number;
  organized: number;
  stale: number;
  score: number;              // 0 (fully organized) to 1 (chaos)
  needsTriage: boolean;       // true if score exceeds threshold
}

// ------------------------------------------------------------
// Snapshot (for session persistence)
// ------------------------------------------------------------
export interface Snapshot {
  projectId: ProjectId;
  timestamp: number;
  activeLayout: string;
  nodePositions: Record<NodeId, { x: number; y: number }>;
  cameraState: {
    x: number;
    y: number;
    zoom: number;
  };
}
