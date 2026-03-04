// ============================================================
// Portal Frontend — Hub API Client
// ============================================================

const HUB = '/api';

export async function fetchProjects(): Promise<any[] | null> {
  try { return (await (await fetch(`${HUB}/projects`)).json()).projects || []; }
  catch { return null; }
}

export async function fetchProjectChildren(projectId: string): Promise<any[]> {
  try { return (await (await fetch(`${HUB}/projects/${projectId}`)).json()).children || []; }
  catch { return []; }
}

export async function fetchNodeChildren(nodeId: string): Promise<any[]> {
  try { return (await (await fetch(`${HUB}/nodes/${nodeId}/children`)).json()).children || []; }
  catch { return []; }
}

export async function fetchSettings(): Promise<Record<string, string>> {
  try { return (await (await fetch(`${HUB}/settings`)).json()).settings || {}; }
  catch { return {}; }
}

export async function updateSetting(key: string, value: string): Promise<void> {
  try {
    await fetch(`${HUB}/settings/${key}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
  } catch (e) { console.error('Setting update failed:', e); }
}

export async function openFile(nodeId: string): Promise<{ ok?: boolean; error?: string }> {
  try {
    return await (await fetch(`${HUB}/open`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeId }),
    })).json();
  } catch (e) { console.error('Open failed:', e); return { error: String(e) }; }
}

export async function togglePin(nodeId: string): Promise<{ ok?: boolean; pinned?: boolean }> {
  try {
    return await (await fetch(`${HUB}/nodes/${nodeId}/pin`, { method: 'PUT' })).json();
  } catch (e) { console.error('Pin toggle failed:', e); return {}; }
}

// ── Content Previews ─────────────────────────────────────────

export interface TextPreview {
  lines: string[];
  ext: string;
  total: number;
}

export async function fetchTextPreview(nodeId: string, lines = 15): Promise<TextPreview | null> {
  try {
    const res = await fetch(`${HUB}/nodes/${nodeId}/preview?lines=${lines}`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

export function getThumbnailUrl(nodeId: string): string {
  return `${HUB}/nodes/${nodeId}/thumbnail`;
}

// ── Position Persistence ────────────────────────────────────

export async function saveNodePosition(nodeId: string, x: number, y: number): Promise<void> {
  try {
    await fetch(`${HUB}/positions/workspace`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ positions: [{ node_id: nodeId, x, y }] }),
    });
  } catch (e) { console.error('Position save failed:', e); }
}

export async function fetchPositions(layout: string): Promise<Array<{ node_id: string; x: number; y: number }>> {
  try {
    return (await (await fetch(`${HUB}/positions/${layout}`)).json()).positions || [];
  } catch { return []; }
}

// ── Node Move (re-parent) ───────────────────────────────────

export async function moveNode(nodeId: string, projectId?: string | null, parentId?: string | null): Promise<{ ok?: boolean }> {
  try {
    return await (await fetch(`${HUB}/nodes/${nodeId}/move`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, parentId }),
    })).json();
  } catch (e) { console.error('Move failed:', e); return {}; }
}

// ── Workspace Notes ─────────────────────────────────────

import type { WorkspaceNote, WorkspaceEdge } from './types';

export async function fetchWorkspaceNotes(projectId: string): Promise<WorkspaceNote[]> {
  try {
    const res = await (await fetch(`${HUB}/workspaces/${projectId}/notes`)).json();
    return (res.notes || []).map((n: any) => ({
      id: n.id, projectId: n.project_id, content: n.content,
      x: n.x, y: n.y, width: n.width, height: n.height,
      color: n.color, zOrder: n.z_order,
    }));
  } catch { return []; }
}

export async function createNote(projectId: string, x: number, y: number, content = '', color = '#FFF8DC'): Promise<WorkspaceNote | null> {
  try {
    const res = await (await fetch(`${HUB}/workspaces/${projectId}/notes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, x, y, color }),
    })).json();
    const n = res.note;
    return n ? { id: n.id, projectId: n.project_id, content: n.content,
      x: n.x, y: n.y, width: n.width, height: n.height,
      color: n.color, zOrder: n.z_order } : null;
  } catch { return null; }
}

export async function updateNote(noteId: string, patch: Partial<{ content: string; x: number; y: number; width: number; height: number; color: string; z_order: number }>): Promise<void> {
  try {
    await fetch(`${HUB}/workspaces/notes/${noteId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
  } catch (e) { console.error('Note update failed:', e); }
}

export async function deleteNote(noteId: string): Promise<void> {
  try {
    await fetch(`${HUB}/workspaces/notes/${noteId}`, { method: 'DELETE' });
  } catch (e) { console.error('Note delete failed:', e); }
}

// ── Workspace Edges ─────────────────────────────────────

export async function fetchWorkspaceEdges(projectId: string): Promise<WorkspaceEdge[]> {
  try {
    const res = await (await fetch(`${HUB}/workspaces/${projectId}/edges`)).json();
    return (res.edges || []).map((e: any) => {
      const meta = JSON.parse(e.meta || '{}');
      return {
        id: e.id, sourceId: e.source_id, targetId: e.target_id,
        type: e.type, label: meta.label, meta,
      };
    });
  } catch { return []; }
}

export async function createEdge(projectId: string, sourceId: string, targetId: string, label?: string): Promise<WorkspaceEdge | null> {
  try {
    const res = await (await fetch(`${HUB}/workspaces/${projectId}/edges`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_id: sourceId, target_id: targetId, label }),
    })).json();
    const e = res.edge;
    if (!e) return null;
    const meta = JSON.parse(e.meta || '{}');
    return { id: e.id, sourceId: e.source_id, targetId: e.target_id,
      type: e.type, label: meta.label, meta };
  } catch { return null; }
}

export async function deleteEdge(edgeId: string): Promise<void> {
  try {
    await fetch(`${HUB}/workspaces/edges/${edgeId}`, { method: 'DELETE' });
  } catch (e) { console.error('Edge delete failed:', e); }
}

export async function updateEdge(edgeId: string, label?: string): Promise<void> {
  try {
    await fetch(`${HUB}/workspaces/edges/${edgeId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label }),
    });
  } catch (e) { console.error('Edge update failed:', e); }
}
