export * from "./types";
export { freeLayout } from "./free";
export { orbitLayout, DEFAULT_RING_BUCKETS } from "./orbit";
export type { RingBucketType } from "./orbit";
export { gridLayout } from "./grid";

import { LayoutRegistry } from "./types";
import { freeLayout } from "./free";
import { orbitLayout } from "./orbit";
import { gridLayout } from "./grid";

/**
 * Create a registry pre-loaded with the built-in layouts.
 * The renderer calls this on init.
 * 
 * To add a custom layout:
 *   const registry = createDefaultRegistry();
 *   registry.register(myCustomLayout);
 */
export function createDefaultRegistry(): LayoutRegistry {
  const registry = new LayoutRegistry();
  registry.register(freeLayout);
  registry.register(orbitLayout);
  registry.register(gridLayout);
  return registry;
}
