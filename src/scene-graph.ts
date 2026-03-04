// ============================================================
// Portal Frontend — Scene Graph
// ============================================================
// Unified tree of nodes replacing the old binary model.
// Every entity (project, folder, file) is a SceneNode.
// Position is in world units (absolute coordinates).
// Radius is in world units (stable across zoom levels).
// ============================================================

export interface SceneNode {
  // Identity
  id: string;
  type: 'project' | 'folder' | 'file';
  label: string;

  // World-space position (absolute galaxy coordinates)
  x: number;
  y: number;

  // World-space radius — determines visual size AND child orbit zone
  radius: number;

  // Visual
  color: string;
  ext: string;
  heat: number;
  heatTier: string;
  opacity: number;

  // Hierarchy
  parentId: string | null;
  children: SceneNode[] | null;  // null = not yet loaded from API
  childCount: number;            // known count (from API), even before children are loaded

  // Loading state
  loadState: 'unloaded' | 'loading' | 'loaded';

  // API metadata (pass-through for actions)
  nodeCount?: number;       // project only: total descendant count
  latestModified?: string;
  sourcePath?: string;
}

// ── Build root nodes from API projects response ──────────────

export function buildProjectNodes(projects: any[], galaxyPositions: Array<{ x: number; y: number; radius: number; color: string }>): SceneNode[] {
  return projects.map((p: any, i: number) => ({
    id: p.id,
    type: 'project' as const,
    label: p.name,
    x: galaxyPositions[i].x,
    y: galaxyPositions[i].y,
    radius: galaxyPositions[i].radius,
    color: galaxyPositions[i].color,
    ext: 'project',
    heat: 0,
    heatTier: 'cold',
    opacity: 1.0,
    parentId: null,
    children: null,
    childCount: p.node_count || 0,
    loadState: 'unloaded' as const,
    nodeCount: p.node_count || 0,
    latestModified: p.latest_modified || p.updated_at,
  }));
}

// ── Traverse parent chain (for breadcrumb) ───────────────────

export function getAncestorChain(node: SceneNode, roots: SceneNode[]): SceneNode[] {
  const chain: SceneNode[] = [];
  let current: SceneNode | null = node;

  while (current) {
    chain.unshift(current);
    if (current.parentId) {
      current = findNode(roots, current.parentId);
    } else {
      current = null;
    }
  }

  return chain;
}

// ── Find a node by ID (depth-first search) ───────────────────

export function findNode(roots: SceneNode[], id: string): SceneNode | null {
  for (const root of roots) {
    const found = findNodeInTree(root, id);
    if (found) return found;
  }
  return null;
}

function findNodeInTree(node: SceneNode, id: string): SceneNode | null {
  if (node.id === id) return node;
  if (node.children) {
    for (const child of node.children) {
      const found = findNodeInTree(child, id);
      if (found) return found;
    }
  }
  return null;
}

// ── Hit testing: find deepest node at world point ────────────

export function hitTest(roots: SceneNode[], worldX: number, worldY: number, cameraZoom: number): SceneNode | null {
  let bestHit: SceneNode | null = null;
  let bestDepth = -1;

  function search(node: SceneNode, depth: number): void {
    const dx = worldX - node.x;
    const dy = worldY - node.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Generous hit area: minimum 8px screen radius for small nodes
    // File thumbnails are taller (2x radius), so use a bigger hit area
    const screenR = node.radius * cameraZoom;
    const hitMultiplier = (node.type === 'file' && screenR >= 12) ? 1.5 : 1.0;
    const hitRadius = Math.max(node.radius * hitMultiplier, 8 / cameraZoom);

    if (dist < hitRadius) {
      // Hit this node. Deeper nodes take priority.
      if (depth > bestDepth) {
        bestHit = node;
        bestDepth = depth;
      }
    }

    // Only search children if they'd be visible
    if (node.children && screenR > 30) {
      for (const child of node.children) {
        search(child, depth + 1);
      }
    }
  }

  for (const root of roots) {
    search(root, 0);
  }

  return bestHit;
}
