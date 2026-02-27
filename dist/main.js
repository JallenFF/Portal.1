// ============================================================
// Portal v0.4.2 — Solar System Model
// Parent = sun (center), files orbit by recency, folders = outer boundary
// ============================================================

const HUB = '/api';

// ── Canvas Setup ────────────────────────────────────────────

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resize();
window.addEventListener('resize', resize);

// ── State ───────────────────────────────────────────────────

const camera = { x: 0, y: 0, zoom: 0.5, targetZoom: 0.5, targetX: 0, targetY: 0 };
const mouse = { x: 0, y: 0, startX: 0, startY: 0, worldX: 0, worldY: 0, down: false };

const state = {
  locked: true,
  focusedProject: -1,
  focusedNode: null,
  hoveredItem: -1,
  currentChildren: [],
  spheres: [],
  navStack: [],
  loading: true,
  error: null,
  layout: 'orbit',
  showSettings: false,
  settings: {},
  sunLabel: '',          // name of current context (project or folder)
};

const defaultSettings = {
  'orbit.inner_hours': '48',
  'orbit.mid1_days': '4',
  'orbit.mid2_weeks': '2',
  'orbit.outer_weeks': '3',
  'orbit.weekend_extend': 'false',
  'orbit.weekend_hours': '72',
  'galaxy.project_orbit_days': '30',
};

// ── Colors ──────────────────────────────────────────────────

const EXT_COLORS = {
  pdf: '#EF4444', docx: '#3B82F6', xlsx: '#10B981', csv: '#6EE7B7',
  md: '#A78BFA', html: '#F97316', js: '#FBBF24', ts: '#3B82F6',
  json: '#6B7280', pptx: '#F59E0B', mp4: '#EC4899', env: '#6B7280',
  web: '#60A5FA', app: '#34D399', email: '#F472B6', dir: '#FCD34D',
  txt: '#9CA3AF', css: '#06B6D4', png: '#F472B6', jpg: '#F472B6',
  jpeg: '#F472B6', gif: '#F472B6', svg: '#A78BFA', zip: '#6B7280',
  py: '#3776AB', doc: '#3B82F6', xls: '#10B981', ppt: '#F59E0B',
  folder: '#F59E0B',
};

const PROJECT_COLORS = [
  '#F59E0B', '#3B82F6', '#8B5CF6', '#10B981',
  '#EF4444', '#EC4899', '#06B6D4', '#84CC16',
];

// ── Utilities ───────────────────────────────────────────────

function hashCode(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function distPt(a, b) { return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2); }

function screenToWorld(sx, sy) {
  return {
    x: (sx - canvas.width / 2) / camera.zoom + camera.x,
    y: (sy - canvas.height / 2) / camera.zoom + camera.y,
  };
}

function worldToScreen(wx, wy) {
  return {
    x: (wx - camera.x) * camera.zoom + canvas.width / 2,
    y: (wy - camera.y) * camera.zoom + canvas.height / 2,
  };
}

// ── Recency Score ───────────────────────────────────────────
// Returns 0..1 where 1 = just modified, 0 = very old
// Used for: proximity to center, brightness, size

function recencyScore(fileModified) {
  if (!fileModified) return 0;
  const now = Date.now();
  const modified = new Date(fileModified).getTime();
  const hoursAgo = (now - modified) / (1000 * 60 * 60);

  const innerHours = parseFloat(state.settings['orbit.inner_hours'] || '48');
  const outerWeeks = parseFloat(state.settings['orbit.outer_weeks'] || '3');
  const maxHours = outerWeeks * 7 * 24;

  // Weekend extension
  if (state.settings['orbit.weekend_extend'] === 'true') {
    const day = new Date().getDay();
    if (day === 0 || day === 6) {
      const weekendHours = parseFloat(state.settings['orbit.weekend_hours'] || '72');
      if (hoursAgo < weekendHours) return 1.0;
    }
  }

  if (hoursAgo < innerHours) return 1.0;
  if (hoursAgo > maxHours) return 0.0;
  // Smooth falloff between inner and max
  return 1.0 - (hoursAgo - innerHours) / (maxHours - innerHours);
}

// ── Solar System Placement ──────────────────────────────────
// Files orbit around center (the sun). Closer = more recent.
// Folders form the outer boundary ring.

function placeChildren(children) {
  const folders = children.filter(c => c.is_folder);
  const files = children.filter(c => !c.is_folder);

  // Viewport-fitted: everything should be visible at default zoom
  const screenR = Math.min(canvas.width, canvas.height) * 0.42;

  const fileZoneR = screenR * 0.60;   // files spread across inner 60%
  const folderRingR = screenR * 0.75;  // folders closer, tighter orbit

  const placed = [];

  // ── Place files by relative recency (center = most recent in this set) ──
  // Sort by modified date descending (most recent first)
  const sortedFiles = [...files].sort((a, b) => {
    const ta = new Date(a.meta_modified || a.file_modified || 0).getTime();
    const tb = new Date(b.meta_modified || b.file_modified || 0).getTime();
    return tb - ta;
  });

  const fileCount = sortedFiles.length;

  for (let i = 0; i < fileCount; i++) {
    const item = sortedFiles[i];

    // Relative rank: 0 = most recent, 1 = oldest in this set
    const rank = fileCount > 1 ? i / (fileCount - 1) : 0;

    // Radial distance: rank 0 = close to sun, rank 1 = edge of file zone
    // Cubic curve packs most files near the sun, only oldest push outward
    const minR = 60;
    const r = minR + Math.pow(rank, 2.5) * (fileZoneR - minR);

    // Angle: spread evenly with slight hash jitter
    const angleBase = (2 * Math.PI * i) / Math.max(fileCount, 1);
    const jitter = ((hashCode(item.id) % 1000) / 1000 - 0.5) * 0.3;
    const angle = angleBase + jitter;

    // Size: most recent = larger
    const score = 1 - rank;
    const baseR = 6;
    const sizeBoost = score * 5;

    placed.push({
      ...item,
      x: r * Math.cos(angle),
      y: r * Math.sin(angle),
      radius: baseR + sizeBoost,
      isFolder: false,
      ext: (item.vault_ext || item.type || 'file').toLowerCase(),
      displayLabel: item.label,
      childCount: 0,
      recency: score,
    });
  }

  // ── Place folders on outer boundary ring ──
  for (let i = 0; i < folders.length; i++) {
    const item = folders[i];
    const angle = (2 * Math.PI * i) / Math.max(folders.length, 1);
    // Slight radial jitter
    const jitter = ((hashCode(item.id + 'fr') % 20) - 10);

    placed.push({
      ...item,
      x: (folderRingR + jitter) * Math.cos(angle),
      y: (folderRingR + jitter) * Math.sin(angle),
      radius: 22 + Math.sqrt(Math.max(item.child_count || 1, 1)) * 2,
      isFolder: true,
      ext: 'folder',
      displayLabel: item.label,
      childCount: item.child_count || 0,
      recency: 0,
    });
  }

  return placed;
}

// ── Grid Layout ─────────────────────────────────────────────

function placeChildrenGrid(children) {
  const folders = children.filter(c => c.is_folder);
  const files = children.filter(c => !c.is_folder);
  const allItems = [...folders, ...files];

  const cols = Math.ceil(Math.sqrt(allItems.length));
  const spacing = 65;
  const startX = -(cols * spacing) / 2;
  const startY = -(Math.ceil(allItems.length / cols) * spacing) / 2;

  return allItems.map((item, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const isFolder = item.is_folder;
    return {
      ...item,
      x: startX + col * spacing,
      y: startY + row * spacing,
      radius: isFolder ? 22 : 8,
      isFolder,
      ext: isFolder ? 'folder' : (item.vault_ext || item.type || 'file').toLowerCase(),
      displayLabel: item.label,
      childCount: item.child_count || 0,
      recency: 0,
    };
  });
}

// ── Galaxy Placement ────────────────────────────────────────

function placeProjectsOnGalaxy(projects) {
  const galaxyDays = parseFloat(state.settings['galaxy.project_orbit_days'] || '30');

  return projects.map((p, idx) => {
    const color = p.color || PROJECT_COLORS[idx % PROJECT_COLORS.length];
    const modified = p.latest_modified || p.updated_at;
    const now = Date.now();
    const modTime = new Date(modified).getTime();
    const daysAgo = (now - modTime) / (1000 * 60 * 60 * 24);

    const t = clamp(daysAgo / galaxyDays, 0, 1);
    const orbitalR = 150 + t * 600;
    const theta = (2 * Math.PI * (hashCode(p.id) % 10000)) / 10000;
    const radius = 30 + Math.sqrt(Math.max(p.node_count || 1, 1)) * 3;

    return {
      id: p.id, name: p.name, color, radius, orbitalR,
      x: orbitalR * Math.cos(theta),
      y: orbitalR * Math.sin(theta),
      vx: 0, vy: 0,
      nodeCount: p.node_count || 0,
      latestModified: modified,
    };
  });
}

// ── Hub API ─────────────────────────────────────────────────

async function fetchProjects() {
  try { return (await (await fetch(`${HUB}/projects`)).json()).projects || []; }
  catch (e) { return null; }
}

async function fetchProjectChildren(projectId) {
  try { return (await (await fetch(`${HUB}/projects/${projectId}`)).json()).children || []; }
  catch (e) { return []; }
}

async function fetchNodeChildren(nodeId) {
  try { return (await (await fetch(`${HUB}/nodes/${nodeId}/children`)).json()).children || []; }
  catch (e) { return []; }
}

async function fetchSettings() {
  try { return (await (await fetch(`${HUB}/settings`)).json()).settings || { ...defaultSettings }; }
  catch (e) { return { ...defaultSettings }; }
}

async function updateSetting(key, value) {
  try {
    await fetch(`${HUB}/settings/${key}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: String(value) }),
    });
    state.settings[key] = String(value);
  } catch (e) { console.error('Setting update failed:', e); }
}

async function openFile(nodeId) {
  try {
    const data = await (await fetch(`${HUB}/open`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeId }),
    })).json();
    if (data.error) console.error('Open failed:', data.error);
  } catch (e) { console.error('Open failed:', e); }
}

// ── Initialize ──────────────────────────────────────────────

async function init() {
  state.settings = await fetchSettings();
  const projects = await fetchProjects();

  if (projects === null) {
    state.error = 'Cannot connect to Hub. Is it running on port 3141?';
    state.loading = false;
    return;
  }

  if (projects.length === 0) {
    state.error = 'No projects yet. Create one via the Hub API.';
  }

  state.spheres = placeProjectsOnGalaxy(projects);
  state.loading = false;
  state.error = null;
}

// ── Navigation ──────────────────────────────────────────────

async function enterProject(idx) {
  const s = state.spheres[idx];
  state.focusedProject = idx;
  state.focusedNode = null;
  state.sunLabel = s.name;
  state.navStack = [{ id: s.id, name: s.name, type: 'project' }];

  const children = await fetchProjectChildren(s.id);
  state.currentChildren = state.layout === 'grid' ? placeChildrenGrid(children) : placeChildren(children);

  camera.targetX = 0;
  camera.targetY = 0;
  camera.targetZoom = 1.0;
  updateHUD();
}

async function enterFolder(item) {
  state.focusedNode = item.id;
  state.sunLabel = item.displayLabel;
  state.navStack.push({ id: item.id, name: item.displayLabel, type: 'folder' });

  const children = await fetchNodeChildren(item.id);
  state.currentChildren = state.layout === 'grid' ? placeChildrenGrid(children) : placeChildren(children);

  camera.targetX = 0;
  camera.targetY = 0;
  camera.targetZoom = 1.0;
  updateHUD();
}

async function goBack() {
  if (state.navStack.length <= 1) {
    state.focusedProject = -1;
    state.focusedNode = null;
    state.navStack = [];
    state.currentChildren = [];
    state.sunLabel = '';
    camera.targetZoom = 0.5;
    camera.targetX = 0;
    camera.targetY = 0;
    updateHUD();
    return;
  }

  state.navStack.pop();
  const current = state.navStack[state.navStack.length - 1];
  state.sunLabel = current.name;

  if (current.type === 'project') {
    state.focusedNode = null;
    const children = await fetchProjectChildren(current.id);
    state.currentChildren = state.layout === 'grid' ? placeChildrenGrid(children) : placeChildren(children);
  } else {
    state.focusedNode = current.id;
    const children = await fetchNodeChildren(current.id);
    state.currentChildren = state.layout === 'grid' ? placeChildrenGrid(children) : placeChildren(children);
  }

  camera.targetX = 0;
  camera.targetY = 0;
  updateHUD();
}

async function refreshCurrentLevel() {
  if (state.navStack.length === 0) return;
  const current = state.navStack[state.navStack.length - 1];
  let children;
  if (current.type === 'project') {
    children = await fetchProjectChildren(current.id);
  } else {
    children = await fetchNodeChildren(current.id);
  }
  state.currentChildren = state.layout === 'grid' ? placeChildrenGrid(children) : placeChildren(children);
}

// ── Zoom Handler ────────────────────────────────────────────

window.addEventListener('wheel', (e) => {
  e.preventDefault();

  // Scroll out far enough → go back
  if (state.focusedProject >= 0 && e.deltaY > 0 && camera.targetZoom <= 0.5) {
    goBack();
    return;
  }

  const zoomFactor = e.deltaY > 0 ? 0.90 : 1.12;
  const newZoom = clamp(camera.targetZoom * zoomFactor, 0.15, 10.0);

  const world = screenToWorld(e.clientX, e.clientY);
  const ratio = 1 - newZoom / camera.targetZoom;
  camera.targetX += (world.x - camera.x) * ratio;
  camera.targetY += (world.y - camera.y) * ratio;
  camera.targetZoom = newZoom;
}, { passive: false });

// ── Mouse Handlers ──────────────────────────────────────────

canvas.addEventListener('mousedown', (e) => {
  mouse.down = true;
  mouse.x = e.clientX;
  mouse.y = e.clientY;
  mouse.startX = e.clientX;
  mouse.startY = e.clientY;
});

window.addEventListener('mousemove', (e) => {
  const world = screenToWorld(e.clientX, e.clientY);
  mouse.worldX = world.x;
  mouse.worldY = world.y;

  const dragDist = Math.sqrt((e.clientX - mouse.startX) ** 2 + (e.clientY - mouse.startY) ** 2);

  if (mouse.down && dragDist > 3) {
    const dx = (e.clientX - mouse.x) / camera.zoom;
    const dy = (e.clientY - mouse.y) / camera.zoom;
    camera.targetX -= dx;
    camera.targetY -= dy;
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  }

  // Hover detection
  if (state.focusedProject >= 0) {
    let hit = -1;
    for (let i = 0; i < state.currentChildren.length; i++) {
      const c = state.currentChildren[i];
      const hitR = c.radius + 6;
      if (distPt(world, c) < hitR) { hit = i; break; }
    }
    state.hoveredItem = hit;
  } else {
    let hit = -1;
    for (let i = 0; i < state.spheres.length; i++) {
      if (distPt(world, state.spheres[i]) < state.spheres[i].radius) { hit = i; break; }
    }
    state.hoveredItem = hit;
  }
});

window.addEventListener('mouseup', () => { mouse.down = false; });

// Double-click: enter or open
canvas.addEventListener('dblclick', (e) => {
  const world = screenToWorld(e.clientX, e.clientY);

  if (state.focusedProject >= 0) {
    for (let i = 0; i < state.currentChildren.length; i++) {
      const c = state.currentChildren[i];
      if (distPt(world, c) < c.radius + 6) {
        if (c.isFolder) enterFolder(c);
        else openFile(c.id);
        return;
      }
    }
  } else {
    for (let i = 0; i < state.spheres.length; i++) {
      if (distPt(world, state.spheres[i]) < state.spheres[i].radius) {
        enterProject(i);
        return;
      }
    }
  }
});

// ── Keyboard ────────────────────────────────────────────────

window.addEventListener('keydown', (e) => {
  if (e.key === 'l' || e.key === 'L') { state.locked = !state.locked; updateHUD(); }
  if (e.key === 'Escape') {
    if (state.showSettings) { state.showSettings = false; settingsPanel.style.display = 'none'; }
    else if (state.focusedProject >= 0) goBack();
  }
  if (e.key === 'g' || e.key === 'G') {
    state.layout = state.layout === 'orbit' ? 'grid' : 'orbit';
    if (state.currentChildren.length > 0) refreshCurrentLevel();
    updateHUD();
  }
  if (e.key === 's' && e.ctrlKey) {
    e.preventDefault();
    state.showSettings = !state.showSettings;
    settingsPanel.style.display = state.showSettings ? 'block' : 'none';
    if (state.showSettings) renderSettingsPanel();
  }
});

// ── HUD ─────────────────────────────────────────────────────

const hudProject = document.getElementById('hud-project');
const hudLock = document.getElementById('hud-lock');
const hudHint = document.getElementById('hud-hint');
const hudBreadcrumb = document.getElementById('hud-breadcrumb');
const hudLayout = document.getElementById('hud-layout');
const settingsPanel = document.getElementById('settings-panel');

function updateHUD() {
  if (state.navStack.length > 0) {
    hudBreadcrumb.style.display = 'block';
    hudBreadcrumb.innerHTML = '<span class="crumb" data-idx="-1">Galaxy</span> <span class="sep">›</span> ' +
      state.navStack.map((n, i) =>
        `<span class="crumb" data-idx="${i}">${n.name}</span>`
      ).join(' <span class="sep">›</span> ');
    hudProject.style.display = 'none';
  } else {
    hudBreadcrumb.style.display = 'none';
    hudProject.style.display = 'none';
  }

  if (state.focusedProject >= 0) {
    const count = state.currentChildren.length;
    const fCount = state.currentChildren.filter(c => c.isFolder).length;
    hudHint.textContent = `${fCount} folders · ${count - fCount} files · dbl-click = enter/open · Esc/scroll out = back · G = ${state.layout === 'orbit' ? 'grid' : 'orbit'}`;
  } else {
    hudHint.textContent = 'scroll = zoom · drag = pan · dbl-click = enter · Ctrl+S = settings';
  }

  hudLock.textContent = state.locked ? '🔒' : '🔓';
  hudLayout.textContent = state.layout === 'orbit' ? '◎ Orbit' : '⊞ Grid';
}

hudLock.addEventListener('click', () => { state.locked = !state.locked; updateHUD(); });
hudLayout.addEventListener('click', () => {
  state.layout = state.layout === 'orbit' ? 'grid' : 'orbit';
  refreshCurrentLevel();
  updateHUD();
});

// Breadcrumb click
document.addEventListener('click', (e) => {
  const crumb = e.target.closest('.crumb');
  if (!crumb) return;
  const idx = parseInt(crumb.dataset.idx);

  if (idx === -1) {
    state.focusedProject = -1;
    state.focusedNode = null;
    state.navStack = [];
    state.currentChildren = [];
    state.sunLabel = '';
    camera.targetZoom = 0.5;
    camera.targetX = 0;
    camera.targetY = 0;
    updateHUD();
    return;
  }

  while (state.navStack.length > idx + 1) state.navStack.pop();
  const current = state.navStack[state.navStack.length - 1];
  state.sunLabel = current.name;
  if (current.type === 'project') {
    state.focusedNode = null;
    fetchProjectChildren(current.id).then(children => {
      state.currentChildren = state.layout === 'grid' ? placeChildrenGrid(children) : placeChildren(children);
    });
  } else {
    state.focusedNode = current.id;
    fetchNodeChildren(current.id).then(children => {
      state.currentChildren = state.layout === 'grid' ? placeChildrenGrid(children) : placeChildren(children);
    });
  }
  camera.targetX = 0;
  camera.targetY = 0;
  updateHUD();
});

// ── Settings Panel ──────────────────────────────────────────

function renderSettingsPanel() {
  const s = state.settings;
  settingsPanel.innerHTML = `
    <div class="settings-title">⚙ Orbit Settings</div>
    <label>Inner orbit (hours): <input type="number" id="s-inner" value="${s['orbit.inner_hours'] || 48}" min="1" max="168"></label>
    <label>Mid-1 (days): <input type="number" id="s-mid1" value="${s['orbit.mid1_days'] || 4}" min="1" max="30"></label>
    <label>Mid-2 (weeks): <input type="number" id="s-mid2" value="${s['orbit.mid2_weeks'] || 2}" min="1" max="12"></label>
    <label>Outer (weeks): <input type="number" id="s-outer" value="${s['orbit.outer_weeks'] || 3}" min="1" max="52"></label>
    <label><input type="checkbox" id="s-weekend" ${s['orbit.weekend_extend'] === 'true' ? 'checked' : ''}> Weekend extend</label>
    <label>Weekend hours: <input type="number" id="s-weekend-hrs" value="${s['orbit.weekend_hours'] || 72}" min="1" max="168"></label>
    <div class="settings-title" style="margin-top:12px">Galaxy</div>
    <label>Project orbit (days): <input type="number" id="s-galaxy" value="${s['galaxy.project_orbit_days'] || 30}" min="7" max="365"></label>
    <button id="s-apply">Apply</button>
    <button id="s-close">Close</button>
  `;

  document.getElementById('s-apply').addEventListener('click', async () => {
    await updateSetting('orbit.inner_hours', document.getElementById('s-inner').value);
    await updateSetting('orbit.mid1_days', document.getElementById('s-mid1').value);
    await updateSetting('orbit.mid2_weeks', document.getElementById('s-mid2').value);
    await updateSetting('orbit.outer_weeks', document.getElementById('s-outer').value);
    await updateSetting('orbit.weekend_extend', document.getElementById('s-weekend').checked ? 'true' : 'false');
    await updateSetting('orbit.weekend_hours', document.getElementById('s-weekend-hrs').value);
    await updateSetting('galaxy.project_orbit_days', document.getElementById('s-galaxy').value);
    refreshCurrentLevel();
    const projects = await fetchProjects();
    if (projects) state.spheres = placeProjectsOnGalaxy(projects);
  });

  document.getElementById('s-close').addEventListener('click', () => {
    state.showSettings = false;
    settingsPanel.style.display = 'none';
  });
}

// ── Render Loop ─────────────────────────────────────────────

function render() {
  camera.x = lerp(camera.x, camera.targetX, 0.08);
  camera.y = lerp(camera.y, camera.targetY, 0.08);
  camera.zoom = lerp(camera.zoom, camera.targetZoom, 0.08);

  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#08080A';
  ctx.fillRect(0, 0, W, H);

  if (state.loading) {
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '14px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('Connecting to Hub...', W / 2, H / 2);
    requestAnimationFrame(render);
    return;
  }

  if (state.error && state.spheres.length === 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '13px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(state.error, W / 2, H / 2);
    requestAnimationFrame(render);
    return;
  }

  // ── Inside a project/folder (Solar System) ──────────────

  if (state.focusedProject >= 0) {
    const origin = worldToScreen(0, 0);

    // ── Sun: the current context ──
    // Glowing orb at center with label
    const sunR = 18 * camera.zoom;
    const sunGrad = ctx.createRadialGradient(origin.x, origin.y, 0, origin.x, origin.y, sunR * 2.5);
    sunGrad.addColorStop(0, 'rgba(245,158,11,0.25)');
    sunGrad.addColorStop(0.4, 'rgba(245,158,11,0.08)');
    sunGrad.addColorStop(1, 'rgba(245,158,11,0)');
    ctx.fillStyle = sunGrad;
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, sunR * 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Sun core
    ctx.fillStyle = 'rgba(245,158,11,0.4)';
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, sunR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(245,158,11,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, sunR, 0, Math.PI * 2);
    ctx.stroke();

    // Sun label
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = `bold ${clamp(Math.round(12 * camera.zoom), 9, 18)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.fillText(state.sunLabel, origin.x, origin.y + sunR + 18 * camera.zoom);

    // Subtle orbit guide rings
    if (state.layout === 'orbit') {
      ctx.strokeStyle = 'rgba(255,255,255,0.025)';
      ctx.lineWidth = 1;
      const guideR = Math.min(W, H) * 0.42;
      for (const frac of [0.2, 0.4, 0.6]) {
        ctx.beginPath();
        ctx.arc(origin.x, origin.y, guideR * frac, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Folder boundary ring
      ctx.strokeStyle = 'rgba(245,158,11,0.04)';
      ctx.setLineDash([4, 8]);
      ctx.beginPath();
      ctx.arc(origin.x, origin.y, guideR * 0.75, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // ── Draw children ──
    const children = state.currentChildren;
    for (let i = 0; i < children.length; i++) {
      const c = children[i];
      const sc = worldToScreen(c.x, c.y);

      // Viewport culling
      if (sc.x < -200 || sc.x > W + 200 || sc.y < -200 || sc.y > H + 200) continue;

      const sr = c.radius * camera.zoom;
      const isHovered = state.hoveredItem === i;
      const ec = EXT_COLORS[c.ext] || '#6B7280';

      if (c.isFolder) {
        // ── Folder: boundary sphere ──
        const alpha = isHovered ? 0.5 : 0.2;
        ctx.fillStyle = ec + (isHovered ? '40' : '18');
        ctx.beginPath();
        ctx.arc(sc.x, sc.y, sr, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = ec + (isHovered ? 'CC' : '50');
        ctx.lineWidth = isHovered ? 2 : 1.5;
        ctx.beginPath();
        ctx.arc(sc.x, sc.y, sr, 0, Math.PI * 2);
        ctx.stroke();

        // Child count
        if (sr > 8) {
          ctx.fillStyle = ec + 'CC';
          ctx.font = `bold ${clamp(Math.round(10 * camera.zoom), 7, 16)}px system-ui`;
          ctx.textAlign = 'center';
          ctx.fillText(`${c.childCount}`, sc.x, sc.y + 4);
        }

        // Folder label (always visible)
        const fontSize = clamp(Math.round(11 * camera.zoom), 8, 16);
        ctx.font = `${fontSize}px system-ui`;
        ctx.textAlign = 'center';
        let name = c.displayLabel;
        if (name.length > 20 && !isHovered) name = name.slice(0, 17) + '…';

        // Dark pill background
        const tw = ctx.measureText(name).width + 10;
        const lx = sc.x, ly = sc.y + sr + fontSize + 4;
        ctx.fillStyle = 'rgba(8,8,10,0.75)';
        roundRect(ctx, lx - tw / 2, ly - fontSize + 2, tw, fontSize + 4, 3);
        ctx.fill();
        ctx.fillStyle = isHovered ? '#fff' : 'rgba(255,255,255,0.65)';
        ctx.fillText(name, lx, ly + 2);

      } else {
        // ── File: orbiting body ──
        // Brightness based on recency
        const brightness = 0.5 + (c.recency || 0) * 0.5;
        const hexAlpha = Math.round(brightness * 255).toString(16).padStart(2, '0');

        ctx.fillStyle = ec + hexAlpha;
        ctx.beginPath();
        ctx.arc(sc.x, sc.y, sr, 0, Math.PI * 2);
        ctx.fill();

        // Glow for very recent files
        if ((c.recency || 0) > 0.8) {
          ctx.strokeStyle = ec + '30';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(sc.x, sc.y, sr + 3, 0, Math.PI * 2);
          ctx.stroke();
        }

        ctx.strokeStyle = ec + (isHovered ? 'CC' : '40');
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(sc.x, sc.y, sr, 0, Math.PI * 2);
        ctx.stroke();

        // Ext badge (always show when zoom > 0.7)
        if (camera.zoom > 0.7 || isHovered) {
          ctx.fillStyle = ec;
          ctx.font = `bold ${Math.max(7, Math.round(7 * camera.zoom))}px system-ui`;
          ctx.textAlign = 'center';
          ctx.fillText(c.ext.toUpperCase(), sc.x, sc.y - sr - 4);
        }

        // File label — always visible at default zoom
        if (camera.zoom > 0.6 || isHovered) {
          const fontSize = clamp(Math.round(10 * camera.zoom), 8, 15);
          ctx.font = `${fontSize}px system-ui`;
          let name = c.displayLabel;
          if (name.length > 22 && !isHovered) name = name.slice(0, 19) + '…';

          const tw = ctx.measureText(name).width + 10;
          const lx = sc.x, ly = sc.y + sr + fontSize + 3;
          ctx.fillStyle = 'rgba(8,8,10,0.7)';
          roundRect(ctx, lx - tw / 2, ly - fontSize + 2, tw, fontSize + 4, 3);
          ctx.fill();
          ctx.fillStyle = isHovered ? '#fff' : 'rgba(255,255,255,0.55)';
          ctx.fillText(name, lx, ly + 2);
        }
      }

      // ── Hover callout card ──
      if (isHovered) {
        const label = c.displayLabel;
        const ext = c.ext.toUpperCase();
        const line1 = label;
        const line2 = c.isFolder ? `${c.childCount} items` : ext;

        ctx.font = 'bold 15px system-ui';
        const w1 = ctx.measureText(line1).width;
        ctx.font = '13px system-ui';
        const w2 = ctx.measureText(line2).width;
        const cardW = Math.max(w1, w2) + 36;
        const cardH = 56;
        const cardX = sc.x - cardW / 2;
        const cardY = sc.y - sr - cardH - 14;

        // Card background
        ctx.fillStyle = 'rgba(20,20,26,0.95)';
        roundRect(ctx, cardX, cardY, cardW, cardH, 8);
        ctx.fill();
        ctx.strokeStyle = ec + '60';
        ctx.lineWidth = 1.5;
        roundRect(ctx, cardX, cardY, cardW, cardH, 8);
        ctx.stroke();

        // Card text
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 15px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(line1, sc.x, cardY + 24);
        ctx.fillStyle = ec;
        ctx.font = '13px system-ui';
        ctx.fillText(line2, sc.x, cardY + 44);

        // Pointer triangle
        ctx.fillStyle = 'rgba(20,20,26,0.95)';
        ctx.beginPath();
        ctx.moveTo(sc.x - 7, cardY + cardH);
        ctx.lineTo(sc.x + 7, cardY + cardH);
        ctx.lineTo(sc.x, cardY + cardH + 8);
        ctx.closePath();
        ctx.fill();
      }
    }

  } else {

    // ── Galaxy View ───────────────────────────────────────

    // Dot grid
    const gridSize = 40;
    const startWX = camera.x - W / 2 / camera.zoom;
    const startWY = camera.y - H / 2 / camera.zoom;
    const gx0 = Math.floor(startWX / gridSize) * gridSize;
    const gy0 = Math.floor(startWY / gridSize) * gridSize;
    ctx.fillStyle = `rgba(255,255,255,${clamp(0.025 * camera.zoom, 0.005, 0.04)})`;
    for (let wx = gx0; wx < startWX + W / camera.zoom + gridSize; wx += gridSize) {
      for (let wy = gy0; wy < startWY + H / camera.zoom + gridSize; wy += gridSize) {
        const s = worldToScreen(wx, wy);
        ctx.fillRect(s.x, s.y, 1, 1);
      }
    }

    // Galaxy orbit rings
    const origin = worldToScreen(0, 0);
    ctx.strokeStyle = 'rgba(255,255,255,0.02)';
    ctx.lineWidth = 1;
    for (const r of [200, 450, 700]) {
      ctx.beginPath();
      ctx.arc(origin.x, origin.y, r * camera.zoom, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Project spheres
    for (let i = 0; i < state.spheres.length; i++) {
      const s = state.spheres[i];
      const sc = worldToScreen(s.x, s.y);
      const sr = s.radius * camera.zoom;
      const isHovered = state.hoveredItem === i;

      const grad = ctx.createRadialGradient(sc.x, sc.y, 0, sc.x, sc.y, sr);
      grad.addColorStop(0, s.color + '25');
      grad.addColorStop(0.7, s.color + '0A');
      grad.addColorStop(1, s.color + '02');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(sc.x, sc.y, sr, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = isHovered ? s.color + '90' : s.color + '40';
      ctx.lineWidth = isHovered ? 2 : 1;
      ctx.beginPath();
      ctx.arc(sc.x, sc.y, sr, 0, Math.PI * 2);
      ctx.stroke();

      if (sr > 10) {
        ctx.fillStyle = isHovered ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.7)';
        ctx.font = `${clamp(Math.round(11 * camera.zoom), 8, 16)}px system-ui`;
        ctx.textAlign = 'center';
        ctx.fillText(s.name, sc.x, sc.y + sr + 14 * camera.zoom);

        ctx.fillStyle = s.color;
        ctx.font = `bold ${clamp(Math.round(10 * camera.zoom), 7, 14)}px system-ui`;
        ctx.fillText(`${s.nodeCount}`, sc.x, sc.y + 4);
      }
    }

    // Minimap
    const mmW = 140, mmH = 100;
    const mmX = W - mmW - 12, mmY = H - mmH - 12;
    const mmScale = 0.06;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.fillRect(mmX, mmY, mmW, mmH);
    ctx.strokeRect(mmX, mmY, mmW, mmH);
    const mmCx = mmX + mmW / 2, mmCy = mmY + mmH / 2;
    for (const s of state.spheres) {
      ctx.fillStyle = s.color + '80';
      ctx.beginPath();
      ctx.arc(mmCx + s.x * mmScale, mmCy + s.y * mmScale, Math.max(2, s.radius * mmScale), 0, Math.PI * 2);
      ctx.fill();
    }
    const camW = W / camera.zoom * mmScale, camH = H / camera.zoom * mmScale;
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.strokeRect(mmCx + camera.x * mmScale - camW / 2, mmCy + camera.y * mmScale - camH / 2, camW, camH);
  }

  requestAnimationFrame(render);
}

// ── Rounded rectangle helper ────────────────────────────────

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ── Start ───────────────────────────────────────────────────

init().then(() => {
  updateHUD();
  requestAnimationFrame(render);
});
