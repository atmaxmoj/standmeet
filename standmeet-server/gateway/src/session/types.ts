import type WebSocket from "ws";

export type PathPermission = {
  action: "allow" | "deny";
  path_pattern: string;
  order?: number;
};

export type CustomMcpServer = {
  name: string;
  config: Record<string, unknown>;
};

type SkillScript = {
  filename: string;
  language: string;
  content: string;
  description: string;
  parameters: Array<{
    name: string;
    type?: string;
    required?: boolean;
    description?: string;
  }>;
};

export type Skill = {
  name: string;
  description: string;
  prompt: string;
  scripts?: SkillScript[];
};

export type SessionInitData = {
  invite: {
    code: string;
    label: string;
    is_valid: boolean;
    max_messages_per_session: number | null;
    greeting: string;
    page_id: string | null;
  };
  role: {
    name: string;
    prompt: string;
    permissions: PathPermission[];
  } | null;
  global_prompt: string;
  invite_prompt: string;
  mcp_servers: CustomMcpServer[];
  skills: Skill[];
};

export type ChatHistoryEntry = {
  role: "user" | "assistant";
  content: string;
  sources?: string[];
};

export type SkillToolServer = {
  name: string;
  server: unknown; // SDK MCP server instance
};

export type GatewaySession = {
  sessionId: string;
  sdkSessionId: string | null;
  inviteCode: string;
  systemPrompt: string;
  permissions: PathPermission[];
  customMcpServers: CustomMcpServer[];
  skillToolServers: SkillToolServer[];
  createdAt: number;
  lastTouchedAt: number;
  abortController: AbortController | null;
  activeQueryId: string | null;
  maxMessagesPerSession: number | null;
  wsConnections: Set<WebSocket>;
  messages: ChatHistoryEntry[];
  /** Cumulative list of paths accessed via read_content (persists across turns for SDK resume) */
  readSources: string[];
  /** Session is ended after report generation — no more messages allowed */
  ended: boolean;
};
