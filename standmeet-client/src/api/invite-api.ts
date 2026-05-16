import { apiRequest } from "./client.js";
import type { ChatLog, InviteCode } from "../types.js";

export async function createInvite(params: {
  label: string;
  prompt?: string;
  greeting?: string;
  role_id?: string | null;
  max_uses?: number;
  max_messages_per_session?: number;
  expires_in_hours?: number;
  mcp_server_ids?: string[];
  skill_ids?: string[];
}): Promise<InviteCode> {
  return apiRequest<InviteCode>("/api/invites/", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function listInvites(): Promise<InviteCode[]> {
  return apiRequest<InviteCode[]>("/api/invites/");
}

export async function revokeInvite(code: string): Promise<InviteCode> {
  return apiRequest<InviteCode>(`/api/invites/${code}/`, {
    method: "PATCH",
    body: JSON.stringify({ is_active: false }),
  });
}

export async function updateInvite(
  code: string,
  data: { label?: string; role_id?: string | null; prompt?: string; greeting?: string; max_uses?: number | null; max_messages_per_session?: number | null; mcp_server_ids?: string[]; skill_ids?: string[] },
): Promise<InviteCode> {
  return apiRequest<InviteCode>(`/api/invites/${code}/`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteInvite(code: string): Promise<void> {
  return apiRequest<void>(`/api/invites/${code}/`, {
    method: "DELETE",
  });
}

export async function listChatLogs(code: string): Promise<{ logs: ChatLog[]; summaries: Record<string, string> }> {
  const raw = await apiRequest<ChatLog[] | { logs: ChatLog[]; summaries: Record<string, string> }>(`/api/invites/${code}/chats/`);
  // Backward compat: old API returns plain array, new API returns {logs, summaries}
  if (Array.isArray(raw)) {
    return { logs: raw, summaries: {} };
  }
  return raw;
}

export async function deleteChatLog(
  code: string,
  logId: string,
): Promise<void> {
  return apiRequest<void>(`/api/invites/${code}/chats/${logId}/`, {
    method: "DELETE",
  });
}

export async function clearChatLogs(code: string): Promise<void> {
  return apiRequest<void>(`/api/invites/${code}/chats/`, {
    method: "DELETE",
  });
}

export async function saveChatSessionSummary(
  code: string,
  sessionId: string,
  summary: string,
): Promise<void> {
  return apiRequest<void>(`/api/invites/${code}/chats/summary/${sessionId}/`, {
    method: "PUT",
    body: JSON.stringify({ summary }),
  });
}
