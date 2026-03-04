// ============================================================
// Portal Frontend — Shared Types
// ============================================================
// SceneNode and AppStateV2 are defined in scene-graph.ts and
// state.ts respectively. This file holds only primitive types
// shared across modules.
// ============================================================

export interface Camera {
  x: number;
  y: number;
  zoom: number;
  targetZoom: number;
  targetX: number;
  targetY: number;
}

export interface Mouse {
  x: number;
  y: number;
  startX: number;
  startY: number;
  worldX: number;
  worldY: number;
  down: boolean;
}

// ── Workspace Types ──────────────────────────────────────

export interface WorkspaceNote {
  id: string;
  projectId: string;
  content: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  zOrder: number;
}

export interface WorkspaceEdge {
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
  label?: string;
  meta?: Record<string, any>;
}
