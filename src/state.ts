// ============================================================
// Portal Frontend — Centralized State
// ============================================================
// Unified scene graph model. No binary galaxy/solar-system
// state machine. Camera moves freely in one continuous space.
// ============================================================

import type { Camera, Mouse, WorkspaceNote, WorkspaceEdge } from './types';
import type { SceneNode } from './scene-graph';

// ── Camera ───────────────────────────────────────────────────

export const camera: Camera = {
  x: 0, y: 0,
  zoom: 0.5, targetZoom: 0.5,
  targetX: 0, targetY: 0,
};

// ── Mouse ────────────────────────────────────────────────────

export const mouse: Mouse = {
  x: 0, y: 0,
  startX: 0, startY: 0,
  worldX: 0, worldY: 0,
  down: false,
};

// ── App State (Scene Graph) ──────────────────────────────────

export interface AppStateV2 {
  // Scene graph
  roots: SceneNode[];              // top-level project nodes
  selectedNode: SceneNode | null;  // clicked/focused node
  hoveredNode: SceneNode | null;   // mouse-over node

  // Project workspace mode
  activeProject: SceneNode | null; // when set, we're inside this project's workspace
  dragNode: SceneNode | null;      // node currently being dragged (workspace mode only)
  dragOffsetX: number;             // world-space drag offset
  dragOffsetY: number;

  // Workspace benchtop
  workspaceNotes: WorkspaceNote[];
  workspaceEdges: WorkspaceEdge[];
  selectedNote: WorkspaceNote | null;
  selectedEdge: WorkspaceEdge | null;
  editingNote: WorkspaceNote | null;
  dragNote: WorkspaceNote | null;
  dragNoteOffsetX: number;
  dragNoteOffsetY: number;
  resizingNote: WorkspaceNote | null;
  connectionMode: null | { sourceId: string; sourceType: 'node' | 'note' };
  contextMenu: null | { x: number; y: number; worldX: number; worldY: number;
    target: 'canvas' | 'node' | 'note' | 'edge'; targetId: string | null };

  // App
  loading: boolean;
  error: string | null;
  layout: 'orbit' | 'grid';
  showSettings: boolean;
  settings: Record<string, string>;
  locked: boolean;
}

export const state: AppStateV2 = {
  roots: [],
  selectedNode: null,
  hoveredNode: null,
  activeProject: null,
  dragNode: null,
  dragOffsetX: 0,
  dragOffsetY: 0,
  workspaceNotes: [],
  workspaceEdges: [],
  selectedNote: null,
  selectedEdge: null,
  editingNote: null,
  dragNote: null,
  dragNoteOffsetX: 0,
  dragNoteOffsetY: 0,
  resizingNote: null,
  connectionMode: null,
  contextMenu: null,
  loading: true,
  error: null,
  layout: 'orbit',
  showSettings: false,
  settings: {},
  locked: true,
};

// ── Constants ────────────────────────────────────────────────

export const DEFAULT_SETTINGS: Record<string, string> = {
  'orbit.inner_hours': '48',
  'orbit.mid1_days': '4',
  'orbit.mid2_weeks': '2',
  'orbit.outer_weeks': '3',
  'orbit.weekend_extend': 'false',
  'orbit.weekend_hours': '72',
  'galaxy.project_orbit_days': '30',
  'heat.glow_enabled': 'false',
};
