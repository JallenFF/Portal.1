// ============================================================
// Triage Interface (Phase 2 AI layer)
// ============================================================
// Defines the contract for automated organization suggestions.
// Phase 1: manual triage via UI.
// Phase 2: AI reads patterns and suggests placements.
//
// The triage system never acts autonomously. It produces
// suggestions that the user accepts/rejects/defers.
// ============================================================

import type { NodeId, ProjectId, EntropyMetrics } from "../core/src/types";

// ------------------------------------------------------------
// Suggestion types
// ------------------------------------------------------------

export interface TriageSuggestion {
  id: string;
  type: TriageSuggestionType;
  nodeId: NodeId;
  confidence: number;         // 0-1
  reasoning: string;          // human-readable explanation
  
  // For "assign" suggestions
  suggestedProjectId?: ProjectId;
  
  // For "link" suggestions
  suggestedLinkTargetId?: NodeId;
  suggestedLinkType?: string;
  
  // For "archive" suggestions
  staleDays?: number;
}

export type TriageSuggestionType =
  | "assign_to_project"       // unassigned file → suggested project
  | "create_project"          // cluster of unassigned files → new project
  | "link_versions"           // two files look like versions of same artifact
  | "link_reference"          // file A references file B
  | "archive"                 // stale file → suggest archival
  | "merge_projects"          // two projects overlap significantly
  | "split_project";          // one project is too large/diverse

export type TriageDecision = "accept" | "reject" | "defer";

// ------------------------------------------------------------
// Triage Engine Interface
// ------------------------------------------------------------

/**
 * Any triage engine (local heuristics or AI-powered) must
 * implement this interface.
 */
export interface TriageEngine {
  /**
   * Generate suggestions for unorganized/stale nodes.
   * Called when entropy meter triggers or user requests.
   */
  generateSuggestions(
    entropy: EntropyMetrics,
    context: TriageContext,
  ): Promise<TriageSuggestion[]>;
  
  /**
   * Record user's decision for learning (Phase 2).
   */
  recordDecision(
    suggestionId: string,
    decision: TriageDecision,
  ): void;
}

export interface TriageContext {
  /** All node IDs needing triage */
  pendingNodeIds: NodeId[];
  
  /** Existing project names/IDs for assignment suggestions */
  existingProjects: Array<{ id: ProjectId; name: string; tags: string[] }>;
  
  /** Recent assignment patterns (for AI learning) */
  recentDecisions: Array<{
    nodeId: NodeId;
    decision: TriageDecision;
    suggestedProjectId?: ProjectId;
    actualProjectId?: ProjectId;
  }>;
}

// ------------------------------------------------------------
// Phase 1: Local Heuristics Engine (stub)
// ------------------------------------------------------------

/**
 * Simple heuristic triage — no AI, just pattern matching.
 * 
 * Rules:
 *   - Files with same extension as existing project items → suggest that project
 *   - Files with similar names → suggest version link
 *   - Files untouched for 30+ days → suggest archive
 */
export class LocalTriageEngine implements TriageEngine {
  async generateSuggestions(
    _entropy: EntropyMetrics,
    _context: TriageContext,
  ): Promise<TriageSuggestion[]> {
    // Phase 1: return empty. Manual triage only.
    // Phase 2: implement heuristic matching here.
    return [];
  }
  
  recordDecision(
    _suggestionId: string,
    _decision: TriageDecision,
  ): void {
    // Phase 1: no-op.
    // Phase 2: store in event log for pattern learning.
  }
}
