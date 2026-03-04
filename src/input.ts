// ============================================================
// Portal Frontend — Input Handlers (Scene Graph + Benchtop)
// ============================================================
// Continuous zoom — no threshold triggers.
// Workspace mode: drag nodes AND notes, context menu, connection mode.
// Galaxy mode: click = select, double-click = enter.
// ============================================================

import { state, camera, mouse } from './state';
import { screenToWorld, clamp } from './math';
import { hitTest, findNode } from './scene-graph';
import type { SceneNode } from './scene-graph';
import type { WorkspaceNote, WorkspaceEdge } from './types';
import { selectNode, zoomInto, goUp, openFile, clearSelection, togglePin, enterProject, exitProject } from './navigation';
import { updateHUD, renderSettingsPanel } from './hud';
import { openFileWindow } from './file-window';
import { saveNodePosition, updateNote, deleteNote as apiDeleteNote, deleteEdge as apiDeleteEdge, createNote, createEdge } from './api';

// ── Canvas reference (set by initInput) ──────────────────────

let _canvas: HTMLCanvasElement;
let _settingsPanel: HTMLElement;
let _contextMenuEl: HTMLElement;
let _lastClickTime = 0;
const DBLCLICK_WINDOW = 350; // ms

export function initInput(canvas: HTMLCanvasElement, settingsPanel: HTMLElement): void {
  _canvas = canvas;
  _settingsPanel = settingsPanel;
  _contextMenuEl = document.getElementById('context-menu')!;
  bindWheel();
  bindMouse();
  bindKeyboard();
  bindContextMenu();
}

// ── Note Hit Testing ────────────────────────────────────────

function hitTestNotes(worldX: number, worldY: number): WorkspaceNote | null {
  // Highest z_order first (front to back)
  const sorted = [...state.workspaceNotes].sort((a, b) => b.zOrder - a.zOrder);
  for (const note of sorted) {
    if (worldX >= note.x && worldX <= note.x + note.width &&
        worldY >= note.y && worldY <= note.y + note.height) {
      return note;
    }
  }
  return null;
}

function isInResizeHandle(note: WorkspaceNote, worldX: number, worldY: number): boolean {
  const handleSize = 20 / camera.zoom; // 20px in screen space
  return (worldX >= note.x + note.width - handleSize &&
          worldY >= note.y + note.height - handleSize);
}

/** Find nearest edge to a world point (within threshold) */
function hitTestEdges(worldX: number, worldY: number): WorkspaceEdge | null {
  const threshold = 12 / camera.zoom;
  let best: WorkspaceEdge | null = null;
  let bestDist = threshold;

  for (const edge of state.workspaceEdges) {
    const source = findItemWorldPos(edge.sourceId);
    const target = findItemWorldPos(edge.targetId);
    if (!source || !target) continue;

    // Approximate: distance from point to line segment
    const dist = pointToSegmentDist(worldX, worldY, source.x, source.y, target.x, target.y);
    if (dist < bestDist) {
      bestDist = dist;
      best = edge;
    }
  }
  return best;
}

function findItemWorldPos(id: string): { x: number; y: number } | null {
  const node = findNode(state.roots, id);
  if (node) return { x: node.x, y: node.y };
  const note = state.workspaceNotes.find(n => n.id === id);
  if (note) return { x: note.x + note.width / 2, y: note.y + note.height / 2 };
  return null;
}

function pointToSegmentDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt((px - ax) ** 2 + (py - ay) ** 2);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = clamp(t, 0, 1);
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
}

// ── Zoom Handler ────────────────────────────────────────────

function bindWheel(): void {
  window.addEventListener('wheel', (e: WheelEvent) => {
    e.preventDefault();

    const zoomFactor = e.deltaY > 0 ? 0.88 : 1.15;
    const newZoom = clamp(camera.targetZoom * zoomFactor, 0.02, 1e8);

    if (state.activeProject) {
      const world = screenToWorld(e.clientX, e.clientY, _canvas);
      const ratio = 1 - newZoom / camera.targetZoom;
      camera.targetX += (world.x - camera.x) * ratio;
      camera.targetY += (world.y - camera.y) * ratio;
    } else {
      const sel = state.selectedNode;
      if (sel) {
        camera.targetX = sel.x;
        camera.targetY = sel.y;
      } else {
        const world = screenToWorld(e.clientX, e.clientY, _canvas);
        const ratio = 1 - newZoom / camera.targetZoom;
        camera.targetX += (world.x - camera.x) * ratio;
        camera.targetY += (world.y - camera.y) * ratio;
      }
    }
    camera.targetZoom = newZoom;
  }, { passive: false });
}

// ── Mouse Handlers ──────────────────────────────────────────

function bindMouse(): void {
  _canvas.addEventListener('mousedown', (e: MouseEvent) => {
    if (e.button === 2) return; // right-click handled by context menu

    // Close context menu on left click
    closeContextMenu();

    mouse.down = true;
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.startX = e.clientX;
    mouse.startY = e.clientY;

    if (state.activeProject) {
      const world = screenToWorld(e.clientX, e.clientY, _canvas);

      // Connection mode: clicking selects a target
      if (state.connectionMode) {
        return; // handled in mouseup
      }

      // Check notes first (higher z-order = on top)
      const noteHit = hitTestNotes(world.x, world.y);
      if (noteHit) {
        // Check resize handle
        if (isInResizeHandle(noteHit, world.x, world.y)) {
          state.resizingNote = noteHit;
          state.dragNoteOffsetX = world.x;
          state.dragNoteOffsetY = world.y;
          _canvas.style.cursor = 'nwse-resize';
          return;
        }
        // Start dragging note
        state.dragNote = noteHit;
        state.dragNoteOffsetX = world.x - noteHit.x;
        state.dragNoteOffsetY = world.y - noteHit.y;
        // Bring to front
        const maxZ = Math.max(0, ...state.workspaceNotes.map(n => n.zOrder));
        noteHit.zOrder = maxZ + 1;
        _canvas.style.cursor = 'grabbing';
        return;
      }

      // Check nodes
      const hit = hitTest(state.roots, world.x, world.y, camera.zoom);
      if (hit && hit !== state.activeProject) {
        state.dragNode = hit;
        state.dragOffsetX = world.x - hit.x;
        state.dragOffsetY = world.y - hit.y;
        _canvas.style.cursor = 'grabbing';
      }
    }
  });

  window.addEventListener('mousemove', (e: MouseEvent) => {
    const world = screenToWorld(e.clientX, e.clientY, _canvas);
    mouse.worldX = world.x;
    mouse.worldY = world.y;

    // Store for connection mode line rendering
    (window as any).__portalMouseWorldX = world.x;
    (window as any).__portalMouseWorldY = world.y;

    const dragDist = Math.sqrt((e.clientX - mouse.startX) ** 2 + (e.clientY - mouse.startY) ** 2);

    // Note resizing
    if (state.resizingNote && mouse.down) {
      const note = state.resizingNote;
      const minSize = 60 / camera.zoom;
      note.width = Math.max(minSize, note.width + (world.x - state.dragNoteOffsetX));
      note.height = Math.max(minSize, note.height + (world.y - state.dragNoteOffsetY));
      state.dragNoteOffsetX = world.x;
      state.dragNoteOffsetY = world.y;
      return;
    }

    // Note dragging
    if (state.dragNote && mouse.down) {
      state.dragNote.x = world.x - state.dragNoteOffsetX;
      state.dragNote.y = world.y - state.dragNoteOffsetY;
      return;
    }

    // Node dragging (workspace mode)
    if (state.dragNode && mouse.down) {
      state.dragNode.x = world.x - state.dragOffsetX;
      state.dragNode.y = world.y - state.dragOffsetY;
      return;
    }

    // Panning
    if (mouse.down && dragDist > 3) {
      const dx = (e.clientX - mouse.x) / camera.zoom;
      const dy = (e.clientY - mouse.y) / camera.zoom;
      camera.targetX -= dx;
      camera.targetY -= dy;
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    }

    // Hover detection
    const hit = hitTest(state.roots, world.x, world.y, camera.zoom);
    state.hoveredNode = hit;

    // Update cursor in workspace mode
    if (state.activeProject) {
      const noteHit = hitTestNotes(world.x, world.y);
      if (noteHit && isInResizeHandle(noteHit, world.x, world.y)) {
        _canvas.style.cursor = 'nwse-resize';
      } else if (noteHit) {
        _canvas.style.cursor = 'grab';
      } else if (state.connectionMode) {
        _canvas.style.cursor = 'crosshair';
      } else if (hit && hit !== state.activeProject) {
        _canvas.style.cursor = 'grab';
      } else {
        _canvas.style.cursor = mouse.down ? 'grabbing' : 'default';
      }
    }
  });

  let _clickTimer: ReturnType<typeof setTimeout> | null = null;
  let _pendingClickHit: SceneNode | null = null;
  let _pendingNoteHit: WorkspaceNote | null = null;

  window.addEventListener('mouseup', (e: MouseEvent) => {
    if (e.button === 2) return; // right-click

    const dragDist = Math.sqrt((e.clientX - mouse.startX) ** 2 + (e.clientY - mouse.startY) ** 2);
    const world = screenToWorld(e.clientX, e.clientY, _canvas);

    // Finish note resize
    if (state.resizingNote) {
      updateNote(state.resizingNote.id, {
        width: state.resizingNote.width,
        height: state.resizingNote.height,
      });
      state.resizingNote = null;
      _canvas.style.cursor = 'default';
      mouse.down = false;
      return;
    }

    // Finish note drag
    if (state.dragNote) {
      if (dragDist > 3) {
        updateNote(state.dragNote.id, {
          x: state.dragNote.x, y: state.dragNote.y,
          z_order: state.dragNote.zOrder,
        });
      }
      state.dragNote = null;
      _canvas.style.cursor = 'default';
      mouse.down = false;
      // Fall through for click handling if it was a click
      if (dragDist >= 5) return;
    }

    // Finish node drag
    if (state.dragNode) {
      if (dragDist > 3) {
        saveNodePosition(state.dragNode.id, state.dragNode.x, state.dragNode.y);
      }
      state.dragNode = null;
      _canvas.style.cursor = 'default';
      mouse.down = false;
      return;
    }

    mouse.down = false;
    if (dragDist >= 5) return; // was a drag

    // Connection mode: click to complete
    if (state.connectionMode && state.activeProject) {
      const noteHit = hitTestNotes(world.x, world.y);
      const nodeHit = hitTest(state.roots, world.x, world.y, camera.zoom);
      const targetId = noteHit?.id || (nodeHit && nodeHit !== state.activeProject ? nodeHit.id : null);

      if (targetId && targetId !== state.connectionMode.sourceId) {
        createEdge(state.activeProject.id, state.connectionMode.sourceId, targetId).then(edge => {
          if (edge) state.workspaceEdges.push(edge);
        });
      }
      state.connectionMode = null;
      _canvas.style.cursor = 'default';
      updateHUD();
      return;
    }

    const now = Date.now();

    // Workspace mode hit testing (notes, edges, nodes)
    if (state.activeProject) {
      const noteHit = hitTestNotes(world.x, world.y);
      const nodeHit = hitTest(state.roots, world.x, world.y, camera.zoom);
      const edgeHit = !noteHit && !nodeHit ? hitTestEdges(world.x, world.y) : null;

      const timeSinceLast = now - _lastClickTime;
      _lastClickTime = now;

      // Double-click on note → edit
      if (timeSinceLast < DBLCLICK_WINDOW && noteHit && _pendingNoteHit === noteHit) {
        if (_clickTimer) { clearTimeout(_clickTimer); _clickTimer = null; }
        state.editingNote = noteHit;
        state.selectedNote = noteHit;
        state.selectedNode = null;
        state.selectedEdge = null;
        // Note editor is opened by main.ts watching editingNote
        (window as any).__portalOpenNoteEditor?.(noteHit);
        _pendingNoteHit = null;
        _pendingClickHit = null;
        return;
      }

      // Double-click on node
      if (timeSinceLast < DBLCLICK_WINDOW && nodeHit && _pendingClickHit === nodeHit) {
        if (_clickTimer) { clearTimeout(_clickTimer); _clickTimer = null; }
        if (nodeHit.type === 'file') {
          selectNode(nodeHit);
          openFile(nodeHit.id);
        } else {
          zoomInto(nodeHit, _canvas.height);
        }
        _pendingClickHit = null;
        _pendingNoteHit = null;
        return;
      }

      // Single click — defer for double-click detection
      _pendingNoteHit = noteHit;
      _pendingClickHit = nodeHit && nodeHit !== state.activeProject ? nodeHit : null;
      if (_clickTimer) clearTimeout(_clickTimer);

      _clickTimer = setTimeout(() => {
        _clickTimer = null;
        if (_pendingNoteHit) {
          state.selectedNote = _pendingNoteHit;
          state.selectedNode = null;
          state.selectedEdge = null;
        } else if (_pendingClickHit) {
          state.selectedNote = null;
          state.selectedEdge = null;
          if (_pendingClickHit.type === 'file' && _pendingClickHit === state.selectedNode) {
            openFileWindow(_pendingClickHit, _canvas);
          } else {
            selectNode(_pendingClickHit);
          }
        } else if (edgeHit) {
          state.selectedEdge = edgeHit;
          state.selectedNote = null;
          state.selectedNode = null;
        } else {
          state.selectedNote = null;
          state.selectedEdge = null;
          clearSelection();
        }
        _pendingNoteHit = null;
        _pendingClickHit = null;
        updateHUD();
      }, DBLCLICK_WINDOW);
      return;
    }

    // Galaxy mode (unchanged)
    const hit = hitTest(state.roots, world.x, world.y, camera.zoom);
    const timeSinceLast = now - _lastClickTime;
    _lastClickTime = now;

    if (timeSinceLast < DBLCLICK_WINDOW && _pendingClickHit && hit) {
      if (_clickTimer) { clearTimeout(_clickTimer); _clickTimer = null; }
      if (hit.type === 'file') {
        selectNode(hit);
        openFile(hit.id);
      } else {
        zoomInto(hit, _canvas.height);
      }
      _pendingClickHit = null;
      return;
    }

    _pendingClickHit = hit;
    if (_clickTimer) clearTimeout(_clickTimer);

    _clickTimer = setTimeout(() => {
      _clickTimer = null;
      if (_pendingClickHit) {
        if (_pendingClickHit === state.selectedNode && _pendingClickHit.type !== 'file') {
          zoomInto(_pendingClickHit, _canvas.height);
        } else if (_pendingClickHit === state.selectedNode && _pendingClickHit.type === 'file') {
          openFileWindow(_pendingClickHit, _canvas);
        } else {
          selectNode(_pendingClickHit);
        }
      } else {
        clearSelection();
      }
      _pendingClickHit = null;
    }, DBLCLICK_WINDOW);
  });
}

// ── Context Menu ────────────────────────────────────────────

function bindContextMenu(): void {
  _canvas.addEventListener('contextmenu', (e: MouseEvent) => {
    e.preventDefault();
    if (!state.activeProject) return;

    const world = screenToWorld(e.clientX, e.clientY, _canvas);

    // Determine what was right-clicked
    const noteHit = hitTestNotes(world.x, world.y);
    const nodeHit = hitTest(state.roots, world.x, world.y, camera.zoom);
    const edgeHit = !noteHit && !nodeHit ? hitTestEdges(world.x, world.y) : null;

    let target: 'canvas' | 'node' | 'note' | 'edge' = 'canvas';
    let targetId: string | null = null;

    if (noteHit) {
      target = 'note'; targetId = noteHit.id;
      state.selectedNote = noteHit;
      state.selectedNode = null;
      state.selectedEdge = null;
    } else if (nodeHit && nodeHit !== state.activeProject) {
      target = 'node'; targetId = nodeHit.id;
      state.selectedNote = null;
      state.selectedEdge = null;
      selectNode(nodeHit);
    } else if (edgeHit) {
      target = 'edge'; targetId = edgeHit.id;
      state.selectedEdge = edgeHit;
      state.selectedNote = null;
      state.selectedNode = null;
    }

    state.contextMenu = { x: e.clientX, y: e.clientY, worldX: world.x, worldY: world.y, target, targetId };
    showContextMenu(e.clientX, e.clientY, target, targetId);
  });

  // Close on click outside
  document.addEventListener('click', (e: MouseEvent) => {
    if (state.contextMenu && !(e.target as HTMLElement).closest('#context-menu')) {
      closeContextMenu();
    }
  });
}

function showContextMenu(x: number, y: number, target: string, targetId: string | null): void {
  const menu = _contextMenuEl;
  if (!menu) return;

  let html = '';

  if (target === 'canvas') {
    html = `
      <div class="ctx-item" data-action="add-note">Add Note</div>
    `;
  } else if (target === 'note') {
    html = `
      <div class="ctx-item" data-action="edit-note">Edit</div>
      <div class="ctx-item" data-action="connect-from">Connect From</div>
      <div class="ctx-divider"></div>
      <div class="ctx-item" data-action="color-yellow" data-color="#FFF8DC">Yellow</div>
      <div class="ctx-item" data-action="color-blue" data-color="#DBEAFE">Blue</div>
      <div class="ctx-item" data-action="color-green" data-color="#DCFCE7">Green</div>
      <div class="ctx-item" data-action="color-pink" data-color="#FCE7F3">Pink</div>
      <div class="ctx-divider"></div>
      <div class="ctx-item ctx-danger" data-action="delete-note">Delete</div>
    `;
  } else if (target === 'node') {
    const node = findNode(state.roots, targetId!);
    const isPinned = node?.isPinned;
    html = `
      <div class="ctx-item" data-action="connect-from">Connect From</div>
      <div class="ctx-item" data-action="toggle-pin">${isPinned ? 'Unpin' : 'Pin'}</div>
      ${node?.type === 'file' ? '<div class="ctx-item" data-action="open-file">Open</div>' : ''}
    `;
  } else if (target === 'edge') {
    html = `
      <div class="ctx-item ctx-danger" data-action="delete-edge">Delete Connection</div>
    `;
  }

  menu.innerHTML = html;
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.style.display = 'block';

  // Bind actions
  menu.querySelectorAll('.ctx-item').forEach(item => {
    item.addEventListener('click', (ev) => {
      const action = (ev.target as HTMLElement).dataset.action;
      handleContextAction(action!, targetId);
      closeContextMenu();
    });
  });
}

function closeContextMenu(): void {
  state.contextMenu = null;
  if (_contextMenuEl) _contextMenuEl.style.display = 'none';
}

async function handleContextAction(action: string, targetId: string | null): Promise<void> {
  const cm = state.contextMenu;

  if (action === 'add-note' && cm && state.activeProject) {
    const note = await createNote(state.activeProject.id, cm.worldX, cm.worldY);
    if (note) {
      state.workspaceNotes.push(note);
      state.selectedNote = note;
      state.editingNote = note;
      (window as any).__portalOpenNoteEditor?.(note);
    }
  }

  if (action === 'edit-note' && targetId) {
    const note = state.workspaceNotes.find(n => n.id === targetId);
    if (note) {
      state.editingNote = note;
      (window as any).__portalOpenNoteEditor?.(note);
    }
  }

  if (action === 'delete-note' && targetId) {
    await apiDeleteNote(targetId);
    state.workspaceNotes = state.workspaceNotes.filter(n => n.id !== targetId);
    if (state.selectedNote?.id === targetId) state.selectedNote = null;
    // Remove any edges connected to this note
    const connectedEdges = state.workspaceEdges.filter(e => e.sourceId === targetId || e.targetId === targetId);
    for (const edge of connectedEdges) {
      await apiDeleteEdge(edge.id);
    }
    state.workspaceEdges = state.workspaceEdges.filter(e => e.sourceId !== targetId && e.targetId !== targetId);
  }

  if (action === 'delete-edge' && targetId) {
    await apiDeleteEdge(targetId);
    state.workspaceEdges = state.workspaceEdges.filter(e => e.id !== targetId);
    if (state.selectedEdge?.id === targetId) state.selectedEdge = null;
  }

  if (action === 'connect-from' && targetId) {
    const isNote = state.workspaceNotes.some(n => n.id === targetId);
    state.connectionMode = { sourceId: targetId, sourceType: isNote ? 'note' : 'node' };
    updateHUD();
  }

  if (action === 'toggle-pin' && targetId) {
    await togglePin(targetId);
    const node = findNode(state.roots, targetId);
    if (node) node.isPinned = !node.isPinned;
  }

  if (action === 'open-file' && targetId) {
    openFile(targetId);
  }

  if (action?.startsWith('color-') && targetId) {
    const color = (document.querySelector(`[data-action="${action}"]`) as HTMLElement)?.dataset.color;
    if (color) {
      const note = state.workspaceNotes.find(n => n.id === targetId);
      if (note) {
        note.color = color;
        await updateNote(targetId, { color });
      }
    }
  }
}

// ── Keyboard ────────────────────────────────────────────────

function bindKeyboard(): void {
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    // Don't handle keys while editing a note
    if (state.editingNote) return;

    // Lock toggle
    if (e.key === 'l' || e.key === 'L') {
      state.locked = !state.locked;
      updateHUD();
    }

    // Enter: edit note, or zoom into selected folder/project, or open selected file
    if (e.key === 'Enter') {
      if (state.selectedNote) {
        state.editingNote = state.selectedNote;
        (window as any).__portalOpenNoteEditor?.(state.selectedNote);
      } else if (state.selectedNode) {
        if (state.selectedNode.type === 'file') {
          openFile(state.selectedNode.id);
        } else {
          zoomInto(state.selectedNode, _canvas.height);
        }
      }
    }

    // Escape: close context menu, exit connection mode, exit workspace, or go up
    if (e.key === 'Escape') {
      if (state.contextMenu) {
        closeContextMenu();
      } else if (state.connectionMode) {
        state.connectionMode = null;
        _canvas.style.cursor = 'default';
        updateHUD();
      } else if (state.selectedNote) {
        state.selectedNote = null;
        state.selectedEdge = null;
        updateHUD();
      } else if (state.showSettings) {
        state.showSettings = false;
        _settingsPanel.style.display = 'none';
      } else if (state.activeProject) {
        goUp();
      } else if (state.selectedNode) {
        goUp();
      }
    }

    // Delete: remove selected note or edge
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.activeProject) {
      if (state.selectedNote) {
        const noteId = state.selectedNote.id;
        apiDeleteNote(noteId).then(() => {
          state.workspaceNotes = state.workspaceNotes.filter(n => n.id !== noteId);
          // Clean up connected edges
          const connected = state.workspaceEdges.filter(e2 => e2.sourceId === noteId || e2.targetId === noteId);
          for (const edge of connected) apiDeleteEdge(edge.id);
          state.workspaceEdges = state.workspaceEdges.filter(e2 => e2.sourceId !== noteId && e2.targetId !== noteId);
        });
        state.selectedNote = null;
        updateHUD();
      } else if (state.selectedEdge) {
        apiDeleteEdge(state.selectedEdge.id);
        state.workspaceEdges = state.workspaceEdges.filter(e2 => e2.id !== state.selectedEdge!.id);
        state.selectedEdge = null;
        updateHUD();
      }
    }

    // N: create new note at center of view
    if ((e.key === 'n' || e.key === 'N') && state.activeProject && !e.ctrlKey) {
      const wx = camera.x;
      const wy = camera.y;
      createNote(state.activeProject.id, wx, wy).then(note => {
        if (note) {
          state.workspaceNotes.push(note);
          state.selectedNote = note;
          state.editingNote = note;
          (window as any).__portalOpenNoteEditor?.(note);
        }
      });
    }

    // C: enter connection mode
    if ((e.key === 'c' || e.key === 'C') && state.activeProject && !e.ctrlKey) {
      const targetId = state.selectedNote?.id || state.selectedNode?.id;
      if (targetId) {
        const isNote = state.selectedNote !== null;
        state.connectionMode = { sourceId: targetId, sourceType: isNote ? 'note' : 'node' };
        _canvas.style.cursor = 'crosshair';
        updateHUD();
      }
    }

    // Layout toggle (galaxy mode only)
    if ((e.key === 'g' || e.key === 'G') && !state.activeProject) {
      state.layout = state.layout === 'orbit' ? 'grid' : 'orbit';
      updateHUD();
    }

    // Settings panel
    if (e.key === 's' && e.ctrlKey) {
      e.preventDefault();
      state.showSettings = !state.showSettings;
      _settingsPanel.style.display = state.showSettings ? 'block' : 'none';
      if (state.showSettings) renderSettingsPanel();
    }

    // Pin toggle on selected file
    if ((e.key === 'p' || e.key === 'P') && state.selectedNode && state.selectedNode.type === 'file') {
      togglePin(state.selectedNode!.id);
      state.selectedNode.isPinned = !state.selectedNode.isPinned;
    }
  });
}
