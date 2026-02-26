// ============================================================
// Portal Core Graph Operations
// ============================================================
// Pure functions for manipulating the node/edge graph.
// No side effects, no persistence — just data transformations.
// The hub layer calls these, then persists the result.
// ============================================================

import type {
  Node, Edge, Project, NodeId, EdgeId, ProjectId,
  EntropyState, EntropyMetrics, EdgeType,
} from "./types";

// ------------------------------------------------------------
// Graph container (in-memory working state)
// ------------------------------------------------------------
export interface Graph {
  nodes: Map<NodeId, Node>;
  edges: Map<EdgeId, Edge>;
  projects: Map<ProjectId, Project>;
}

export function createGraph(): Graph {
  return {
    nodes: new Map(),
    edges: new Map(),
    projects: new Map(),
  };
}

// ------------------------------------------------------------
// Node operations
// ------------------------------------------------------------

export function addNode(graph: Graph, node: Node): Graph {
  const next = cloneGraph(graph);
  next.nodes.set(node.id, node);
  return next;
}

export function removeNode(graph: Graph, nodeId: NodeId): Graph {
  const next = cloneGraph(graph);
  next.nodes.delete(nodeId);
  // Remove all edges connected to this node
  for (const [edgeId, edge] of next.edges) {
    if (edge.sourceId === nodeId || edge.targetId === nodeId) {
      next.edges.delete(edgeId);
    }
  }
  // Remove from artifact groups
  for (const [, project] of next.projects) {
    project.artifactGroups = project.artifactGroups.map(ag => ({
      ...ag,
      versionIds: ag.versionIds.filter(id => id !== nodeId),
      currentVersionId: ag.currentVersionId === nodeId
        ? ag.versionIds.find(id => id !== nodeId) || ag.currentVersionId
        : ag.currentVersionId,
    }));
  }
  return next;
}

export function updateNode(graph: Graph, nodeId: NodeId, updates: Partial<Node>): Graph {
  const existing = graph.nodes.get(nodeId);
  if (!existing) return graph;
  const next = cloneGraph(graph);
  next.nodes.set(nodeId, { ...existing, ...updates });
  return next;
}

export function assignNodeToProject(
  graph: Graph,
  nodeId: NodeId,
  projectId: ProjectId
): Graph {
  const node = graph.nodes.get(nodeId);
  if (!node) return graph;
  const next = cloneGraph(graph);
  const newState: EntropyState = node.positions && Object.keys(node.positions).length > 0
    ? "organized"
    : "assigned";
  next.nodes.set(nodeId, {
    ...node,
    projectId,
    entropyState: newState,
    lastReviewedAt: Date.now(),
  });
  return next;
}

export function unassignNode(graph: Graph, nodeId: NodeId): Graph {
  const node = graph.nodes.get(nodeId);
  if (!node) return graph;
  const next = cloneGraph(graph);
  next.nodes.set(nodeId, {
    ...node,
    projectId: null,
    entropyState: "unassigned",
  });
  return next;
}

// ------------------------------------------------------------
// Edge operations
// ------------------------------------------------------------

export function addEdge(graph: Graph, edge: Edge): Graph {
  const next = cloneGraph(graph);
  next.edges.set(edge.id, edge);
  return next;
}

export function removeEdge(graph: Graph, edgeId: EdgeId): Graph {
  const next = cloneGraph(graph);
  next.edges.delete(edgeId);
  return next;
}

export function linkNodes(
  graph: Graph,
  sourceId: NodeId,
  targetId: NodeId,
  type: EdgeType,
  options: { weight?: number; label?: string; directed?: boolean } = {}
): Graph {
  const edgeId = `e_${sourceId}_${targetId}_${type}`;
  const edge: Edge = {
    id: edgeId,
    sourceId,
    targetId,
    type,
    weight: options.weight ?? 0.5,
    label: options.label,
    directed: options.directed ?? (type === "version" || type === "flow" || type === "dependency"),
    meta: {},
  };
  return addEdge(graph, edge);
}

// ------------------------------------------------------------
// Project operations
// ------------------------------------------------------------

export function addProject(graph: Graph, project: Project): Graph {
  const next = cloneGraph(graph);
  next.projects.set(project.id, project);
  return next;
}

export function removeProject(graph: Graph, projectId: ProjectId): Graph {
  const next = cloneGraph(graph);
  next.projects.delete(projectId);
  // Unassign all nodes from this project
  for (const [nodeId, node] of next.nodes) {
    if (node.projectId === projectId) {
      next.nodes.set(nodeId, { ...node, projectId: null, entropyState: "unassigned" });
    }
  }
  return next;
}

// ------------------------------------------------------------
// Query helpers
// ------------------------------------------------------------

/** Get all nodes belonging to a project */
export function getProjectNodes(graph: Graph, projectId: ProjectId): Node[] {
  const result: Node[] = [];
  for (const node of graph.nodes.values()) {
    if (node.projectId === projectId) result.push(node);
  }
  return result;
}

/** Get all edges connected to a node */
export function getNodeEdges(graph: Graph, nodeId: NodeId): Edge[] {
  const result: Edge[] = [];
  for (const edge of graph.edges.values()) {
    if (edge.sourceId === nodeId || edge.targetId === nodeId) result.push(edge);
  }
  return result;
}

/** Get edges between nodes within a project */
export function getProjectEdges(graph: Graph, projectId: ProjectId): Edge[] {
  const projectNodeIds = new Set(
    getProjectNodes(graph, projectId).map(n => n.id)
  );
  const result: Edge[] = [];
  for (const edge of graph.edges.values()) {
    if (projectNodeIds.has(edge.sourceId) && projectNodeIds.has(edge.targetId)) {
      result.push(edge);
    }
  }
  return result;
}

/** Get all unassigned nodes (for triage) */
export function getUnassignedNodes(graph: Graph): Node[] {
  const result: Node[] = [];
  for (const node of graph.nodes.values()) {
    if (node.projectId === null || node.entropyState === "unassigned") {
      result.push(node);
    }
  }
  return result;
}

/** Get stale nodes (not interacted with for N days) */
export function getStaleNodes(graph: Graph, staleDays: number = 30): Node[] {
  const threshold = Date.now() - staleDays * 86400000;
  const result: Node[] = [];
  for (const node of graph.nodes.values()) {
    if (node.lastUsedAt < threshold && node.entropyState !== "stale") {
      result.push(node);
    }
  }
  return result;
}

/** Get nodes connected to a given node by edge type */
export function getConnectedNodes(
  graph: Graph,
  nodeId: NodeId,
  edgeType?: EdgeType
): Node[] {
  const connectedIds = new Set<NodeId>();
  for (const edge of graph.edges.values()) {
    if (edgeType && edge.type !== edgeType) continue;
    if (edge.sourceId === nodeId) connectedIds.add(edge.targetId);
    if (edge.targetId === nodeId) connectedIds.add(edge.sourceId);
  }
  const result: Node[] = [];
  for (const id of connectedIds) {
    const node = graph.nodes.get(id);
    if (node) result.push(node);
  }
  return result;
}

// ------------------------------------------------------------
// Entropy computation
// ------------------------------------------------------------

/**
 * Compute the entropy metrics for the entire graph.
 * Score is 0 (fully organized) to 1 (total chaos).
 * 
 * Weights:
 *   unassigned = 1.0 (max entropy)
 *   stale      = 0.6 (needs attention)
 *   assigned   = 0.3 (in a project but not positioned)
 *   organized  = 0.0 (clean)
 */
export function computeEntropy(graph: Graph, staleDays: number = 30): EntropyMetrics {
  let total = 0, unassigned = 0, assigned = 0, organized = 0, stale = 0;
  const staleThreshold = Date.now() - staleDays * 86400000;

  for (const node of graph.nodes.values()) {
    total++;
    // Check staleness first (overrides other states)
    if (node.lastUsedAt < staleThreshold && node.entropyState === "organized") {
      stale++;
    } else {
      switch (node.entropyState) {
        case "unassigned": unassigned++; break;
        case "assigned": assigned++; break;
        case "organized": organized++; break;
        case "stale": stale++; break;
      }
    }
  }

  if (total === 0) {
    return { totalNodes: 0, unassigned: 0, assigned: 0, organized: 0, stale: 0, score: 0, needsTriage: false };
  }

  const score = (unassigned * 1.0 + stale * 0.6 + assigned * 0.3) / total;
  const TRIAGE_THRESHOLD = 0.3;

  return {
    totalNodes: total,
    unassigned,
    assigned,
    organized,
    stale,
    score: Math.min(1, score),
    needsTriage: score >= TRIAGE_THRESHOLD,
  };
}

// ------------------------------------------------------------
// Node position management
// ------------------------------------------------------------

/** Set a node's position for a specific layout strategy */
export function setNodePosition(
  graph: Graph,
  nodeId: NodeId,
  layoutName: string,
  x: number,
  y: number
): Graph {
  const node = graph.nodes.get(nodeId);
  if (!node) return graph;
  const next = cloneGraph(graph);
  const updatedNode = {
    ...node,
    positions: { ...node.positions, [layoutName]: { x, y } },
    entropyState: (node.entropyState === "assigned" ? "organized" : node.entropyState) as EntropyState,
  };
  next.nodes.set(nodeId, updatedNode);
  return next;
}

/** Bulk set positions (used by layout strategies) */
export function setNodePositions(
  graph: Graph,
  layoutName: string,
  positions: Record<NodeId, { x: number; y: number }>
): Graph {
  let next = graph;
  for (const [nodeId, pos] of Object.entries(positions)) {
    next = setNodePosition(next, nodeId, layoutName, pos.x, pos.y);
  }
  return next;
}

// ------------------------------------------------------------
// Utilities
// ------------------------------------------------------------

function cloneGraph(graph: Graph): Graph {
  return {
    nodes: new Map(graph.nodes),
    edges: new Map(graph.edges),
    projects: new Map(graph.projects),
  };
}
