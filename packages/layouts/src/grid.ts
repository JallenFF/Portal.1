// ============================================================
// Grid Layout Strategy
// ============================================================
// Auto-organizes files into a grid, grouped by a chosen key:
//   - "type": group by file extension
//   - "name": alphabetical
//   - "date": chronological by last used
//
// Static layout — no physics. Nodes snap to positions.
// Useful for quick visual scan of project contents.
// ============================================================

import type { Node, Edge, NodeId } from "../../core/src/types";
import type { LayoutStrategy, LayoutPosition, LayoutConfig } from "./types";

type GridGroupBy = "type" | "name" | "date";

export const gridLayout: LayoutStrategy = {
  name: "grid",
  label: "Grid",
  usesPhysics: false,

  computePositions(
    nodes: Node[],
    _edges: Edge[],
    config: LayoutConfig,
  ): Record<NodeId, LayoutPosition> {
    const positions: Record<NodeId, LayoutPosition> = {};
    const groupBy = (config.params.groupBy as GridGroupBy) ?? "type";
    const cellW = (config.params.cellWidth as number) ?? 80;
    const cellH = (config.params.cellHeight as number) ?? 70;
    const groupGap = (config.params.groupGap as number) ?? 40;
    const cols = (config.params.columns as number) ?? 5;

    // Sort/group nodes
    let sorted: Node[];
    switch (groupBy) {
      case "type":
        sorted = [...nodes].sort((a, b) => a.ext.localeCompare(b.ext) || a.name.localeCompare(b.name));
        break;
      case "name":
        sorted = [...nodes].sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "date":
        sorted = [...nodes].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
        break;
      default:
        sorted = [...nodes];
    }

    // Group by key
    const groups: Map<string, Node[]> = new Map();
    for (const node of sorted) {
      const key = groupBy === "type" ? node.ext
        : groupBy === "date" ? getDateGroup(node.lastUsedAt)
        : node.name[0]?.toUpperCase() || "?";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(node);
    }

    // Lay out groups
    const totalWidth = cols * cellW;
    const startX = -totalWidth / 2;
    let currentY = -((groups.size * 3 * cellH) / 2); // rough centering

    for (const [, groupNodes] of groups) {
      let col = 0;
      for (const node of groupNodes) {
        positions[node.id] = {
          x: startX + col * cellW + cellW / 2,
          y: currentY,
          group: node.ext,
        };
        col++;
        if (col >= cols) {
          col = 0;
          currentY += cellH;
        }
      }
      currentY += groupGap; // gap between groups
    }

    return positions;
  },
};

function getDateGroup(timestamp: number): string {
  const age = Date.now() - timestamp;
  const days = age / 86400000;
  if (days < 1) return "Today";
  if (days < 7) return "This Week";
  if (days < 30) return "This Month";
  if (days < 180) return "Recent";
  return "Archive";
}
