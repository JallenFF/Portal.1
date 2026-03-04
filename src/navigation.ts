// ============================================================
// Portal Frontend — Navigation (Scene Graph)
// ============================================================
// selectNode() centers camera on a node.
// enterProject() / exitProject() toggle workspace mode.
// goUp() navigates up or exits workspace.
// ============================================================

import { state, camera } from './state';
import { openFile as apiOpenFile, togglePin as apiTogglePin, fetchWorkspaceNotes, fetchWorkspaceEdges } from './api';
import { requestLoad } from './lazy-loader';
import { findNode } from './scene-graph';
import type { SceneNode } from './scene-graph';

// ── Injected dependencies (set by main.ts) ───────────────────

let _onNavigate: () => void = () => {};
let _onEnterProject: () => void = () => {};
let _onExitProject: () => void = () => {};

/** Register a callback that fires after any navigation action. */
export function onNavigate(cb: () => void): void {
  _onNavigate = cb;
}

/** Register a callback that fires when entering a project workspace. */
export function onEnterProject(cb: () => void): void {
  _onEnterProject = cb;
}

/** Register a callback that fires when exiting a project workspace. */
export function onExitProject(cb: () => void): void {
  _onExitProject = cb;
}

// ── Select Node ──────────────────────────────────────────────

/**
 * Select a node and smoothly center the camera on it.
 * Also triggers lazy-load of its children so they're ready
 * when the user zooms closer.
 */
export function selectNode(node: SceneNode | null): void {
  state.selectedNode = node;

  if (node) {
    // In workspace mode, don't auto-center camera (user is arranging things)
    if (!state.activeProject) {
      camera.targetX = node.x;
      camera.targetY = node.y;
    }

    // Pre-load children if not yet loaded
    if (node.childCount > 0 && node.loadState === 'unloaded') {
      requestLoad(node);
    }
  }

  _onNavigate();
}

// ── Enter Project Workspace ──────────────────────────────────

/**
 * Enter a project's workspace view. Camera zooms to fill the
 * project, toolbar appears, drag-to-move becomes available.
 */
export function enterProject(node: SceneNode, canvasHeight: number): void {
  if (node.type !== 'project' && node.type !== 'folder') return;

  state.activeProject = node;
  state.selectedNode = null;

  // Center and zoom to fill viewport — project fills ~80% of height
  camera.targetX = node.x;
  camera.targetY = node.y;
  const desiredScreenR = canvasHeight * 0.4;
  camera.targetZoom = desiredScreenR / node.radius;

  // Pre-load children
  if (node.childCount > 0 && node.loadState === 'unloaded') {
    requestLoad(node);
  }

  // Load workspace data (notes + edges)
  loadWorkspaceData(node.id);

  _onEnterProject();
  _onNavigate();
}

async function loadWorkspaceData(projectId: string): Promise<void> {
  const [notes, edges] = await Promise.all([
    fetchWorkspaceNotes(projectId),
    fetchWorkspaceEdges(projectId),
  ]);
  state.workspaceNotes = notes;
  state.workspaceEdges = edges;
}

// ── Exit Project Workspace ───────────────────────────────────

/**
 * Exit the current project workspace and return to galaxy view.
 */
export function exitProject(): void {
  if (!state.activeProject) return;

  state.activeProject = null;
  state.selectedNode = null;
  state.dragNode = null;
  state.selectedNote = null;
  state.selectedEdge = null;
  state.editingNote = null;
  state.dragNote = null;
  state.resizingNote = null;
  state.connectionMode = null;
  state.contextMenu = null;
  state.workspaceNotes = [];
  state.workspaceEdges = [];

  // Pull back to galaxy overview
  camera.targetX = 0;
  camera.targetY = 0;
  camera.targetZoom = 0.5;

  _onExitProject();
  _onNavigate();
}

// ── Zoom Into ────────────────────────────────────────────────

/**
 * Zoom the camera closer to the currently selected node.
 * If in galaxy mode and target is a project, enter workspace instead.
 */
export function zoomInto(node: SceneNode, canvasHeight: number): void {
  // If in galaxy view and double-clicking a project → enter workspace
  if (!state.activeProject && node.type === 'project') {
    enterProject(node, canvasHeight);
    return;
  }

  // If in workspace and double-clicking a folder → enter that folder's workspace
  if (state.activeProject && node.type === 'folder') {
    enterProject(node, canvasHeight);
    return;
  }

  // Default: just zoom in
  state.selectedNode = node;
  camera.targetX = node.x;
  camera.targetY = node.y;
  const desiredScreenR = canvasHeight * 0.3;
  camera.targetZoom = desiredScreenR / node.radius;

  if (node.childCount > 0 && node.loadState === 'unloaded') {
    requestLoad(node);
  }

  _onNavigate();
}

// ── Go Up ────────────────────────────────────────────────────

/**
 * Navigate up. If in workspace mode, exit to galaxy.
 * If a node is selected, go to parent. Otherwise zoom out.
 */
export function goUp(): void {
  // If in workspace mode, exit it
  if (state.activeProject) {
    // If the active project has a parent (we entered a subfolder), go up to parent
    if (state.activeProject.parentId) {
      const parent = findNode(state.roots, state.activeProject.parentId);
      if (parent && (parent.type === 'project' || parent.type === 'folder')) {
        const canvas = document.getElementById('canvas') as HTMLCanvasElement;
        enterProject(parent, canvas.height);
        return;
      }
    }
    exitProject();
    return;
  }

  const sel = state.selectedNode;

  if (sel && sel.parentId) {
    const parent = findNode(state.roots, sel.parentId);
    if (parent) {
      selectNode(parent);
      camera.targetZoom = Math.max(camera.targetZoom * 0.4, 0.08);
      return;
    }
  }

  // At root level — deselect and zoom out to galaxy
  state.selectedNode = null;
  camera.targetX = 0;
  camera.targetY = 0;
  camera.targetZoom = 0.5;
  _onNavigate();
}

// ── Clear Selection ──────────────────────────────────────────

export function clearSelection(): void {
  state.selectedNode = null;
  _onNavigate();
}

// ── File Actions ─────────────────────────────────────────────

export function openFile(nodeId: string): void {
  apiOpenFile(nodeId).then((result) => {
    if (result.error) {
      console.error('Open failed:', result.error);
    }
  });
}

export async function togglePin(nodeId: string): Promise<void> {
  await apiTogglePin(nodeId);
}
