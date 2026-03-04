// ============================================================
// Portal Frontend — Input Handlers (Scene Graph)
// ============================================================
// Continuous zoom — no threshold triggers.
// In workspace mode: mousedown on node = drag it.
// In galaxy mode: click = select, double-click = enter.
// ============================================================

import { state, camera, mouse } from './state';
import { screenToWorld, clamp } from './math';
import { hitTest } from './scene-graph';
import type { SceneNode } from './scene-graph';
import { selectNode, zoomInto, goUp, openFile, clearSelection, togglePin, enterProject, exitProject } from './navigation';
import { updateHUD, renderSettingsPanel } from './hud';
import { openFileWindow } from './file-window';
import { saveNodePosition } from './api';

// ── Canvas reference (set by initInput) ──────────────────────

let _canvas: HTMLCanvasElement;
let _settingsPanel: HTMLElement;
let _lastClickTime = 0;
const DBLCLICK_WINDOW = 350; // ms

export function initInput(canvas: HTMLCanvasElement, settingsPanel: HTMLElement): void {
  _canvas = canvas;
  _settingsPanel = settingsPanel;
  bindWheel();
  bindMouse();
  bindKeyboard();
}

// ── Zoom Handler ────────────────────────────────────────────

function bindWheel(): void {
  window.addEventListener('wheel', (e: WheelEvent) => {
    e.preventDefault();

    const zoomFactor = e.deltaY > 0 ? 0.88 : 1.15;
    const newZoom = clamp(camera.targetZoom * zoomFactor, 0.02, 1e8);

    // In workspace mode: always zoom toward cursor
    if (state.activeProject) {
      const world = screenToWorld(e.clientX, e.clientY, _canvas);
      const ratio = 1 - newZoom / camera.targetZoom;
      camera.targetX += (world.x - camera.x) * ratio;
      camera.targetY += (world.y - camera.y) * ratio;
    } else {
      // Galaxy: zoom toward selected node or cursor
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
    mouse.down = true;
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.startX = e.clientX;
    mouse.startY = e.clientY;

    // In workspace mode, check if we're clicking a node to drag it
    if (state.activeProject) {
      const world = screenToWorld(e.clientX, e.clientY, _canvas);
      const hit = hitTest(state.roots, world.x, world.y, camera.zoom);
      if (hit && hit !== state.activeProject) {
        // Start dragging this node
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

    const dragDist = Math.sqrt((e.clientX - mouse.startX) ** 2 + (e.clientY - mouse.startY) ** 2);

    // Node dragging (workspace mode)
    if (state.dragNode && mouse.down) {
      state.dragNode.x = world.x - state.dragOffsetX;
      state.dragNode.y = world.y - state.dragOffsetY;
      return; // don't pan while dragging a node
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

    // Hover detection via scene graph hit test
    const hit = hitTest(state.roots, world.x, world.y, camera.zoom);
    state.hoveredNode = hit;

    // Update cursor in workspace mode
    if (state.activeProject) {
      if (hit && hit !== state.activeProject) {
        _canvas.style.cursor = 'grab';
      } else {
        _canvas.style.cursor = mouse.down ? 'grabbing' : 'default';
      }
    }
  });

  let _clickTimer: ReturnType<typeof setTimeout> | null = null;
  let _pendingClickHit: SceneNode | null = null;

  window.addEventListener('mouseup', (e: MouseEvent) => {
    const dragDist = Math.sqrt((e.clientX - mouse.startX) ** 2 + (e.clientY - mouse.startY) ** 2);

    // Finish node drag
    if (state.dragNode) {
      if (dragDist > 3) {
        // Save the new position
        saveNodePosition(state.dragNode.id, state.dragNode.x, state.dragNode.y);
      }
      state.dragNode = null;
      _canvas.style.cursor = 'default';
      mouse.down = false;
      return;
    }

    mouse.down = false;
    if (dragDist >= 5) return; // was a drag, not a click

    const now = Date.now();
    const world = screenToWorld(e.clientX, e.clientY, _canvas);
    const hit = hitTest(state.roots, world.x, world.y, camera.zoom);

    const timeSinceLast = now - _lastClickTime;
    _lastClickTime = now;

    if (timeSinceLast < DBLCLICK_WINDOW && _pendingClickHit && hit) {
      // Double-click
      if (_clickTimer) { clearTimeout(_clickTimer); _clickTimer = null; }

      if (hit.type === 'file') {
        selectNode(hit);
        openFile(hit.id);
      } else {
        // Double-click folder/project → enter workspace
        zoomInto(hit, _canvas.height);
      }
      _pendingClickHit = null;
      return;
    }

    // Single click — defer to allow double-click detection
    _pendingClickHit = hit;
    if (_clickTimer) clearTimeout(_clickTimer);

    _clickTimer = setTimeout(() => {
      _clickTimer = null;
      if (_pendingClickHit) {
        if (state.activeProject) {
          // In workspace mode: single click selects
          if (_pendingClickHit.type === 'file' && _pendingClickHit === state.selectedNode) {
            openFileWindow(_pendingClickHit, _canvas);
          } else {
            selectNode(_pendingClickHit);
          }
        } else {
          // Galaxy mode: existing behavior
          if (_pendingClickHit === state.selectedNode && _pendingClickHit.type !== 'file') {
            zoomInto(_pendingClickHit, _canvas.height);
          } else if (_pendingClickHit === state.selectedNode && _pendingClickHit.type === 'file') {
            openFileWindow(_pendingClickHit, _canvas);
          } else {
            selectNode(_pendingClickHit);
          }
        }
      } else {
        clearSelection();
      }
      _pendingClickHit = null;
    }, DBLCLICK_WINDOW);
  });
}

// ── Keyboard ────────────────────────────────────────────────

function bindKeyboard(): void {
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    // Lock toggle
    if (e.key === 'l' || e.key === 'L') {
      state.locked = !state.locked;
      updateHUD();
    }

    // Enter: zoom into selected folder/project, or open selected file
    if (e.key === 'Enter' && state.selectedNode) {
      if (state.selectedNode.type === 'file') {
        openFile(state.selectedNode.id);
      } else {
        zoomInto(state.selectedNode, _canvas.height);
      }
    }

    // Escape: exit workspace or go up
    if (e.key === 'Escape') {
      if (state.showSettings) {
        state.showSettings = false;
        _settingsPanel.style.display = 'none';
      } else if (state.activeProject) {
        goUp();
      } else if (state.selectedNode) {
        goUp();
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
    }
  });
}
