// ============================================================
// Portal Frontend — World-Space Placement
// ============================================================
// All placement is in world units (not screen pixels).
// Children orbit their parent at a fraction of parent's radius.
// This means positions are stable across window resizes and
// zoom levels — rendering decides what's visible, not placement.
// ============================================================

import type { SceneNode } from './scene-graph';
import { hashCode, clamp } from './math';
import { PROJECT_COLORS } from './colors';
import { state } from './state';

// ── Heat → Relative Rank ────────────────────────────────────

function mtimeFallbackScore(fileModified: string | null | undefined): number {
  if (!fileModified) return 10;
  const hoursAgo = (Date.now() - new Date(fileModified).getTime()) / (1000 * 60 * 60);
  if (hoursAgo < 48) return 85;
  if (hoursAgo < 168) return 65;
  if (hoursAgo < 720) return 40;
  return 15;
}

function getHeatScore(item: any): number {
  return item.heat_score ?? mtimeFallbackScore(item.meta_modified || item.file_modified);
}

// ── Galaxy Placement (project root nodes) ────────────────────

export interface GalaxyPosition {
  x: number;
  y: number;
  radius: number;
  color: string;
}

export function placeProjectsInGalaxy(projects: any[]): GalaxyPosition[] {
  const galaxyDays = parseFloat(state.settings['galaxy.project_orbit_days'] || '30');

  return projects.map((p: any, idx: number) => {
    const color = p.color || PROJECT_COLORS[idx % PROJECT_COLORS.length];
    const modified = p.latest_modified || p.updated_at;
    const now = Date.now();
    const modTime = new Date(modified).getTime();
    const daysAgo = (now - modTime) / (1000 * 60 * 60 * 24);

    const t = clamp(daysAgo / galaxyDays, 0, 1);
    const orbitalR = 150 + t * 600;
    const theta = (2 * Math.PI * (hashCode(p.id) % 10000)) / 10000;

    // Project radius in world units — bigger projects get bigger spheres
    const radius = 30 + Math.sqrt(Math.max(p.node_count || 1, 1)) * 3;

    return { x: orbitalR * Math.cos(theta), y: orbitalR * Math.sin(theta), radius, color };
  });
}

// ── Child Placement (world units, relative to parent) ────────

/**
 * Place a node's children in absolute world coordinates.
 * Children orbit within the parent's radius. Files are smaller,
 * folders are larger (they need room for their own children).
 *
 * Returns SceneNode[] with world-space x, y, radius.
 */
export function placeChildrenInWorld(parent: SceneNode, apiChildren: any[]): SceneNode[] {
  const folders = apiChildren.filter((c: any) => c.is_folder);
  const files = apiChildren.filter((c: any) => !c.is_folder);

  const placed: SceneNode[] = [];

  // Sort files by heat/recency (hottest first)
  const sortedFiles = [...files].sort((a: any, b: any) => getHeatScore(b) - getHeatScore(a));

  const fileCount = sortedFiles.length;

  // Place files
  for (let i = 0; i < fileCount; i++) {
    const item = sortedFiles[i];
    const rawHeat = getHeatScore(item);

    // Relative ranking: spread files from inner to outer orbit
    const rankT = fileCount <= 1 ? 0 : i / (fileCount - 1); // 0 = hottest, 1 = coldest
    const orbitR = parent.radius * 0.15 + rankT * (parent.radius * 0.55 - parent.radius * 0.15);

    const relativeHeat = fileCount <= 1 ? 90 : 95 - rankT * 85;
    const tier = relativeHeat >= 75 ? 'active' : relativeHeat >= 50 ? 'reference' : relativeHeat >= 25 ? 'dormant' : 'cold';

    // Angle: spread evenly with hash jitter
    const angleBase = (2 * Math.PI * i) / Math.max(fileCount, 1);
    const jitter = ((hashCode(item.id) % 1000) / 1000 - 0.5) * 0.3;
    const angle = angleBase + jitter;

    // File radius: proportional to parent (small)
    const fileRadius = parent.radius * 0.04 + (relativeHeat / 100) * parent.radius * 0.03;

    placed.push({
      id: item.id,
      type: 'file',
      label: item.label,
      x: parent.x + orbitR * Math.cos(angle),
      y: parent.y + orbitR * Math.sin(angle),
      radius: fileRadius,
      color: parent.color,
      ext: (item.vault_ext || item.type || 'file').toLowerCase(),
      heat: rawHeat,
      heatTier: tier,
      opacity: 0.45 + (relativeHeat / 100) * 0.55,
      parentId: parent.id,
      children: null,
      childCount: 0,
      loadState: 'loaded',
      sourcePath: item.source_path,
    });
  }

  // Place folders
  for (let i = 0; i < folders.length; i++) {
    const item = folders[i];
    const angle = (2 * Math.PI * i) / Math.max(folders.length, 1);
    const jitter = ((hashCode(item.id + 'fr') % 100) / 100 - 0.5) * 0.15;

    // Folder radius: proportional to parent, scaled by child count
    const baseR = parent.radius * 0.15;
    const countBoost = Math.sqrt(Math.max(item.child_count || 1, 1)) * parent.radius * 0.02;
    const folderRadius = baseR + countBoost;

    placed.push({
      id: item.id,
      type: 'folder',
      label: item.label,
      x: parent.x + parent.radius * 0.80 * Math.cos(angle + jitter),
      y: parent.y + parent.radius * 0.80 * Math.sin(angle + jitter),
      radius: folderRadius,
      color: parent.color,
      ext: 'folder',
      heat: 0,
      heatTier: 'cold',
      opacity: 1.0,
      parentId: parent.id,
      children: null,
      childCount: item.child_count || 0,
      loadState: 'unloaded',
      latestModified: item.latest_child_modified,
    });
  }

  return placed;
}
