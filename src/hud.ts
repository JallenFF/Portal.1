// ============================================================
// Portal Frontend — HUD & Settings Panel (Scene Graph)
// ============================================================
// Breadcrumb is derived from selectedNode's ancestor chain.
// In workspace mode, HUD shows workspace-relevant hints.
// ============================================================

import { state, camera } from './state';
import { updateSetting } from './api';
import { getAncestorChain, findNode } from './scene-graph';
import type { SceneNode } from './scene-graph';
import { selectNode, exitProject } from './navigation';

// ── DOM references (set by initHUD) ──────────────────────────

let hudProject: HTMLElement;
let hudLock: HTMLElement;
let hudHint: HTMLElement;
let hudBreadcrumb: HTMLElement;
let hudLayout: HTMLElement;
let settingsPanel: HTMLElement;

export function initHUD(elements: {
  hudProject: HTMLElement;
  hudLock: HTMLElement;
  hudHint: HTMLElement;
  hudBreadcrumb: HTMLElement;
  hudLayout: HTMLElement;
  settingsPanel: HTMLElement;
}): void {
  hudProject = elements.hudProject;
  hudLock = elements.hudLock;
  hudHint = elements.hudHint;
  hudBreadcrumb = elements.hudBreadcrumb;
  hudLayout = elements.hudLayout;
  settingsPanel = elements.settingsPanel;

  // HUD button listeners
  hudLock.addEventListener('click', () => {
    state.locked = !state.locked;
    updateHUD();
  });

  hudLayout.addEventListener('click', () => {
    state.layout = state.layout === 'orbit' ? 'grid' : 'orbit';
    updateHUD();
  });

  // Breadcrumb click delegation
  document.addEventListener('click', handleBreadcrumbClick);
}

export function updateHUD(): void {
  // ── Workspace Mode ──────────────────────────────────────
  if (state.activeProject) {
    hudBreadcrumb.style.display = 'none';
    hudProject.style.display = 'none';

    const sel = state.selectedNode;
    if (sel && sel.type === 'file') {
      hudHint.textContent = `${sel.label} · heat: ${Math.round(sel.heat)} (${sel.heatTier}) · dbl-click = open · P = pin`;
    } else if (sel && sel.type === 'folder') {
      hudHint.textContent = `${sel.label} · ${sel.childCount} items · dbl-click = enter`;
    } else {
      hudHint.textContent = 'drag = move · click = select · dbl-click = open · Esc = back';
    }
    return;
  }

  // ── Galaxy Mode ─────────────────────────────────────────
  const sel = state.selectedNode;

  if (sel) {
    const chain = getAncestorChain(sel, state.roots);
    hudBreadcrumb.style.display = 'block';
    hudBreadcrumb.innerHTML =
      '<span class="crumb" data-id="__galaxy__">Galaxy</span>' +
      chain.map((n: SceneNode) =>
        ` <span class="sep">›</span> <span class="crumb" data-id="${n.id}">${n.label}</span>`
      ).join('');
    hudProject.style.display = 'none';

    const info = sel.type === 'file'
      ? `${sel.label} · heat: ${Math.round(sel.heat)} (${sel.heatTier}) · P = pin`
      : `${sel.label} · ${sel.childCount} children · dbl-click = enter workspace`;
    hudHint.textContent = `${info} · Esc = go up · G = ${state.layout === 'orbit' ? 'grid' : 'orbit'}`;
  } else {
    hudBreadcrumb.style.display = 'none';
    hudProject.style.display = 'none';
    hudHint.textContent = 'click = select · scroll = zoom · dbl-click = enter · Ctrl+S = settings';
  }

  hudLock.textContent = state.locked ? '🔒' : '🔓';
  hudLayout.textContent = state.layout === 'orbit' ? '◎ Orbit' : '⊞ Grid';
}

function handleBreadcrumbClick(e: MouseEvent): void {
  const crumb = (e.target as HTMLElement).closest('.crumb') as HTMLElement | null;
  if (!crumb) return;
  const nodeId = crumb.dataset.id;

  if (nodeId === '__galaxy__') {
    if (state.activeProject) {
      exitProject();
    } else {
      state.selectedNode = null;
      camera.targetX = 0;
      camera.targetY = 0;
      camera.targetZoom = 0.5;
    }
    updateHUD();
    return;
  }

  const node = findNode(state.roots, nodeId!);
  if (node) {
    selectNode(node);
  }
}

// ── Settings Panel ──────────────────────────────────────────

export function renderSettingsPanel(): void {
  const s = state.settings;
  settingsPanel.innerHTML = `
    <div class="settings-title">⚙ Heat Settings</div>
    <label><input type="checkbox" id="s-glow" ${s['heat.glow_enabled'] === 'true' ? 'checked' : ''}> Enable glow for active files</label>

    <div class="settings-title" style="margin-top:12px">Galaxy</div>
    <label>Project orbit (days): <input type="number" id="s-galaxy" value="${s['galaxy.project_orbit_days'] || 30}" min="7" max="365"></label>
    <button id="s-apply">Apply</button>
    <button id="s-close">Close</button>
  `;

  document.getElementById('s-apply')!.addEventListener('click', async () => {
    await updateSetting('heat.glow_enabled', (document.getElementById('s-glow') as HTMLInputElement).checked ? 'true' : 'false');
    await updateSetting('galaxy.project_orbit_days', (document.getElementById('s-galaxy') as HTMLInputElement).value);
  });

  document.getElementById('s-close')!.addEventListener('click', () => {
    state.showSettings = false;
    settingsPanel.style.display = 'none';
  });
}
