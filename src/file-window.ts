// ============================================================
// Portal Frontend — File Preview Windows
// ============================================================
// HTML overlay windows that appear when a file thumbnail is
// "opened" (re-click on selected file). The window shows the
// file's content at approximately the same size as the canvas
// thumbnail card. Windows can be dragged freely and dropped
// onto the workspace square.
// ============================================================

import { state, camera } from './state';
import { worldToScreen } from './math';
import { fetchTextPreview, getThumbnailUrl } from './api';
import type { SceneNode } from './scene-graph';

// ── Active Windows ──────────────────────────────────────────

interface FileWindow {
  id: string;          // node id
  node: SceneNode;
  el: HTMLElement;
  // Drag state
  dragging: boolean;
  dragOffsetX: number;
  dragOffsetY: number;
  // Position (screen px, top-left of window)
  posX: number;
  posY: number;
  width: number;
  height: number;
}

const _windows = new Map<string, FileWindow>();
let _container: HTMLElement;

// ── Initialize ──────────────────────────────────────────────

export function initFileWindows(): void {
  _container = document.createElement('div');
  _container.id = 'file-windows-container';
  _container.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:15;overflow:hidden;';
  document.body.appendChild(_container);
}

// ── Open / Close ────────────────────────────────────────────

export function openFileWindow(node: SceneNode, canvas: HTMLCanvasElement): void {
  // Don't open duplicate
  if (_windows.has(node.id)) {
    bringToFront(node.id);
    return;
  }

  // Calculate screen position from world coordinates
  const sc = worldToScreen(node.x, node.y, canvas);
  const screenR = node.radius * camera.zoom;

  // Match thumbnail card dimensions (portrait 3:4)
  const cardW = Math.max(180, Math.min(screenR * 1.5, 500));
  const cardH = cardW * (4 / 3);
  const posX = sc.x - cardW / 2;
  const posY = sc.y - cardH / 2;

  // Create window element
  const el = document.createElement('div');
  el.className = 'file-window';
  el.style.cssText = `
    position:absolute;
    left:${posX}px; top:${posY}px;
    width:${cardW}px; height:${cardH}px;
    pointer-events:auto;
    background:#101014;
    border:1px solid rgba(255,255,255,0.15);
    border-radius:8px;
    overflow:hidden;
    display:flex; flex-direction:column;
    box-shadow:0 8px 32px rgba(0,0,0,0.6);
    transition:box-shadow 0.2s;
    cursor:default;
    font-family:system-ui,-apple-system,sans-serif;
  `;

  // ── Title bar (draggable) ──────────────────────────────
  const titleBar = document.createElement('div');
  const ext = node.ext.toUpperCase();
  titleBar.style.cssText = `
    display:flex; align-items:center; justify-content:space-between;
    padding:6px 10px; background:rgba(255,255,255,0.06);
    border-bottom:1px solid rgba(255,255,255,0.08);
    cursor:grab; user-select:none; flex-shrink:0;
  `;
  titleBar.innerHTML = `
    <span style="font-size:11px;color:rgba(255,255,255,0.7);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:calc(100% - 60px);">
      <span style="font-weight:600;color:rgba(255,255,255,0.4);margin-right:6px;">${ext}</span>${escapeHtml(node.label)}
    </span>
    <div style="display:flex;gap:4px;">
      <button class="fw-btn fw-close" title="Close" style="width:18px;height:18px;border:none;border-radius:50%;background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.4);font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:center;">✕</button>
    </div>
  `;
  el.appendChild(titleBar);

  // ── Content area ───────────────────────────────────────
  const content = document.createElement('div');
  content.style.cssText = `
    flex:1; overflow:auto; padding:8px 10px;
    font-size:12px; color:rgba(200,210,220,0.85);
  `;
  content.innerHTML = '<div style="color:rgba(255,255,255,0.2);font-size:11px;">Loading…</div>';
  el.appendChild(content);

  // ── Resize handle ──────────────────────────────────────
  const resizeHandle = document.createElement('div');
  resizeHandle.style.cssText = `
    position:absolute; bottom:0; right:0; width:14px; height:14px;
    cursor:nwse-resize; z-index:2;
  `;
  // Draw a small grip icon via CSS
  resizeHandle.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" style="opacity:0.2;"><path d="M12 2L2 12M12 6L6 12M12 10L10 12" stroke="white" stroke-width="1"/></svg>`;
  el.appendChild(resizeHandle);

  _container.appendChild(el);

  const fw: FileWindow = {
    id: node.id, node, el, dragging: false,
    dragOffsetX: 0, dragOffsetY: 0,
    posX: posX, posY: posY,
    width: cardW, height: cardH,
  };
  _windows.set(node.id, fw);

  // Prevent canvas interactions when clicking inside window
  el.addEventListener('mousedown', (e) => { e.stopPropagation(); });
  el.addEventListener('wheel', (e) => { e.stopPropagation(); });

  // ── Load content ───────────────────────────────────────
  loadWindowContent(fw, content);

  // ── Drag handlers ──────────────────────────────────────
  bindDrag(fw, titleBar);
  bindResize(fw, resizeHandle);

  // ── Close button ───────────────────────────────────────
  const closeBtn = el.querySelector('.fw-close') as HTMLButtonElement;
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeFileWindow(node.id);
  });

  // Animate in
  el.style.opacity = '0';
  el.style.transform = 'scale(0.92)';
  requestAnimationFrame(() => {
    el.style.transition = 'opacity 0.2s, transform 0.2s';
    el.style.opacity = '1';
    el.style.transform = 'scale(1)';
  });
}

export function closeFileWindow(nodeId: string): void {
  const fw = _windows.get(nodeId);
  if (!fw) return;
  fw.el.style.transition = 'opacity 0.15s, transform 0.15s';
  fw.el.style.opacity = '0';
  fw.el.style.transform = 'scale(0.95)';
  setTimeout(() => {
    fw.el.remove();
    _windows.delete(nodeId);
  }, 150);
}

export function isFileWindowOpen(nodeId: string): boolean {
  return _windows.has(nodeId);
}

// ── Content Loading ─────────────────────────────────────────

async function loadWindowContent(fw: FileWindow, contentEl: HTMLElement): Promise<void> {
  const ext = fw.node.ext.toLowerCase();
  const isImage = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp'].includes(ext);

  if (isImage) {
    const img = document.createElement('img');
    img.src = getThumbnailUrl(fw.node.id);
    img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;display:block;margin:auto;';
    img.alt = fw.node.label;
    img.onerror = () => { contentEl.innerHTML = '<div style="color:rgba(255,255,255,0.3);">Failed to load image</div>'; };
    contentEl.innerHTML = '';
    contentEl.style.display = 'flex';
    contentEl.style.alignItems = 'center';
    contentEl.style.justifyContent = 'center';
    contentEl.appendChild(img);
    return;
  }

  // Text/metadata preview
  try {
    const preview = await fetchTextPreview(fw.node.id, 40);
    if (!preview) {
      contentEl.innerHTML = '<div style="color:rgba(255,255,255,0.3);">No preview available</div>';
      return;
    }

    const pre = document.createElement('pre');
    pre.style.cssText = `
      margin:0; padding:0; white-space:pre-wrap; word-wrap:break-word;
      font-family:'Courier New',monospace; font-size:11px;
      color:rgba(200,210,220,0.85); line-height:1.5;
    `;
    pre.textContent = preview.lines.join('\n');
    contentEl.innerHTML = '';
    contentEl.appendChild(pre);

    if (preview.total > preview.lines.length) {
      const more = document.createElement('div');
      more.style.cssText = 'margin-top:8px;font-size:10px;color:rgba(255,255,255,0.25);';
      more.textContent = `… ${preview.total - preview.lines.length} more lines`;
      contentEl.appendChild(more);
    }
  } catch {
    contentEl.innerHTML = '<div style="color:rgba(255,255,255,0.3);">Failed to load preview</div>';
  }
}

// ── Drag Handling ───────────────────────────────────────────

function bindDrag(fw: FileWindow, handle: HTMLElement): void {
  handle.addEventListener('mousedown', (e: MouseEvent) => {
    e.preventDefault();
    fw.dragging = true;
    fw.dragOffsetX = e.clientX - fw.posX;
    fw.dragOffsetY = e.clientY - fw.posY;
    handle.style.cursor = 'grabbing';
    fw.el.style.boxShadow = '0 12px 48px rgba(0,0,0,0.8)';
    fw.el.style.zIndex = String(getNextZIndex());
  });

  window.addEventListener('mousemove', (e: MouseEvent) => {
    if (!fw.dragging) return;
    fw.posX = e.clientX - fw.dragOffsetX;
    fw.posY = e.clientY - fw.dragOffsetY;
    fw.el.style.left = `${fw.posX}px`;
    fw.el.style.top = `${fw.posY}px`;

    // Check workspace drop target proximity
    checkWorkspaceProximity(fw);
  });

  window.addEventListener('mouseup', () => {
    if (!fw.dragging) return;
    fw.dragging = false;
    handle.style.cursor = 'grab';
    fw.el.style.boxShadow = '0 8px 32px rgba(0,0,0,0.6)';

    // Check if dropped on workspace
    tryDropOnWorkspace(fw);
  });
}

// ── Resize Handling ─────────────────────────────────────────

function bindResize(fw: FileWindow, handle: HTMLElement): void {
  let resizing = false;
  let startX = 0, startY = 0;
  let startW = 0, startH = 0;

  handle.addEventListener('mousedown', (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizing = true;
    startX = e.clientX;
    startY = e.clientY;
    startW = fw.width;
    startH = fw.height;
  });

  window.addEventListener('mousemove', (e: MouseEvent) => {
    if (!resizing) return;
    const newW = Math.max(140, startW + (e.clientX - startX));
    const newH = Math.max(120, startH + (e.clientY - startY));
    fw.width = newW;
    fw.height = newH;
    fw.el.style.width = `${newW}px`;
    fw.el.style.height = `${newH}px`;
  });

  window.addEventListener('mouseup', () => { resizing = false; });
}

// ── Workspace Drop Zone ─────────────────────────────────────

function checkWorkspaceProximity(fw: FileWindow): void {
  const parent = findParentWithWorkspace(fw.node);
  if (!parent) return;

  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const sc = worldToScreen(parent.x, parent.y, canvas);
  const screenR = parent.radius * camera.zoom;
  const sqSize = screenR * 0.12;

  // Window center
  const wcx = fw.posX + fw.width / 2;
  const wcy = fw.posY + fw.height / 2;
  const dist = Math.sqrt((wcx - sc.x) ** 2 + (wcy - sc.y) ** 2);

  if (dist < sqSize * 1.5) {
    fw.el.style.borderColor = 'rgba(100,200,255,0.5)';
    fw.el.style.boxShadow = '0 12px 48px rgba(0,0,0,0.8), 0 0 20px rgba(100,200,255,0.15)';
  } else {
    fw.el.style.borderColor = 'rgba(255,255,255,0.15)';
  }
}

function tryDropOnWorkspace(fw: FileWindow): void {
  const parent = findParentWithWorkspace(fw.node);
  if (!parent) return;

  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const sc = worldToScreen(parent.x, parent.y, canvas);
  const screenR = parent.radius * camera.zoom;
  const sqSize = screenR * 0.12;

  const wcx = fw.posX + fw.width / 2;
  const wcy = fw.posY + fw.height / 2;
  const dist = Math.sqrt((wcx - sc.x) ** 2 + (wcy - sc.y) ** 2);

  if (dist < sqSize * 1.5) {
    // Snap to workspace center
    fw.posX = sc.x - fw.width / 2;
    fw.posY = sc.y - fw.height / 2;
    fw.el.style.left = `${fw.posX}px`;
    fw.el.style.top = `${fw.posY}px`;
    fw.el.style.borderColor = 'rgba(100,200,255,0.4)';
    fw.el.style.boxShadow = '0 8px 32px rgba(0,0,0,0.6), 0 0 12px rgba(100,200,255,0.1)';
  } else {
    fw.el.style.borderColor = 'rgba(255,255,255,0.15)';
    fw.el.style.boxShadow = '0 8px 32px rgba(0,0,0,0.6)';
  }
}

function findParentWithWorkspace(node: SceneNode): SceneNode | null {
  // Walk up to find the nearest project or folder parent
  if (!node.parentId) return null;
  for (const root of state.roots) {
    const parent = findNodeById(root, node.parentId);
    if (parent && (parent.type === 'project' || parent.type === 'folder')) return parent;
  }
  return null;
}

function findNodeById(node: SceneNode, id: string): SceneNode | null {
  if (node.id === id) return node;
  if (node.children) {
    for (const child of node.children) {
      const found = findNodeById(child, id);
      if (found) return found;
    }
  }
  return null;
}

// ── Z-Index Management ──────────────────────────────────────

let _nextZ = 100;
function getNextZIndex(): number { return ++_nextZ; }

function bringToFront(nodeId: string): void {
  const fw = _windows.get(nodeId);
  if (fw) fw.el.style.zIndex = String(getNextZIndex());
}

// ── Utility ─────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
