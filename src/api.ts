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
