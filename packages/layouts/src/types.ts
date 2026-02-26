// ============================================================
// Layout Strategy Interface
// ============================================================
// Every organization pattern (orbit, free, grid, flowchart,
// systems-map, etc.) implements this interface.
//
// A layout strategy takes nodes + edges + config and returns
// target positions. It does NOT render anything.
//
// Some strategies use physics (orbit, free). Some don't (grid).
// The `usesPhysics` flag tells the renderer whether to run
// the force solver or just snap to positions.
//
// Adding a new layout = adding one file that implements
// LayoutStrategy. No changes to renderer, physics, or core.
// ============================================================

import type { Node, Edge, NodeId } from "../../core/src/types";

// ------------------------------------------------------------
// Position output
// ------------------------------------------------------------
export interface LayoutPosition {
  x: number;      // relative to project center (0,0)
  y: number;
  // Optional hints for the renderer
  ring?: number;  // which ring/tier this node belongs to (orbit)
  angle?: number; // stable angle (orbit)
  group?: string; // grouping key (grid by type, etc.)
}

// ------------------------------------------------------------
// Layout Strategy
// ------------------------------------------------------------
export interface LayoutStrategy {
  /** Unique name used as key in node.positions */
  name: string;
  
  /** Human-readable label for toolbar */
  label: string;
  
  /** Does this layout need the physics solver to animate? */
  usesPhysics: boolean;
  
  /**
   * Compute target positions for all nodes.
   * Called once when switching layouts, or on data change.
   * 
   * For physics-based layouts, these are "target" positions
   * that forces pull toward. For static layouts, these are
   * final positions.
   */
  computePositions(
    nodes: Node[],
    edges: Edge[],
    config: LayoutConfig,
  ): Record<NodeId, LayoutPosition>;
  
  /**
   * Optional: compute forces for physics-based layouts.
   * Called every frame by the solver.
   * Returns force vectors to apply to each node.
   * 
   * Only required if usesPhysics = true.
   */
  computeForces?(
    bodies: LayoutBody[],
    targets: Record<NodeId, LayoutPosition>,
    config: LayoutConfig,
  ): Record<NodeId, { fx: number; fy: number }>;
}

// ------------------------------------------------------------
// Layout Body (physics-enabled node)
// ------------------------------------------------------------
/**
 * A LayoutBody is the physics representation of a node.
 * Transient state only — x, y, vx, vy are NOT persisted.
 * The persisted position is in node.positions[layoutName].
 */
export interface LayoutBody {
  id: NodeId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  width: number;
  height: number;
  dragging: boolean;
  mass: number;
}

// ------------------------------------------------------------
// Layout Config
// ------------------------------------------------------------
/**
 * Configuration passed to layout strategies.
 * Includes sphere geometry + any strategy-specific params.
 */
export interface LayoutConfig {
  /** Radius of the project sphere (available space) */
  sphereRadius: number;
  
  /** Inflation factor when focused (more room inside) */
  focusInflation: number;
  
  /** Core exclusion radius (center stays empty) */
  coreRadius: number;
  
  /** Strategy-specific parameters */
  params: Record<string, unknown>;
}

// ------------------------------------------------------------
// Layout Registry
// ------------------------------------------------------------
/**
 * The registry holds all available layout strategies.
 * The toolbar reads from this to build the mode switcher.
 * Adding a strategy = registering it here.
 */
export class LayoutRegistry {
  private strategies: Map<string, LayoutStrategy> = new Map();
  
  register(strategy: LayoutStrategy): void {
    this.strategies.set(strategy.name, strategy);
  }
  
  get(name: string): LayoutStrategy | undefined {
    return this.strategies.get(name);
  }
  
  list(): LayoutStrategy[] {
    return Array.from(this.strategies.values());
  }
  
  names(): string[] {
    return Array.from(this.strategies.keys());
  }
}
