// ============================================================
// Portal v0.3.0 — Spatial Canvas Renderer
// Vanilla JS. Talks to Hub API at localhost:3141.
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
const mouse = { x: 0, y: 0, startX: 0, startY: 0, worldX: 0, worldY: 0, down: false, dragIdx: -1 };

const state = {
  locked: true,
  focusedProject: -1,    // index into spheres[] (zoomed into)
  selectedProject: -1,   // index into spheres[] (clicked, camera locked to it)
  hoveredProject: -1,
  hoveredFile: -1,
  selectedFile: -1,      // clicked file inside a sphere
  fileScatter: null,
  spheres: [],
  relationships: [],
  loading: true,
  error: null,
};

// ── Physics Constants ───────────────────────────────────────

const WORLD = {
  R_MIN: 250,
  R_MAX: 900,
  GAMMA: 2,
  K_ANCHOR: 0.03,
  K_REPEL: 2.0,
  K_LINK: 0.005,
  DAMPING: 0.88,
  DT: 1,
  SPACING: 30,
  R_BASE: 40,
  R_SCALE: 4,
  N_MAX: 20,
};

const EXT_COLORS = {
  pdf: '#EF4444', docx: '#3B82F6', xlsx: '#10B981', csv: '#6EE7B7',
  md: '#A78BFA', html: '#F97316', js: '#FBBF24', ts: '#3B82F6',
  json: '#6B7280', pptx: '#F59E0B', mp4: '#EC4899', env: '#6B7280',
  web: '#60A5FA', app: '#34D399', email: '#F472B6', dir: '#FCD34D',
  txt: '#9CA3AF', css: '#06B6D4', png: '#F472B6', jpg: '#F472B6',
  svg: '#A78BFA', zip: '#6B7280',
};

// ── Utilities ───────────────────────────────────────────────

function hashCode(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function dist(a, b) { return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2); }

function screenToWorld(sx, sy) {
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  return {
    x: (sx - cx) / camera.zoom + camera.x,
    y: (sy - cy) / camera.zoom + camera.y,
  };
}

function worldToScreen(wx, wy) {
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  return {
    x: (wx - camera.x) * camera.zoom + cx,
    y: (wy - camera.y) * camera.zoom + cy,
  };
}

// ── Hub API ─────────────────────────────────────────────────

async function fetchProjects() {
  try {
    const res = await fetch(`${HUB}/projects`);
    const data = await res.json();
    return data.projects || [];
  } catch (e) {
    console.error('Failed to fetch projects:', e);
    return null;
  }
}

async function fetchProjectNodes(projectId) {
  try {
    const res = await fetch(`${HUB}/projects/${projectId}`);
    const data = await res.json();
    return data.nodes || [];
  } catch (e) {
    console.error('Failed to fetch nodes:', e);
    return [];
  }
}

async function fetchPositions(layout) {
  try {
    const res = await fetch(`${HUB}/positions/${layout}`);
    const data = await res.json();
    return data.positions || [];
  } catch (e) {
    return [];
  }
}

async function savePositions(layout, positions) {
  try {
    await fetch(`${HUB}/positions/${layout}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ positions }),
    });
  } catch (e) {
    console.error('Failed to save positions:', e);
  }
}

// ── Default colors for projects ─────────────────────────────

const PROJECT_COLORS = [
  '#F59E0B', '#3B82F6', '#8B5CF6', '#10B981',
  '#EF4444', '#EC4899', '#06B6D4', '#84CC16',
];

// ── Build Spheres from API Data ─────────────────────────────

function buildSpheres(projects) {
  return projects.map((p, idx) => {
    const color = p.color || PROJECT_COLORS[idx % PROJECT_COLORS.length];
    const meta = typeof p.meta === 'string' ? JSON.parse(p.meta) : (p.meta || {});
    const itemCount = 0; // will be populated when zoomed in
    const radius = WORLD.R_BASE + WORLD.R_SCALE * Math.sqrt(Math.max(itemCount, 1));
    const activity = meta.activity || 0.5;
    const orbitalR = WORLD.R_MIN + Math.pow(1 - activity, WORLD.GAMMA) * (WORLD.R_MAX - WORLD.R_MIN);
    const theta = 2 * Math.PI * ((hashCode(p.id) % 10000) / 10000);
    const tx = orbitalR * Math.cos(theta);
    const ty = orbitalR * Math.sin(theta);

    return {
      id: p.id,
      name: p.name,
      color,
      activity,
      radius,
      theta,
      orbitalR,
      anchorX: tx,
      anchorY: ty,
      x: tx + (Math.random() - 0.5) * 40,
      y: ty + (Math.random() - 0.5) * 40,
      vx: 0,
      vy: 0,
      mass: 1 + Math.max(itemCount, 1) * 0.1,
      dragging: false,
      nodes: [],       // populated on zoom-in
      nodeCount: 0,
    };
  });
}

// ── Physics Step ────────────────────────────────────────────

function stepPhysics() {
  const spheres = state.spheres;
  const forces = spheres.map(() => ({ fx: 0, fy: 0 }));

  // Anchor forces
  for (let i = 0; i < spheres.length; i++) {
    if (spheres[i].dragging) continue;
    const s = spheres[i];
    forces[i].fx += WORLD.K_ANCHOR * (s.anchorX - s.x);
    forces[i].fy += WORLD.K_ANCHOR * (s.anchorY - s.y);
  }

  // Repulsion
  for (let i = 0; i < spheres.length; i++) {
    for (let j = i + 1; j < spheres.length; j++) {
      const a = spheres[i], b = spheres[j];
      const dx = a.x - b.x, dy = a.y - b.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const minDist = a.radius + b.radius + WORLD.SPACING;
      if (d < minDist) {
        const f = WORLD.K_REPEL * (minDist - d);
        const ux = dx / d, uy = dy / d;
        forces[i].fx += f * ux;
        forces[i].fy += f * uy;
        forces[j].fx -= f * ux;
        forces[j].fy -= f * uy;
      }
    }
  }

  // Integration
  for (let i = 0; i < spheres.length; i++) {
    const s = spheres[i];
    if (s.dragging) continue;
    s.vx = WORLD.DAMPING * s.vx + WORLD.DT * forces[i].fx / s.mass;
    s.vy = WORLD.DAMPING * s.vy + WORLD.DT * forces[i].fy / s.mass;
    const speed = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
    if (speed > 10) { s.vx *= 10 / speed; s.vy *= 10 / speed; }
    s.x += WORLD.DT * s.vx;
    s.y += WORLD.DT * s.vy;
  }
}

// ── File Scatter ────────────────────────────────────────────

function scatterFiles(nodes, sphereRadius) {
  const r = sphereRadius * 2.5;
  return nodes.map((node, i) => {
    const angle = (2 * Math.PI * i) / nodes.length + (hashCode(node.id) % 100) * 0.01;
    const d = 30 + (hashCode(node.id + 'dist') % 100) / 100 * (r - 50);
    return {
      id: node.id,
      label: node.label || node.filename || 'untitled',
      ext: (node.ext || node.type || 'file').toLowerCase(),
      localX: d * Math.cos(angle),
      localY: d * Math.sin(angle),
    };
  });
}

// ── Initialize ──────────────────────────────────────────────

async function init() {
  const projects = await fetchProjects();

  if (projects === null) {
    state.error = 'Cannot connect to Hub. Is it running on port 3141?';
    state.loading = false;
    return;
  }

  if (projects.length === 0) {
    state.error = 'No projects yet. Create one via the Hub API.';
    state.loading = false;
    // Still render — just show empty galaxy
  }

  state.spheres = buildSpheres(projects);
  state.loading = false;
  state.error = null;
}

// ── Zoom Handler ────────────────────────────────────────────

window.addEventListener('wheel', (e) => {
  e.preventDefault();

  if (state.focusedProject >= 0) {
    // Scroll out = exit project
    if (e.deltaY > 0) {
      state.focusedProject = -1;
      state.fileScatter = null;
      state.selectedFile = -1;
      camera.targetZoom = 0.5;
      camera.targetX = 0;
      camera.targetY = 0;
      updateHUD();
    }
    return;
  }

  const zoomFactor = e.deltaY > 0 ? 0.88 : 1.14;
  const newZoom = clamp(camera.targetZoom * zoomFactor, 0.15, 4.0);

  // If a sphere is selected, zoom toward it instead of mouse position
  if (state.selectedProject >= 0) {
    const s = state.spheres[state.selectedProject];
    const ratio = 1 - newZoom / camera.targetZoom;
    camera.targetX += (s.x - camera.x) * ratio;
    camera.targetY += (s.y - camera.y) * ratio;
    camera.targetZoom = newZoom;

    // Auto-enter when zoomed in enough
    if (newZoom > 2.0) {
      enterProject(state.selectedProject);
    }
  } else {
    // Zoom toward mouse
    const world = screenToWorld(e.clientX, e.clientY);
    const ratio = 1 - newZoom / camera.targetZoom;
    camera.targetX += (world.x - camera.x) * ratio;
    camera.targetY += (world.y - camera.y) * ratio;
    camera.targetZoom = newZoom;
  }
}, { passive: false });

async function enterProject(idx) {
  const s = state.spheres[idx];
  state.focusedProject = idx;
  camera.targetX = s.x;
  camera.targetY = s.y;
  camera.targetZoom = 3.5;

  // Fetch nodes from hub
  const nodes = await fetchProjectNodes(s.id);
  s.nodes = nodes;
  s.nodeCount = nodes.length;
  s.radius = WORLD.R_BASE + WORLD.R_SCALE * Math.sqrt(Math.max(nodes.length, 1));
  state.fileScatter = scatterFiles(nodes, s.radius);
  updateHUD();
}

// ── Mouse Handlers ──────────────────────────────────────────

canvas.addEventListener('mousedown', (e) => {
  mouse.down = true;
  mouse.x = e.clientX;
  mouse.y = e.clientY;
  mouse.startX = e.clientX;
  mouse.startY = e.clientY;
  const world = screenToWorld(e.clientX, e.clientY);

  // Inside a focused project — click on files
  if (state.focusedProject >= 0 && state.fileScatter) {
    const s = state.spheres[state.focusedProject];
    for (let i = 0; i < state.fileScatter.length; i++) {
      const f = state.fileScatter[i];
      const fd = dist(world, { x: s.x + f.localX, y: s.y + f.localY });
      if (fd < 18) {
        state.selectedFile = i;
        updateHUD();
        return;
      }
    }
    state.selectedFile = -1;
    return;
  }

  // Galaxy view — click on sphere to select it
  for (let i = 0; i < state.spheres.length; i++) {
    if (dist(world, state.spheres[i]) < state.spheres[i].radius) {
      // If unlocked, allow dragging
      if (!state.locked) {
        mouse.dragIdx = i;
        state.spheres[i].dragging = true;
      }
      // Always select on click
      state.selectedProject = i;
      console.log('Selected sphere:', i, state.spheres[i].name);
      updateHUD();
      return;
    }
  }

  // Clicked empty space — deselect
  state.selectedProject = -1;
  updateHUD();
});

window.addEventListener('mousemove', (e) => {
  const world = screenToWorld(e.clientX, e.clientY);
  mouse.worldX = world.x;
  mouse.worldY = world.y;

  // Calculate drag distance from mousedown point
  const dragDist = Math.sqrt((e.clientX - mouse.startX) ** 2 + (e.clientY - mouse.startY) ** 2);

  if (mouse.down && mouse.dragIdx >= 0) {
    const s = state.spheres[mouse.dragIdx];
    s.x = world.x;
    s.y = world.y;
    s.vx = 0;
    s.vy = 0;
  } else if (mouse.down && mouse.dragIdx < 0 && dragDist > 3) {
    // Pan — only if dragged more than 3px (prevents pan on click)
    const dx = (e.clientX - mouse.x) / camera.zoom;
    const dy = (e.clientY - mouse.y) / camera.zoom;
    camera.targetX -= dx;
    camera.targetY -= dy;
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  }

  // Hover detection
  if (state.focusedProject >= 0 && state.fileScatter) {
    const s = state.spheres[state.focusedProject];
    let hit = -1;
    for (let i = 0; i < state.fileScatter.length; i++) {
      const f = state.fileScatter[i];
      const fd = dist(world, { x: s.x + f.localX, y: s.y + f.localY });
      if (fd < 18) { hit = i; break; }
    }
    state.hoveredFile = hit;
  } else {
    let hit = -1;
    for (let i = 0; i < state.spheres.length; i++) {
      if (dist(world, state.spheres[i]) < state.spheres[i].radius) { hit = i; break; }
    }
    state.hoveredProject = hit;
  }
});

window.addEventListener('mouseup', () => {
  if (mouse.dragIdx >= 0) {
    const s = state.spheres[mouse.dragIdx];
    s.dragging = false;
    s.anchorX = s.x;
    s.anchorY = s.y;
  }
  mouse.down = false;
  mouse.dragIdx = -1;
});

// Double-click to enter project
canvas.addEventListener('dblclick', (e) => {
  if (state.focusedProject >= 0) return;
  const world = screenToWorld(e.clientX, e.clientY);
  for (let i = 0; i < state.spheres.length; i++) {
    if (dist(world, state.spheres[i]) < state.spheres[i].radius) {
      enterProject(i);
      return;
    }
  }
});

// ── Keyboard ────────────────────────────────────────────────

window.addEventListener('keydown', (e) => {
  if (e.key === 'l' || e.key === 'L') {
    state.locked = !state.locked;
    updateHUD();
  }
  if (e.key === 'Escape') {
    if (state.focusedProject >= 0) {
      state.focusedProject = -1;
      state.fileScatter = null;
      state.selectedFile = -1;
      camera.targetZoom = 0.5;
      camera.targetX = 0;
      camera.targetY = 0;
      updateHUD();
    } else if (state.selectedProject >= 0) {
      state.selectedProject = -1;
      updateHUD();
    }
  }
});

// ── HUD ─────────────────────────────────────────────────────

const hudTitle = document.getElementById('hud-title');
const hudProject = document.getElementById('hud-project');
const hudLock = document.getElementById('hud-lock');
const hudHint = document.getElementById('hud-hint');

function updateHUD() {
  if (state.focusedProject >= 0) {
    const s = state.spheres[state.focusedProject];
    hudProject.textContent = s.name;
    hudProject.style.display = 'block';
    hudHint.textContent = 'scroll down to exit · Esc = exit · click file to select';
  } else if (state.selectedProject >= 0) {
    const s = state.spheres[state.selectedProject];
    hudProject.textContent = s.name + ' (selected)';
    hudProject.style.display = 'block';
    hudHint.textContent = 'scroll = zoom to sphere · dbl-click = enter · click empty = deselect';
  } else {
    hudProject.style.display = 'none';
    hudHint.textContent = 'scroll = zoom · drag = pan · L = lock/free · click sphere = select';
  }

  hudLock.textContent = state.locked ? '🔒 Locked' : '🔓 Free';
  hudLock.style.background = state.locked ? 'rgba(255,255,255,0.06)' : 'rgba(16,185,129,0.15)';
  hudLock.style.borderColor = state.locked ? 'rgba(255,255,255,0.08)' : 'rgba(16,185,129,0.3)';
  hudLock.style.color = state.locked ? 'rgba(255,255,255,0.4)' : '#10B981';
}

hudLock.addEventListener('click', () => {
  state.locked = !state.locked;
  updateHUD();
});

// ── Render Loop ─────────────────────────────────────────────

function render() {
  // Physics (only in galaxy view)
  if (state.focusedProject < 0 && state.spheres.length > 0) {
    stepPhysics();
  }

  // Camera interpolation
  camera.x = lerp(camera.x, camera.targetX, 0.08);
  camera.y = lerp(camera.y, camera.targetY, 0.08);
  camera.zoom = lerp(camera.zoom, camera.targetZoom, 0.08);

  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // Background
  ctx.fillStyle = '#08080A';
  ctx.fillRect(0, 0, W, H);

  // ── Loading / Error States ──────────────────────────────

  if (state.loading) {
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Connecting to Hub...', W / 2, H / 2);
    requestAnimationFrame(render);
    return;
  }

  if (state.error && state.spheres.length === 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(state.error, W / 2, H / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText('Create projects via Hub API, then refresh', W / 2, H / 2 + 24);
    requestAnimationFrame(render);
    return;
  }

  // ── Dot Grid ────────────────────────────────────────────

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

  // ── Orbit Rings ─────────────────────────────────────────

  const origin = worldToScreen(0, 0);
  ctx.strokeStyle = 'rgba(255,255,255,0.02)';
  ctx.lineWidth = 1;
  for (const r of [WORLD.R_MIN, (WORLD.R_MIN + WORLD.R_MAX) / 2, WORLD.R_MAX]) {
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, r * camera.zoom, 0, Math.PI * 2);
    ctx.stroke();
  }

  // ── Spheres ─────────────────────────────────────────────

  const spheres = state.spheres;

  for (let i = 0; i < spheres.length; i++) {
    const s = spheres[i];
    const sc = worldToScreen(s.x, s.y);
    const sr = s.radius * camera.zoom;
    const isHovered = state.hoveredProject === i;
    const isFocused = state.focusedProject === i;

    // Fade non-focused when inside a project
    if (state.focusedProject >= 0 && !isFocused) {
      ctx.globalAlpha = 0.1;
    }

    // Sphere body — radial gradient
    const grad = ctx.createRadialGradient(sc.x, sc.y, 0, sc.x, sc.y, sr);
    grad.addColorStop(0, s.color + '20');
    grad.addColorStop(0.7, s.color + '08');
    grad.addColorStop(1, s.color + '02');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(sc.x, sc.y, sr, 0, Math.PI * 2);
    ctx.fill();

    // Border
    ctx.strokeStyle = isHovered ? s.color + '80' : s.color + '30';
    ctx.lineWidth = isHovered ? 2 : 1;
    ctx.beginPath();
    ctx.arc(sc.x, sc.y, sr, 0, Math.PI * 2);
    ctx.stroke();

    // Activity glow
    if (s.activity > 0.7) {
      ctx.strokeStyle = s.color + '15';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(sc.x, sc.y, sr + 6, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Selection ring
    if (state.selectedProject === i && state.focusedProject < 0) {
      ctx.strokeStyle = s.color + 'AA';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(sc.x, sc.y, sr + 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Label
    if (sr > 15) {
      ctx.fillStyle = isHovered ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.7)';
      ctx.font = `${clamp(Math.round(11 * camera.zoom), 8, 16)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(s.name, sc.x, sc.y + sr + 14 * camera.zoom);

      // Node count
      ctx.fillStyle = s.color;
      ctx.font = `bold ${clamp(Math.round(10 * camera.zoom), 7, 14)}px system-ui, sans-serif`;
      ctx.fillText(`${s.nodeCount}`, sc.x, sc.y + 4);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = `${clamp(Math.round(7 * camera.zoom), 5, 10)}px system-ui, sans-serif`;
      ctx.fillText('items', sc.x, sc.y + 14);
    }

    ctx.globalAlpha = 1;
  }

  // ── Files Inside Focused Project ────────────────────────

  if (state.focusedProject >= 0 && state.fileScatter) {
    const s = spheres[state.focusedProject];

    for (let i = 0; i < state.fileScatter.length; i++) {
      const f = state.fileScatter[i];
      const fx = s.x + f.localX;
      const fy = s.y + f.localY;
      const fsc = worldToScreen(fx, fy);
      const isFileHovered = state.hoveredFile === i;
      const fSize = isFileHovered ? 20 : 15;
      const ec = EXT_COLORS[f.ext] || '#6B7280';

      // File dot
      ctx.fillStyle = ec + (isFileHovered ? 'CC' : '80');
      ctx.beginPath();
      ctx.arc(fsc.x, fsc.y, fSize * camera.zoom * 0.3, 0, Math.PI * 2);
      ctx.fill();

      // File border
      ctx.strokeStyle = ec + (isFileHovered ? 'AA' : '40');
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(fsc.x, fsc.y, fSize * camera.zoom * 0.3, 0, Math.PI * 2);
      ctx.stroke();

      // Ext badge
      ctx.fillStyle = ec;
      ctx.font = `bold ${Math.max(8, Math.round(7 * camera.zoom))}px system-ui`;
      ctx.textAlign = 'center';
      ctx.fillText(f.ext.toUpperCase(), fsc.x, fsc.y + fSize * camera.zoom * 0.3 + 12);

      // Name (visible when zoomed in or hovered)
      if (camera.zoom > 2 || isFileHovered) {
        ctx.fillStyle = isFileHovered ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.55)';
        ctx.font = `${Math.max(8, Math.round(8 * camera.zoom * 0.4))}px system-ui`;
        ctx.fillText(f.label, fsc.x, fsc.y - fSize * camera.zoom * 0.3 - 6);
      }

      // Hover tooltip
      if (isFileHovered) {
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        const tw = ctx.measureText(f.label).width + 16;
        ctx.fillRect(fsc.x - tw / 2, fsc.y - fSize * camera.zoom * 0.3 - 24, tw, 16);
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.font = '10px system-ui';
        ctx.fillText(f.label, fsc.x, fsc.y - fSize * camera.zoom * 0.3 - 12);
      }
    }
  }

  // ── Minimap ─────────────────────────────────────────────

  const mmW = 140, mmH = 100;
  const mmX = W - mmW - 12, mmY = H - mmH - 12;
  const mmScale = 0.06;

  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  ctx.fillRect(mmX, mmY, mmW, mmH);
  ctx.strokeRect(mmX, mmY, mmW, mmH);

  const mmCx = mmX + mmW / 2;
  const mmCy = mmY + mmH / 2;

  for (let i = 0; i < spheres.length; i++) {
    const s = spheres[i];
    const mx = mmCx + s.x * mmScale;
    const my = mmCy + s.y * mmScale;
    ctx.fillStyle = s.color + '80';
    ctx.beginPath();
    ctx.arc(mx, my, Math.max(2, s.radius * mmScale), 0, Math.PI * 2);
    ctx.fill();
  }

  // Camera rect on minimap
  const camW = W / camera.zoom * mmScale;
  const camH = H / camera.zoom * mmScale;
  const camMX = mmCx + camera.x * mmScale - camW / 2;
  const camMY = mmCy + camera.y * mmScale - camH / 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 1;
  ctx.strokeRect(camMX, camMY, camW, camH);

  requestAnimationFrame(render);
}

// ── Start ───────────────────────────────────────────────────

init().then(() => {
  updateHUD();
  requestAnimationFrame(render);
});