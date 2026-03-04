// ============================================================
// Portal Frontend — Lazy Loader
// ============================================================
// Fetches children from the hub API when a node becomes large
// enough on screen to show detail. Caches loaded children in
// the scene graph. No prefetching — load only what's visible.
// ============================================================

import type { SceneNode } from './scene-graph';
import { fetchProjectChildren, fetchNodeChildren } from './api';
import { placeChildrenInWorld } from './placement';

// ── Loading Queue ────────────────────────────────────────────

const _loading = new Set<string>();

/**
 * Request that a node's children be loaded from the API.
 * No-op if already loaded or currently loading.
 */
export async function requestLoad(node: SceneNode): Promise<void> {
  if (node.loadState !== 'unloaded') return;
  if (_loading.has(node.id)) return;

  _loading.add(node.id);
  node.loadState = 'loading';

  try {
    let apiChildren: any[];

    if (node.type === 'project') {
      apiChildren = await fetchProjectChildren(node.id);
    } else {
      apiChildren = await fetchNodeChildren(node.id);
    }

    // Place children in world coordinates relative to parent
    node.children = placeChildrenInWorld(node, apiChildren);
    node.loadState = 'loaded';
  } catch (e) {
    console.error(`Failed to load children for ${node.id}:`, e);
    node.loadState = 'unloaded'; // allow retry
  } finally {
    _loading.delete(node.id);
  }
}

/**
 * Check if a node should have its children loaded based on
 * its screen-space size.
 */
export function shouldLoad(node: SceneNode, screenRadius: number): boolean {
  return (
    node.childCount > 0 &&
    node.loadState === 'unloaded' &&
    screenRadius > 40
  );
}
