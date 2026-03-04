// ============================================================
// Portal Frontend — Entry Point (Scene Graph + Workspace)
// ============================================================
// Wires all modules together. Fetches projects, builds the
// scene graph, and starts the render loop.
// Workspace mode: toolbar, node dragging, position persistence.
// ============================================================

import { state } from './state';
import { fetchProjects, fetchSettings } from './api';
import { placeProjectsInGalaxy } from './placement';
import { buildProjectNodes } from './scene-graph';
import { onNavigate, onEnterProject, onExitProject, exitProject, openFile } from './navigation';
import { initInput } from './input';
import { initHUD, updateHUD } from './hud';
import { initRenderer, startRenderLoop } from './renderer';
import { initFileWindows } from './file-window';
import { initNoteEditor } from './note-editor';
import { createNote, createEdge } from './api';

// ── Canvas Setup ─────────────────────────────────────────────

const canvas = document.getElementById('canvas') as HTMLCanvasElement;

function resize(): void {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resize();
window.addEventListener('resize', resize);

// ── DOM References ───────────────────────────────────────────

const settingsPanel = document.getElementById('settings-panel')!;
const toolbar = document.getElementById('workspace-toolbar')!;
const tbName = document.getElementById('tb-name')!;
const tbColor = document.getElementById('tb-color')!;
const tbCount = document.getElementById('tb-count')!;
const tbExit = document.getElementById('tb-exit')!;
const tbOpen = document.getElementById('tb-open')!;
const tbResetLayout = document.getElementById('tb-reset-layout')!;
const tbAddNote = document.getElementById('tb-add-note')!;
const tbConnect = document.getElementById('tb-connect')!;

// ── Wire Callbacks ───────────────────────────────────────────

onNavigate(() => updateHUD());

onEnterProject(() => {
  const ap = state.activeProject;
  if (!ap) return;

  // Show toolbar
  toolbar.classList.add('active');
  document.body.classList.add('workspace-active');
  tbName.textContent = ap.label;
  tbColor.style.background = ap.color;
  tbCount.textContent = `${ap.childCount} items`;

  // Hide galaxy HUD elements
  const hudTitle = document.getElementById('hud-title')!;
  hudTitle.style.display = 'none';
});

onExitProject(() => {
  // Hide toolbar
  toolbar.classList.remove('active');
  document.body.classList.remove('workspace-active');

  // Restore galaxy HUD
  const hudTitle = document.getElementById('hud-title')!;
  hudTitle.style.display = '';
});

// ── Toolbar Actions ──────────────────────────────────────────

tbExit.addEventListener('click', () => exitProject());

tbOpen.addEventListener('click', () => {
  if (state.selectedNode && state.selectedNode.type === 'file') {
    openFile(state.selectedNode.id);
  }
});

tbResetLayout.addEventListener('click', () => {
  // Re-trigger placement for active project's children
  const ap = state.activeProject;
  if (ap && ap.children) {
    // Force re-layout by resetting loadState and reloading
    ap.loadState = 'unloaded' as const;
    ap.children = null;
    import('./lazy-loader').then(({ requestLoad }) => requestLoad(ap));
  }
});

tbAddNote.addEventListener('click', () => {
  if (!state.activeProject) return;
  const wx = state.activeProject.x;
  const wy = state.activeProject.y;
  createNote(state.activeProject.id, wx, wy).then(note => {
    if (note) {
      state.workspaceNotes.push(note);
      state.selectedNote = note;
      state.editingNote = note;
      (window as any).__portalOpenNoteEditor?.(note);
    }
  });
});

tbConnect.addEventListener('click', () => {
  if (!state.activeProject) return;
  if (state.connectionMode) {
    // Toggle off
    state.connectionMode = null;
    tbConnect.classList.remove('active');
    updateHUD();
    return;
  }
  const targetId = state.selectedNote?.id || state.selectedNode?.id;
  if (targetId) {
    const isNote = state.selectedNote !== null;
    state.connectionMode = { sourceId: targetId, sourceType: isNote ? 'note' : 'node' };
    tbConnect.classList.add('active');
    updateHUD();
  }
});

// ── Initialize Modules ───────────────────────────────────────

initRenderer(canvas);
initFileWindows();
initNoteEditor(canvas);
initInput(canvas, settingsPanel);
initHUD({
  hudProject: document.getElementById('hud-project')!,
  hudLock: document.getElementById('hud-lock')!,
  hudHint: document.getElementById('hud-hint')!,
  hudBreadcrumb: document.getElementById('hud-breadcrumb')!,
  hudLayout: document.getElementById('hud-layout')!,
  settingsPanel,
});

// ── Boot ─────────────────────────────────────────────────────

async function init(): Promise<void> {
  state.settings = await fetchSettings();
  const projects = await fetchProjects();

  if (projects === null) {
    state.error = 'Cannot connect to Hub. Is it running on port 3141?';
    state.loading = false;
    return;
  }

  if (projects.length === 0) {
    state.error = 'No projects yet. Create one via the Hub API.';
    state.loading = false;
    return;
  }

  const galaxyPositions = placeProjectsInGalaxy(projects);
  state.roots = buildProjectNodes(projects, galaxyPositions);
  state.loading = false;
  state.error = null;
}

init().then(() => {
  updateHUD();
  startRenderLoop();
});
