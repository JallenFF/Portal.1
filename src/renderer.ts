// ============================================================
// Portal Frontend — Unified Recursive Renderer
// ============================================================
// Single render pass: recursively draws the scene graph.
// Semantic zoom: detail appears/disappears based on screen-space
// size. No binary galaxy/solar-system mode switch.
//
// Render rules:
//   screenR < 2px  → skip entirely
//   screenR < 8px  → dot only (no label)
//   screenR < 30px → node + label (no children)
//   screenR >= 30px → node + label + children (if loaded)
//   screenR >= 40px → trigger lazy load (if unloaded)
// ============================================================

import { state, camera } from './state';
import type { SceneNode } from './scene-graph';
import { findNode } from './scene-graph';
import { requestLoad, shouldLoad } from './lazy-loader';
import { lerp, clamp, worldToScreen, roundRect } from './math';
import { getExtColor } from './colors';
import { getTextPreview, getImageThumbnail, isContentLoading } from './content-cache';
import type { WorkspaceNote, WorkspaceEdge } from './types';

let _canvas: HTMLCanvasElement;
let _ctx: CanvasRenderingContext2D;
let _lastTime = 0;
let _time = 0; // accumulated time for animations

export function initRenderer(canvas: HTMLCanvasElement): void {
  _canvas = canvas;
  _ctx = canvas.getContext('2d')!;
}

export function startRenderLoop(): void {
  _lastTime = performance.now();
  requestAnimationFrame(render);
}

// ── Camera Easing ────────────────────────────────────────────

const CAM_EASE_POS = 8;
const CAM_EASE_ZOOM = 10;

// ── Main Render Loop ─────────────────────────────────────────

function render(): void {
  const now = performance.now();
  const dt = Math.min((now - _lastTime) / 1000, 0.05);
  _lastTime = now;
  _time += dt;

  // Frame-rate independent exponential easing
  const tPos = 1 - Math.exp(-CAM_EASE_POS * dt);
  const tZoom = 1 - Math.exp(-CAM_EASE_ZOOM * dt);
  camera.x = lerp(camera.x, camera.targetX, tPos);
  camera.y = lerp(camera.y, camera.targetY, tPos);
  camera.zoom = lerp(camera.zoom, camera.targetZoom, tZoom);

  const W = _canvas.width;
  const H = _canvas.height;

  // Clear
  _ctx.clearRect(0, 0, W, H);
  _ctx.fillStyle = '#08080A';
  _ctx.fillRect(0, 0, W, H);

  // Loading / error states
  if (state.loading) {
    drawCenteredText('Connecting to Hub...', 'rgba(255,255,255,0.3)', 14);
    requestAnimationFrame(render);
    return;
  }

  if (state.error && state.roots.length === 0) {
    drawCenteredText(state.error, 'rgba(255,255,255,0.4)', 13);
    requestAnimationFrame(render);
    return;
  }

  if (state.activeProject) {
    // ── Workspace Mode ────────────────────────────────────────
    drawWorkspaceBackground(W, H, state.activeProject);
    drawDotGrid(W, H);

    // 1. Edges (behind everything)
    drawWorkspaceEdges(W, H);

    // 2. Render nodes
    const ap = state.activeProject;
    if (ap.children) {
      for (const child of ap.children) {
        renderNode(child, W, H);
      }
    }

    // 3. Sticky notes (on top of nodes)
    drawWorkspaceNotes(W, H);

    // 4. Project boundary ring (subtle)
    const sc = worldToScreen(ap.x, ap.y, _canvas);
    const screenR = ap.radius * camera.zoom;
    _ctx.strokeStyle = ap.color + '15';
    _ctx.lineWidth = 2;
    _ctx.setLineDash([8, 8]);
    _ctx.beginPath();
    _ctx.arc(sc.x, sc.y, screenR, 0, Math.PI * 2);
    _ctx.stroke();
    _ctx.setLineDash([]);

    // 5. Selection rings
    if (state.selectedNode && state.selectedNode !== ap) {
      drawSelectionRing(state.selectedNode);
    }

    // 6. Drag indicators
    if (state.dragNode) {
      drawDragIndicator(state.dragNode);
    }

    // 7. Connection mode line (dashed line following cursor)
    if (state.connectionMode) {
      drawConnectionModeLine(W, H);
    }

    // 8. Context menu is HTML overlay (not drawn here)
  } else {
    // ── Galaxy Mode ───────────────────────────────────────────
    drawDotGrid(W, H);

    for (const root of state.roots) {
      renderNode(root, W, H);
    }

    if (state.selectedNode) {
      drawSelectionRing(state.selectedNode);
    }

    drawMinimap(W, H);
  }

  requestAnimationFrame(render);
}

// ── Recursive Node Renderer ──────────────────────────────────

function renderNode(node: SceneNode, W: number, H: number): void {
  const sc = worldToScreen(node.x, node.y, _canvas);
  const screenR = node.radius * camera.zoom;

  // Semantic zoom: too small to see → skip
  if (screenR < 2) return;

  // Viewport culling
  if (sc.x < -screenR - 50 || sc.x > W + screenR + 50 ||
      sc.y < -screenR - 50 || sc.y > H + screenR + 50) return;

  const isHovered = state.hoveredNode === node;
  const isSelected = state.selectedNode === node;

  // Draw based on node type
  if (node.type === 'project') {
    drawProjectNode(sc, screenR, node, isHovered, isSelected);
  } else if (node.type === 'folder') {
    drawFolderNode(sc, screenR, node, isHovered, isSelected);
  } else {
    drawFileNode(sc, screenR, node, isHovered, isSelected);
  }

  // Pin badge
  if (node.isPinned && screenR > 10) {
    drawPinBadge(sc, screenR, node);
  }

  // Label (show if node is big enough; skip for files in thumbnail mode)
  if (screenR > 8 && !(node.type === 'file' && screenR >= 12)) {
    drawNodeLabel(sc, screenR, node, isHovered, isSelected);
  }

  // Lazy load trigger
  if (node.childCount > 0 && shouldLoad(node, screenR)) {
    requestLoad(node);
  }

  // Recursively render children (if loaded and node is large enough)
  if (node.children && screenR > 30) {
    for (const child of node.children) {
      renderNode(child, W, H);
    }
  }

  // Loading indicator
  if (node.loadState === 'loading' && screenR > 20) {
    drawLoadingIndicator(sc, screenR);
  }
}

// ── Project Node ─────────────────────────────────────────────

function drawProjectNode(
  sc: { x: number; y: number }, screenR: number,
  node: SceneNode, isHovered: boolean, isSelected: boolean,
): void {
  // Glow
  if (screenR > 10) {
    const grad = _ctx.createRadialGradient(sc.x, sc.y, 0, sc.x, sc.y, screenR * 1.5);
    grad.addColorStop(0, node.color + '20');
    grad.addColorStop(0.6, node.color + '08');
    grad.addColorStop(1, node.color + '00');
    _ctx.fillStyle = grad;
    _ctx.beginPath();
    _ctx.arc(sc.x, sc.y, screenR * 1.5, 0, Math.PI * 2);
    _ctx.fill();
  }

  // Core
  _ctx.fillStyle = node.color + (isHovered || isSelected ? '30' : '15');
  _ctx.beginPath();
  _ctx.arc(sc.x, sc.y, screenR, 0, Math.PI * 2);
  _ctx.fill();

  // Border
  _ctx.strokeStyle = node.color + (isSelected ? 'AA' : isHovered ? '80' : '40');
  _ctx.lineWidth = isSelected ? 2.5 : isHovered ? 2 : 1;
  _ctx.beginPath();
  _ctx.arc(sc.x, sc.y, screenR, 0, Math.PI * 2);
  _ctx.stroke();

  // Node count in center (when not showing children detail, before workspace appears)
  if (screenR > 12 && screenR < 60) {
    _ctx.fillStyle = node.color;
    _ctx.font = `bold ${clamp(Math.round(screenR * 0.35), 7, 16)}px system-ui`;
    _ctx.textAlign = 'center';
    _ctx.fillText(`${node.nodeCount || node.childCount}`, sc.x, sc.y + 4);
  }

  // Workspace square at center (visible when zoomed in enough)
  if (screenR > 50) {
    drawWorkspaceSquare(sc, screenR, node);
  }

  // Orbit guide rings (when zoomed in enough to see children)
  if (screenR > 60 && node.children) {
    _ctx.strokeStyle = node.color + '08';
    _ctx.lineWidth = 1;
    for (const frac of [0.3, 0.55, 0.80]) {
      _ctx.beginPath();
      _ctx.arc(sc.x, sc.y, screenR * frac, 0, Math.PI * 2);
      _ctx.stroke();
    }
  }
}

// ── Folder Node ──────────────────────────────────────────────

function drawFolderNode(
  sc: { x: number; y: number }, screenR: number,
  node: SceneNode, isHovered: boolean, isSelected: boolean,
): void {
  const ec = getExtColor('folder');

  _ctx.fillStyle = ec + (isHovered || isSelected ? '35' : '15');
  _ctx.beginPath();
  _ctx.arc(sc.x, sc.y, screenR, 0, Math.PI * 2);
  _ctx.fill();

  _ctx.strokeStyle = ec + (isSelected ? 'DD' : isHovered ? 'AA' : '40');
  _ctx.lineWidth = isSelected ? 2 : isHovered ? 1.5 : 1;
  _ctx.beginPath();
  _ctx.arc(sc.x, sc.y, screenR, 0, Math.PI * 2);
  _ctx.stroke();

  // Child count badge (when medium size, before workspace appears)
  if (screenR > 8 && screenR < 40) {
    _ctx.fillStyle = ec + 'BB';
    _ctx.font = `bold ${clamp(Math.round(screenR * 0.4), 6, 14)}px system-ui`;
    _ctx.textAlign = 'center';
    _ctx.fillText(`${node.childCount}`, sc.x, sc.y + screenR * 0.15);
  }

  // Workspace square at center (visible when zoomed in enough)
  if (screenR > 40) {
    drawWorkspaceSquare(sc, screenR, node);
  }

  // Orbit guide rings for loaded children
  if (screenR > 40 && node.children) {
    _ctx.strokeStyle = ec + '08';
    _ctx.lineWidth = 1;
    _ctx.setLineDash([3, 6]);
    _ctx.beginPath();
    _ctx.arc(sc.x, sc.y, screenR * 0.80, 0, Math.PI * 2);
    _ctx.stroke();
    _ctx.setLineDash([]);
  }
}

// ── File Node ────────────────────────────────────────────────

function drawFileNode(
  sc: { x: number; y: number }, screenR: number,
  node: SceneNode, isHovered: boolean, isSelected: boolean,
): void {
  const ec = getExtColor(node.ext);

  // Small: dot/circle
  if (screenR < 12) {
    const hexAlpha = Math.round(node.opacity * 255).toString(16).padStart(2, '0');
    _ctx.fillStyle = ec + hexAlpha;
    _ctx.beginPath();
    _ctx.arc(sc.x, sc.y, screenR, 0, Math.PI * 2);
    _ctx.fill();
    _ctx.strokeStyle = ec + (isSelected ? 'CC' : isHovered ? 'AA' : '30');
    _ctx.lineWidth = 1;
    _ctx.beginPath();
    _ctx.arc(sc.x, sc.y, screenR, 0, Math.PI * 2);
    _ctx.stroke();
    if (screenR > 5) {
      _ctx.fillStyle = ec;
      _ctx.font = `bold ${clamp(Math.round(screenR * 0.6), 5, 10)}px system-ui`;
      _ctx.textAlign = 'center';
      _ctx.fillText(node.ext.toUpperCase(), sc.x, sc.y - screenR - 3);
    }
    return;
  }

  // Thumbnail card
  drawFileThumbnail(sc, screenR, node, ec, isHovered, isSelected);
}

function drawFileThumbnail(
  sc: { x: number; y: number }, screenR: number,
  node: SceneNode, ec: string, isHovered: boolean, isSelected: boolean,
): void {
  // Card dimensions: portrait ratio (3:4)
  const cardW = screenR * 1.5;
  const cardH = screenR * 2.0;
  const cx = sc.x - cardW / 2;
  const cy = sc.y - cardH / 2;
  const cornerR = Math.max(2, screenR * 0.1);
  const headerH = cardH * 0.18;

  // Shadow
  if (screenR > 20) {
    _ctx.fillStyle = 'rgba(0,0,0,0.3)';
    roundRect(_ctx, cx + 2, cy + 2, cardW, cardH, cornerR);
    _ctx.fill();
  }

  // Card body
  _ctx.fillStyle = isSelected ? '#1a1a22' : isHovered ? '#151519' : '#101014';
  roundRect(_ctx, cx, cy, cardW, cardH, cornerR);
  _ctx.fill();

  // Card border
  _ctx.strokeStyle = ec + (isSelected ? 'BB' : isHovered ? '88' : '40');
  _ctx.lineWidth = isSelected ? 2 : 1;
  roundRect(_ctx, cx, cy, cardW, cardH, cornerR);
  _ctx.stroke();

  // Header bar with ext label
  _ctx.fillStyle = ec + '30';
  roundRect(_ctx, cx, cy, cardW, headerH, cornerR);
  _ctx.fill();
  // Clip the bottom corners of the header (fill a flat rect over the bottom part)
  _ctx.fillRect(cx, cy + headerH - cornerR, cardW, cornerR);

  // Ext label in header
  const extFontSize = clamp(Math.round(headerH * 0.6), 5, 14);
  _ctx.fillStyle = ec;
  _ctx.font = `bold ${extFontSize}px system-ui`;
  _ctx.textAlign = 'left';
  _ctx.fillText(node.ext.toUpperCase(), cx + cardW * 0.08, cy + headerH * 0.7);

  // Heat dot in header (right side)
  if (screenR > 16) {
    const dotR = Math.max(2, headerH * 0.15);
    const dotColor = node.heatTier === 'active' ? '#4ade80' :
                     node.heatTier === 'reference' ? '#facc15' :
                     node.heatTier === 'dormant' ? '#f97316' : '#6b7280';
    _ctx.fillStyle = dotColor;
    _ctx.beginPath();
    _ctx.arc(cx + cardW - cardW * 0.12, cy + headerH * 0.5, dotR, 0, Math.PI * 2);
    _ctx.fill();
  }

  // Content area — real content when zoomed in, placeholder when small
  const contentTop = cy + headerH + cardH * 0.06;
  const contentLeft = cx + cardW * 0.1;
  const contentRight = cx + cardW * 0.9;
  const contentW = contentRight - contentLeft;
  const lineH = Math.max(2, cardH * 0.04);
  const lineGap = lineH * 1.8;
  const bodyH = cardH - headerH - cardH * 0.1;

  const ext = node.ext.toLowerCase();
  const isRawImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'paint'].includes(ext);

  // All files attempt image thumbnail at deep zoom (hub generates SVG pages for docs)
  const img = screenR > 25 ? getImageThumbnail(node.id) : null;

  if (img) {
    // Real image thumbnail (raw image OR hub-generated SVG page thumbnail)
    drawRealImage(img, cx, cy, cardW, cardH, headerH, cornerR);
  } else if (isRawImage) {
    // Image file that hasn't loaded yet
    drawImagePlaceholder(cx, cy, cardW, cardH, headerH, ec, cornerR);
  } else if (screenR > 25) {
    // Text/metadata preview with page-like styling at deep zoom
    const preview = getTextPreview(node.id);
    if (preview) {
      // Draw page-like background when zoomed in enough
      if (screenR > 50) {
        drawPageBackground(cx, cy + headerH, cardW, cardH - headerH, cornerR);
      }
      drawRealText(preview.lines, contentLeft, contentTop, contentW, bodyH, ec, screenR > 50);
    } else {
      drawTextLines(contentLeft, contentTop, contentW, lineH, lineGap, 5, ec);
    }
  } else {
    // Small size: placeholder lines
    drawTextLines(contentLeft, contentTop, contentW, lineH, lineGap, 5, ec);
  }

  // Loading shimmer
  if (screenR > 25 && isContentLoading(node.id)) {
    const shimmer = 0.05 + 0.03 * Math.sin(_time * 4);
    _ctx.fillStyle = `rgba(255,255,255,${shimmer})`;
    _ctx.fillRect(cx, cy + headerH, cardW, cardH - headerH);
  }

  // Filename below card
  if (screenR > 14) {
    const nameFontSize = clamp(Math.round(screenR * 0.2), 6, 13);
    _ctx.font = `${nameFontSize}px system-ui`;
    _ctx.textAlign = 'center';
    let name = node.label;
    const maxChars = Math.floor(cardW / (nameFontSize * 0.5));
    if (name.length > maxChars) name = name.slice(0, maxChars - 1) + '…';
    _ctx.fillStyle = isSelected ? '#fff' : isHovered ? '#ddd' : 'rgba(255,255,255,0.5)';
    _ctx.fillText(name, sc.x, cy + cardH + nameFontSize + 3);
  }
}

// ── Real content renderers ────────────────────────────────────

function drawRealImage(
  img: HTMLImageElement, cx: number, cy: number,
  cardW: number, cardH: number, headerH: number, cornerR: number,
): void {
  const pad = cardW * 0.05;
  const imgX = cx + pad;
  const imgY = cy + headerH + pad;
  const imgW = cardW - pad * 2;
  const imgH = cardH - headerH - pad * 2;

  // Maintain aspect ratio
  const imgRatio = img.naturalWidth / img.naturalHeight;
  const boxRatio = imgW / imgH;
  let drawW: number, drawH: number, drawX: number, drawY: number;

  if (imgRatio > boxRatio) {
    drawW = imgW;
    drawH = imgW / imgRatio;
    drawX = imgX;
    drawY = imgY + (imgH - drawH) / 2;
  } else {
    drawH = imgH;
    drawW = imgH * imgRatio;
    drawX = imgX + (imgW - drawW) / 2;
    drawY = imgY;
  }

  // Clip to card body area
  _ctx.save();
  roundRect(_ctx, cx, cy + headerH, cardW, cardH - headerH, cornerR);
  _ctx.clip();
  _ctx.drawImage(img, drawX, drawY, drawW, drawH);
  _ctx.restore();
}

function drawRealText(
  lines: string[], x: number, y: number,
  maxW: number, maxH: number, ec: string,
  pageMode = false,
): void {
  // Scale font to fill the card: size based on fitting visible lines
  const visibleLines = Math.min(lines.length, 18);
  const fontSize = clamp(Math.round(maxH / (visibleLines * 1.6)), 4, 120);
  const lineH = fontSize * 1.4;
  const maxLines = Math.floor(maxH / lineH);

  const fontFamily = pageMode ? "'Georgia', 'Times New Roman', serif" : "'Courier New', monospace";
  _ctx.font = `${fontSize}px ${fontFamily}`;
  _ctx.textAlign = 'left';
  _ctx.fillStyle = pageMode ? 'rgba(26,26,26,0.9)' : 'rgba(200,210,220,0.8)';

  for (let i = 0; i < Math.min(lines.length, maxLines); i++) {
    let line = lines[i];
    // Truncate long lines
    if (_ctx.measureText(line).width > maxW) {
      while (line.length > 0 && _ctx.measureText(line + '…').width > maxW) {
        line = line.slice(0, -1);
      }
      line += '…';
    }
    _ctx.fillText(line, x, y + (i + 1) * lineH);
  }

  // Fade out at bottom
  if (lines.length > maxLines) {
    const fadeColor = pageMode ? 'rgba(248,248,246,' : 'rgba(16,16,20,';
    const grad = _ctx.createLinearGradient(x, y + maxH - lineH * 2, x, y + maxH);
    grad.addColorStop(0, fadeColor + '0)');
    grad.addColorStop(1, fadeColor + '1)');
    _ctx.fillStyle = grad;
    _ctx.fillRect(x - 2, y + maxH - lineH * 2, maxW + 4, lineH * 2);
  }
}

function drawPageBackground(
  cx: number, cy: number, w: number, h: number, cornerR: number,
): void {
  // Light paper-like background for document previews
  _ctx.fillStyle = '#f8f8f6';
  roundRect(_ctx, cx, cy, w, h, cornerR);
  _ctx.fill();

  // Subtle top edge (like a page fold)
  _ctx.fillStyle = '#e8e8e4';
  _ctx.fillRect(cx, cy, w, 3);
}

// Content hint: text lines
function drawTextLines(
  x: number, y: number, maxW: number,
  lineH: number, lineGap: number, count: number, ec: string,
): void {
  const widths = [1.0, 0.85, 0.92, 0.6, 0.78]; // varied line widths
  for (let i = 0; i < count; i++) {
    const w = maxW * (widths[i % widths.length]);
    _ctx.fillStyle = ec + '15';
    _ctx.fillRect(x, y + i * lineGap, w, lineH);
  }
}

// Content hint: spreadsheet grid
function drawSpreadsheetLines(
  x: number, y: number, w: number, h: number,
  ec: string, lineH: number,
): void {
  const cols = 3;
  const rows = 4;
  const cellW = w / cols;
  const cellH = h / rows;
  _ctx.strokeStyle = ec + '18';
  _ctx.lineWidth = 0.5;
  for (let r = 0; r <= rows; r++) {
    _ctx.beginPath();
    _ctx.moveTo(x, y + r * cellH);
    _ctx.lineTo(x + w, y + r * cellH);
    _ctx.stroke();
  }
  for (let c = 0; c <= cols; c++) {
    _ctx.beginPath();
    _ctx.moveTo(x + c * cellW, y);
    _ctx.lineTo(x + c * cellW, y + h);
    _ctx.stroke();
  }
  // Fill header row
  _ctx.fillStyle = ec + '10';
  _ctx.fillRect(x, y, w, cellH);
}

// Content hint: image placeholder
function drawImagePlaceholder(
  cx: number, cy: number, cardW: number, cardH: number,
  headerH: number, ec: string, cornerR: number,
): void {
  const imgPad = cardW * 0.08;
  const imgX = cx + imgPad;
  const imgY = cy + headerH + imgPad;
  const imgW = cardW - imgPad * 2;
  const imgH = cardH - headerH - imgPad * 2;

  // Image area background
  _ctx.fillStyle = ec + '0A';
  roundRect(_ctx, imgX, imgY, imgW, imgH, Math.max(1, cornerR * 0.5));
  _ctx.fill();

  // Mountain/landscape icon
  const midX = imgX + imgW / 2;
  const midY = imgY + imgH / 2;
  const iconSize = Math.min(imgW, imgH) * 0.3;

  _ctx.strokeStyle = ec + '30';
  _ctx.lineWidth = Math.max(1, iconSize * 0.08);

  // Mountain shape
  _ctx.beginPath();
  _ctx.moveTo(midX - iconSize, midY + iconSize * 0.5);
  _ctx.lineTo(midX - iconSize * 0.3, midY - iconSize * 0.5);
  _ctx.lineTo(midX, midY);
  _ctx.lineTo(midX + iconSize * 0.3, midY - iconSize * 0.3);
  _ctx.lineTo(midX + iconSize, midY + iconSize * 0.5);
  _ctx.closePath();
  _ctx.stroke();

  // Sun circle
  _ctx.beginPath();
  _ctx.arc(midX + iconSize * 0.5, midY - iconSize * 0.3, iconSize * 0.15, 0, Math.PI * 2);
  _ctx.stroke();
}

// ── Labels ───────────────────────────────────────────────────

function drawNodeLabel(
  sc: { x: number; y: number }, screenR: number,
  node: SceneNode, isHovered: boolean, isSelected: boolean,
): void {
  const fontSize = clamp(Math.round(screenR * 0.25), 7, 16);
  _ctx.font = `${fontSize}px system-ui`;
  _ctx.textAlign = 'center';

  let name = node.label;
  if (name.length > 24 && !isHovered && !isSelected) name = name.slice(0, 21) + '…';

  const tw = _ctx.measureText(name).width + 10;
  const ly = sc.y + screenR + fontSize + 4;

  // Background pill
  _ctx.fillStyle = 'rgba(8,8,10,0.75)';
  roundRect(_ctx, sc.x - tw / 2, ly - fontSize + 2, tw, fontSize + 4, 3);
  _ctx.fill();

  // Text
  _ctx.fillStyle = isSelected ? '#fff' : isHovered ? '#fff' : 'rgba(255,255,255,0.6)';
  _ctx.fillText(name, sc.x, ly + 2);

  // Heat info on hover (files only)
  if ((isHovered || isSelected) && node.type === 'file') {
    const info = `Heat: ${Math.round(node.heat)} (${node.heatTier})`;
    _ctx.font = `${Math.max(fontSize - 2, 6)}px system-ui`;
    _ctx.fillStyle = 'rgba(255,255,255,0.35)';
    _ctx.fillText(info, sc.x, ly + fontSize + 6);
  }
}

// ── Workspace Square (center of projects/folders) ────────────

function drawWorkspaceSquare(
  sc: { x: number; y: number }, screenR: number, node: SceneNode,
): void {
  const sqSize = screenR * 0.12; // Square side = 12% of node radius on screen
  const sqHalf = sqSize / 2;
  const isSelected = state.selectedNode === node;
  const isHovered = state.hoveredNode === node;

  // Background fill
  _ctx.fillStyle = isSelected ? node.color + '25' : isHovered ? node.color + '18' : node.color + '0C';
  roundRect(_ctx, sc.x - sqHalf, sc.y - sqHalf, sqSize, sqSize, 3);
  _ctx.fill();

  // Border
  _ctx.strokeStyle = node.color + (isSelected ? '90' : isHovered ? '60' : '30');
  _ctx.lineWidth = isSelected ? 1.5 : 1;
  roundRect(_ctx, sc.x - sqHalf, sc.y - sqHalf, sqSize, sqSize, 3);
  _ctx.stroke();

  // Workspace icon (small grid pattern inside when big enough)
  if (sqSize > 16) {
    const iconAlpha = isSelected ? '70' : '30';
    _ctx.strokeStyle = node.color + iconAlpha;
    _ctx.lineWidth = 0.5;

    // 2x2 grid lines inside the square
    const inset = sqSize * 0.25;
    const innerLeft = sc.x - sqHalf + inset;
    const innerRight = sc.x + sqHalf - inset;
    const innerTop = sc.y - sqHalf + inset;
    const innerBottom = sc.y + sqHalf - inset;
    const midX = sc.x;
    const midY = sc.y;

    // Horizontal mid line
    _ctx.beginPath();
    _ctx.moveTo(innerLeft, midY);
    _ctx.lineTo(innerRight, midY);
    _ctx.stroke();

    // Vertical mid line
    _ctx.beginPath();
    _ctx.moveTo(midX, innerTop);
    _ctx.lineTo(midX, innerBottom);
    _ctx.stroke();

    // Inner border
    _ctx.strokeStyle = node.color + (isSelected ? '40' : '18');
    roundRect(_ctx, innerLeft, innerTop, innerRight - innerLeft, innerBottom - innerTop, 2);
    _ctx.stroke();
  }

  // Label under the square when large enough
  if (sqSize > 24) {
    const fontSize = clamp(Math.round(sqSize * 0.18), 6, 11);
    _ctx.font = `${fontSize}px system-ui`;
    _ctx.textAlign = 'center';
    _ctx.fillStyle = node.color + '60';
    _ctx.fillText('workspace', sc.x, sc.y + sqHalf + fontSize + 2);
  }
}

// ── Selection Ring (pulsing) ─────────────────────────────────

function drawSelectionRing(node: SceneNode): void {
  const sc = worldToScreen(node.x, node.y, _canvas);
  const screenR = node.radius * camera.zoom;

  // Pulsing alpha
  const pulse = 0.5 + 0.3 * Math.sin(_time * 4);
  const alpha = Math.round(pulse * 255).toString(16).padStart(2, '0');

  _ctx.strokeStyle = '#FFFFFF' + alpha;
  _ctx.lineWidth = 2.5;
  _ctx.beginPath();
  _ctx.arc(sc.x, sc.y, screenR + 6, 0, Math.PI * 2);
  _ctx.stroke();

  // Directional arrows (4 chevrons pointing inward)
  const arrowR = screenR + 14;
  _ctx.fillStyle = '#FFFFFF' + alpha;
  for (let a = 0; a < 4; a++) {
    const theta = (a * Math.PI / 2) + _time * 0.5;
    const ax = sc.x + arrowR * Math.cos(theta);
    const ay = sc.y + arrowR * Math.sin(theta);
    const size = 4;

    _ctx.beginPath();
    _ctx.moveTo(ax + size * Math.cos(theta + Math.PI), ay + size * Math.sin(theta + Math.PI));
    _ctx.lineTo(ax + size * Math.cos(theta + Math.PI / 2), ay + size * Math.sin(theta + Math.PI / 2));
    _ctx.lineTo(ax + size * Math.cos(theta - Math.PI / 2), ay + size * Math.sin(theta - Math.PI / 2));
    _ctx.closePath();
    _ctx.fill();
  }
}

// ── Loading Indicator ────────────────────────────────────────

function drawLoadingIndicator(sc: { x: number; y: number }, screenR: number): void {
  const angle = _time * 3;
  const dotR = Math.max(2, screenR * 0.05);
  for (let i = 0; i < 3; i++) {
    const a = angle + (i * Math.PI * 2 / 3);
    const dx = sc.x + screenR * 0.4 * Math.cos(a);
    const dy = sc.y + screenR * 0.4 * Math.sin(a);
    const alpha = 0.3 + 0.3 * Math.sin(_time * 6 + i * 2);
    _ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    _ctx.beginPath();
    _ctx.arc(dx, dy, dotR, 0, Math.PI * 2);
    _ctx.fill();
  }
}

// ── Background Grid ──────────────────────────────────────────

function drawDotGrid(W: number, H: number): void {
  const gridSize = 40;
  const startWX = camera.x - W / 2 / camera.zoom;
  const startWY = camera.y - H / 2 / camera.zoom;
  const gx0 = Math.floor(startWX / gridSize) * gridSize;
  const gy0 = Math.floor(startWY / gridSize) * gridSize;
  _ctx.fillStyle = `rgba(255,255,255,${clamp(0.025 * camera.zoom, 0.005, 0.04)})`;
  for (let wx = gx0; wx < startWX + W / camera.zoom + gridSize; wx += gridSize) {
    for (let wy = gy0; wy < startWY + H / camera.zoom + gridSize; wy += gridSize) {
      const s = worldToScreen(wx, wy, _canvas);
      _ctx.fillRect(s.x, s.y, 1, 1);
    }
  }
}

// ── Minimap ──────────────────────────────────────────────────

function drawMinimap(W: number, H: number): void {
  const mmW = 140, mmH = 100;
  const mmX = W - mmW - 12, mmY = H - mmH - 12;
  const mmScale = 0.06;

  _ctx.fillStyle = 'rgba(0,0,0,0.5)';
  _ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  _ctx.lineWidth = 1;
  _ctx.fillRect(mmX, mmY, mmW, mmH);
  _ctx.strokeRect(mmX, mmY, mmW, mmH);

  const mmCx = mmX + mmW / 2, mmCy = mmY + mmH / 2;
  for (const root of state.roots) {
    _ctx.fillStyle = root.color + '80';
    _ctx.beginPath();
    _ctx.arc(mmCx + root.x * mmScale, mmCy + root.y * mmScale, Math.max(2, root.radius * mmScale), 0, Math.PI * 2);
    _ctx.fill();
  }

  const camW = W / camera.zoom * mmScale, camH = H / camera.zoom * mmScale;
  _ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  _ctx.strokeRect(mmCx + camera.x * mmScale - camW / 2, mmCy + camera.y * mmScale - camH / 2, camW, camH);
}

// ── Workspace Background ─────────────────────────────────────

function drawWorkspaceBackground(W: number, H: number, project: SceneNode): void {
  const sc = worldToScreen(project.x, project.y, _canvas);
  const screenR = project.radius * camera.zoom;

  // Dark workspace area (slightly lighter than galaxy bg)
  _ctx.fillStyle = '#0C0C10';
  _ctx.fillRect(0, 0, W, H);

  // Project boundary fill (very subtle)
  const grad = _ctx.createRadialGradient(sc.x, sc.y, 0, sc.x, sc.y, screenR);
  grad.addColorStop(0, project.color + '08');
  grad.addColorStop(0.7, project.color + '04');
  grad.addColorStop(1, project.color + '00');
  _ctx.fillStyle = grad;
  _ctx.beginPath();
  _ctx.arc(sc.x, sc.y, screenR, 0, Math.PI * 2);
  _ctx.fill();
}

// ── Drag Indicator ──────────────────────────────────────────

function drawDragIndicator(node: SceneNode): void {
  const sc = worldToScreen(node.x, node.y, _canvas);
  const screenR = node.radius * camera.zoom;

  // Highlight ring while dragging
  _ctx.strokeStyle = 'rgba(100,200,255,0.5)';
  _ctx.lineWidth = 2;
  _ctx.setLineDash([4, 4]);
  _ctx.beginPath();
  if (node.type === 'file' && screenR >= 12) {
    // File card outline
    const cardW = screenR * 1.5;
    const cardH = screenR * 2.0;
    roundRect(_ctx, sc.x - cardW / 2 - 4, sc.y - cardH / 2 - 4, cardW + 8, cardH + 8, 6);
  } else {
    _ctx.arc(sc.x, sc.y, screenR + 4, 0, Math.PI * 2);
  }
  _ctx.stroke();
  _ctx.setLineDash([]);
}

// ── Pin Badge ───────────────────────────────────────────────

function drawPinBadge(sc: { x: number; y: number }, screenR: number, node: SceneNode): void {
  // Small filled circle with pin icon at top-right of node
  const badgeR = clamp(screenR * 0.15, 4, 10);
  let bx: number, by: number;

  if (node.type === 'file' && screenR >= 12) {
    // Top-right of thumbnail card
    const cardW = screenR * 1.5;
    const cardH = screenR * 2.0;
    bx = sc.x + cardW / 2 - badgeR;
    by = sc.y - cardH / 2 + badgeR;
  } else {
    bx = sc.x + screenR * 0.6;
    by = sc.y - screenR * 0.6;
  }

  // Badge background
  _ctx.fillStyle = '#f59e0b';
  _ctx.beginPath();
  _ctx.arc(bx, by, badgeR, 0, Math.PI * 2);
  _ctx.fill();

  // Pin icon (small vertical line + dot)
  if (badgeR > 5) {
    _ctx.strokeStyle = '#fff';
    _ctx.lineWidth = 1.5;
    _ctx.beginPath();
    _ctx.moveTo(bx, by - badgeR * 0.4);
    _ctx.lineTo(bx, by + badgeR * 0.3);
    _ctx.stroke();
    _ctx.fillStyle = '#fff';
    _ctx.beginPath();
    _ctx.arc(bx, by - badgeR * 0.4, 1.5, 0, Math.PI * 2);
    _ctx.fill();
  }
}

// ── Workspace Notes Renderer ────────────────────────────────

function drawWorkspaceNotes(_W: number, _H: number): void {
  // Sort by z_order (lowest first = drawn first = behind)
  const sorted = [...state.workspaceNotes].sort((a, b) => a.zOrder - b.zOrder);

  for (const note of sorted) {
    const sc = worldToScreen(note.x, note.y, _canvas);
    const screenW = note.width * camera.zoom;
    const screenH = note.height * camera.zoom;

    // Viewport culling
    if (sc.x + screenW < 0 || sc.x > _W || sc.y + screenH < 0 || sc.y > _H) continue;

    // Too small to see
    if (screenW < 4 && screenH < 4) continue;

    const isSelected = state.selectedNote === note;
    const isDragging = state.dragNote === note;
    const isEditing = state.editingNote === note;

    // Tiny: just a colored dot
    if (screenW < 20) {
      _ctx.fillStyle = note.color;
      _ctx.globalAlpha = 0.7;
      _ctx.fillRect(sc.x, sc.y, Math.max(screenW, 3), Math.max(screenH, 3));
      _ctx.globalAlpha = 1;
      continue;
    }

    const cornerR = Math.max(2, Math.min(screenW, screenH) * 0.04);

    // Shadow
    if (screenW > 30) {
      _ctx.fillStyle = 'rgba(0,0,0,0.2)';
      roundRect(_ctx, sc.x + 3, sc.y + 3, screenW, screenH, cornerR);
      _ctx.fill();
    }

    // Card body
    _ctx.fillStyle = note.color;
    roundRect(_ctx, sc.x, sc.y, screenW, screenH, cornerR);
    _ctx.fill();

    // Border
    _ctx.strokeStyle = isSelected ? '#3b82f6' : isDragging ? 'rgba(100,200,255,0.7)' : 'rgba(0,0,0,0.15)';
    _ctx.lineWidth = isSelected ? 2.5 : 1;
    roundRect(_ctx, sc.x, sc.y, screenW, screenH, cornerR);
    _ctx.stroke();

    // Content text (if big enough and not editing)
    if (screenW > 50 && !isEditing) {
      drawNoteText(note, sc.x, sc.y, screenW, screenH);
    } else if (screenW > 20 && note.content && !isEditing) {
      // Title only
      const fontSize = clamp(Math.round(screenH * 0.15), 6, 14);
      _ctx.font = `bold ${fontSize}px system-ui`;
      _ctx.fillStyle = 'rgba(0,0,0,0.7)';
      _ctx.textAlign = 'left';
      const title = note.content.split('\n')[0].slice(0, 30);
      _ctx.fillText(title, sc.x + 6, sc.y + fontSize + 4);
    }

    // Resize handle (bottom-right triangle)
    if (screenW > 40 && (isSelected || isDragging)) {
      const hSize = Math.min(16, screenW * 0.1);
      const hx = sc.x + screenW;
      const hy = sc.y + screenH;
      _ctx.fillStyle = 'rgba(0,0,0,0.2)';
      _ctx.beginPath();
      _ctx.moveTo(hx, hy);
      _ctx.lineTo(hx - hSize, hy);
      _ctx.lineTo(hx, hy - hSize);
      _ctx.closePath();
      _ctx.fill();
    }
  }
}

function drawNoteText(note: WorkspaceNote, sx: number, sy: number, sw: number, sh: number): void {
  const pad = sw * 0.08;
  const maxW = sw - pad * 2;
  const maxH = sh - pad * 2;

  const fontSize = clamp(Math.round(sh * 0.08), 6, 16);
  const lineH = fontSize * 1.4;
  const maxLines = Math.floor(maxH / lineH);

  _ctx.font = `${fontSize}px system-ui`;
  _ctx.fillStyle = 'rgba(0,0,0,0.75)';
  _ctx.textAlign = 'left';

  const lines = note.content.split('\n');
  let drawLine = 0;

  for (let i = 0; i < lines.length && drawLine < maxLines; i++) {
    let line = lines[i];
    // Word wrap
    while (line.length > 0 && drawLine < maxLines) {
      let fit = line;
      while (_ctx.measureText(fit).width > maxW && fit.length > 1) {
        fit = fit.slice(0, -1);
      }
      if (fit.length < line.length) {
        // Find last space for word break
        const lastSpace = fit.lastIndexOf(' ');
        if (lastSpace > 0) fit = fit.slice(0, lastSpace);
      }
      // Bold first line
      if (drawLine === 0) _ctx.font = `bold ${fontSize}px system-ui`;
      else if (drawLine === 1) _ctx.font = `${fontSize}px system-ui`;

      _ctx.fillText(fit, sx + pad, sy + pad + (drawLine + 1) * lineH);
      line = line.slice(fit.length).trimStart();
      drawLine++;
    }
  }

  // Fade at bottom if content overflows
  if (drawLine >= maxLines && lines.length > maxLines) {
    const fadeH = lineH * 2;
    const grad = _ctx.createLinearGradient(sx, sy + sh - fadeH, sx, sy + sh);
    grad.addColorStop(0, note.color + '00');
    grad.addColorStop(1, note.color);
    _ctx.fillStyle = grad;
    _ctx.fillRect(sx, sy + sh - fadeH, sw, fadeH);
  }
}

// ── Workspace Edges Renderer ────────────────────────────────

function drawWorkspaceEdges(_W: number, _H: number): void {
  for (const edge of state.workspaceEdges) {
    const source = findItemPosition(edge.sourceId);
    const target = findItemPosition(edge.targetId);
    if (!source || !target) continue;

    const s = worldToScreen(source.x, source.y, _canvas);
    const t = worldToScreen(target.x, target.y, _canvas);

    const isSelected = state.selectedEdge === edge;

    // Bezier control points (perpendicular offset at midpoint)
    const mx = (s.x + t.x) / 2;
    const my = (s.y + t.y) / 2;
    const dx = t.x - s.x;
    const dy = t.y - s.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const offset = Math.min(dist * 0.15, 40);
    const nx = -dy / (dist || 1);
    const ny = dx / (dist || 1);
    const cx = mx + nx * offset;
    const cy = my + ny * offset;

    // Draw curve
    _ctx.strokeStyle = isSelected ? '#3b82f6' : 'rgba(255,255,255,0.25)';
    _ctx.lineWidth = isSelected ? 3 : 1.5;
    _ctx.beginPath();
    _ctx.moveTo(s.x, s.y);
    _ctx.quadraticCurveTo(cx, cy, t.x, t.y);
    _ctx.stroke();

    // Arrow at target
    const arrowSize = isSelected ? 10 : 7;
    const angle = Math.atan2(t.y - cy, t.x - cx);
    _ctx.fillStyle = isSelected ? '#3b82f6' : 'rgba(255,255,255,0.3)';
    _ctx.beginPath();
    _ctx.moveTo(t.x, t.y);
    _ctx.lineTo(t.x - arrowSize * Math.cos(angle - 0.35), t.y - arrowSize * Math.sin(angle - 0.35));
    _ctx.lineTo(t.x - arrowSize * Math.cos(angle + 0.35), t.y - arrowSize * Math.sin(angle + 0.35));
    _ctx.closePath();
    _ctx.fill();

    // Label at midpoint
    if (edge.label && dist > 60) {
      const fontSize = clamp(Math.round(12 * camera.zoom), 6, 14);
      _ctx.font = `${fontSize}px system-ui`;
      _ctx.fillStyle = isSelected ? '#93c5fd' : 'rgba(255,255,255,0.4)';
      _ctx.textAlign = 'center';
      _ctx.fillText(edge.label, cx, cy - 6);
    }
  }
}

/** Find screen position of a node or note by ID */
function findItemPosition(id: string): { x: number; y: number } | null {
  // Check nodes
  const node = findNode(state.roots, id);
  if (node) return { x: node.x, y: node.y };

  // Check notes
  const note = state.workspaceNotes.find(n => n.id === id);
  if (note) return { x: note.x + note.width / 2, y: note.y + note.height / 2 };

  return null;
}

// ── Connection Mode Visual ──────────────────────────────────

function drawConnectionModeLine(_W: number, _H: number): void {
  if (!state.connectionMode) return;

  const source = findItemPosition(state.connectionMode.sourceId);
  if (!source) return;

  const s = worldToScreen(source.x, source.y, _canvas);
  const mx = state.dragNoteOffsetX || _W / 2; // reuse for cursor screen pos
  const my = state.dragNoteOffsetY || _H / 2;

  // Use mouse world position
  const t = worldToScreen(
    (window as any).__portalMouseWorldX ?? source.x,
    (window as any).__portalMouseWorldY ?? source.y,
    _canvas
  );

  _ctx.strokeStyle = '#3b82f6';
  _ctx.lineWidth = 2;
  _ctx.setLineDash([6, 4]);
  _ctx.beginPath();
  _ctx.moveTo(s.x, s.y);
  _ctx.lineTo(t.x, t.y);
  _ctx.stroke();
  _ctx.setLineDash([]);

  // Source indicator
  _ctx.fillStyle = '#3b82f6';
  _ctx.beginPath();
  _ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
  _ctx.fill();
}

// ── Utility ──────────────────────────────────────────────────

function drawCenteredText(text: string, color: string, size: number): void {
  _ctx.fillStyle = color;
  _ctx.font = `${size}px system-ui`;
  _ctx.textAlign = 'center';
  _ctx.fillText(text, _canvas.width / 2, _canvas.height / 2);
}
