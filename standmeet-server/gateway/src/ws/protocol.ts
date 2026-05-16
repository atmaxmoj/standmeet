import type { ChatHistoryEntry } from "../session/types.js";

// Client → Gateway
type ClientMessage =
  | { type: "auth"; invite_code: string; session_id?: string }
  | { type: "auth"; owner_token: string; preview_mode: "invitation"; invite_code: string }
  | { type: "auth"; owner_token: string; preview_mode: "public" }
  | { type: "message"; content: string }
  | { type: "context"; content: string; author?: string }
  | { type: "cancel" }
  | { type: "fetch_content"; path: string }
  | { type: "generate_report" };

// Gateway → Client
export type ServerMessage =
  | { type: "auth_ok"; label: string; session_id: string; page_id?: string | null; history?: ChatHistoryEntry[]; capabilities?: { canGenerateReport: boolean }; messageLimit?: number | null; messageCount?: number; sessionEnded?: boolean }
  | { type: "auth_error"; error: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_use"; tool: string; status: "start" | "done"; args?: Record<string, unknown> }
  | { type: "message_done"; content: string; sources?: string[] }
  | { type: "content_data"; path: string; title: string; content: string; content_type: string }
  | { type: "content_error"; path: string; error: string }
  | { type: "report_generating" }
  | { type: "report_ready"; summary: string }
  | { type: "report_error"; message: string }
  | { type: "session_ended" }
  | { type: "error"; error: string };

export function parseClientMessage(data: string): ClientMessage | null {
  try {
    const msg = JSON.parse(data);
    if (!msg || typeof msg.type !== "string") return null;
    return msg as ClientMessage;
  } catch {
    return null;
  }
}
