// app-state.ts —— MCP App 跨刷新状态的访客客户端。卡（ui:// 沙箱）经 host 对**自己 mcp
// 那一格**读/写；mcp_id 由后端从 tool 派生（卡碰不到别的 mcp）。状态是增强（跨刷新存
// 活），失败一律静默成空/false —— 不该因状态 I/O 让卡崩。

import { baseURL } from '@/lib/api/public';

function isRecordValue(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

// appStateURL —— /sessions/{conv}/app-state/{tool}[/{key}]。mcp_id 后端从 tool 派生。
function appStateURL(conversationID: string, tool: string, key?: string): string {
  const base = `${baseURL()}/api/v1/sessions/${conversationID}/app-state/${encodeURIComponent(tool)}`;
  return key === undefined ? base : `${base}/${encodeURIComponent(key)}`;
}

// getAppCardState —— 读该 tool 所属 mcp 那格的 {key:value}。
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

// setAppCardState —— 写一格（mcp_id 由后端从 tool 派生，卡碰不到别的 mcp）。
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
