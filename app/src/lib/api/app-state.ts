// app-state.ts —— visitor client for MCP App state that survives refresh. A card
// (ui:// sandbox) reads/writes **its own mcp's slot** through the host; mcp_id is
// derived by the backend from the tool (a card can't touch another mcp's slot).
// State is a nice-to-have (survives refresh); any failure silently degrades to
// empty/false — a card must never crash over state I/O.

import { baseURL } from '@/lib/api/public';

function isRecordValue(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

// appStateURL —— /sessions/{conv}/app-state/{tool}[/{key}]. mcp_id is derived by
// the backend from the tool.
function appStateURL(conversationID: string, tool: string, key?: string): string {
  const base = `${baseURL()}/api/v1/sessions/${conversationID}/app-state/${encodeURIComponent(tool)}`;
  return key === undefined ? base : `${base}/${encodeURIComponent(key)}`;
}

// getAppCardState —— reads the {key:value} slot of the mcp this tool belongs to.
export async function getAppCardState(
  conversationID: string, sessionToken: string, tool: string,
): Promise<Record<string, unknown>> {
  if (conversationID === '' || sessionToken === '' || tool === '') return {};
  try {
    const res = await fetch(appStateURL(conversationID, tool), {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    if (!res.ok) return {};
    const body: unknown = await res.json();
    return isRecordValue(body) && isRecordValue(body['state']) ? body['state'] : {};
  } catch {
    return {};
  }
}

// setAppCardState —— writes one slot (mcp_id is derived by the backend from the
// tool; a card can't touch another mcp's slot).
export async function setAppCardState(
  conversationID: string, sessionToken: string, tool: string, key: string, value: unknown,
): Promise<boolean> {
  if (conversationID === '' || sessionToken === '' || tool === '' || key === '') return false;
  try {
    const res = await fetch(appStateURL(conversationID, tool, key), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({ value }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
