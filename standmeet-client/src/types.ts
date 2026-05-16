export interface ContentEntry {
  id: string;
  path: string;
  content: Record<string, unknown>;
  summary: string;
  content_type: string;
  visibility: "private" | "public";
  show_as_source: boolean;
  created_at: string;
  updated_at: string;
}

export interface ContentListItem {
  id: string;
  path: string;
  summary: string;
  content_type: string;
  visibility: "private" | "public";
  show_as_source: boolean;
  updated_at: string;
}

export interface Asset {
  id: string;
  path: string;
  filename: string;
  size: number;
  mime_type: string;
  visibility: "private" | "public";
  download_url?: string;
  created_at: string;
  updated_at: string;
}

export interface AssetListItem {
  id: string;
  path: string;
  filename: string;
  size: number;
  mime_type: string;
  visibility: "private" | "public";
  updated_at: string;
}

export interface PathPermission {
  action: "allow" | "deny";
  path_pattern: string;
  order?: number;
}

export interface Role {
  id: string;
  name: string;
  permissions: PathPermission[];
  prompt: string;
  created_at: string;
}

export interface McpServer {
  id: string;
  name: string;
  config: Record<string, unknown>;
  created_at: string;
}

export interface SkillScript {
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
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  prompt: string;
  is_builtin: boolean;
  skill_md_raw: string;
  source: "manual" | "import" | "marketplace";
  version: string;
  license: string;
  compatibility: string;
  metadata: Record<string, unknown>;
  allowed_tools: string[];
  scripts: SkillScript[];
  marketplace_id: string;
  marketplace_name: string;
  source_url: string;
  installed_version: string;
  latest_known_version: string;
  last_checked_at: string | null;
  created_at: string;
}

export interface InviteCode {
  id: string;
  code: string;
  label: string;
  is_active: boolean;
  max_uses: number | null;
  max_messages_per_session: number | null;
  use_count: number;
  expires_at: string | null;
  role_id: string | null;
  prompt: string;
  greeting: string;
  mcp_server_ids: string[];
  skill_ids: string[];
  created_at: string;
}

export interface ChatLog {
  id: string;
  session_id: string;
  user_message: string;
  assistant_message: string;
  created_at: string;
}

export interface ImIntegrationConfig {
  enabled: boolean;
  bot_token?: string;
  application_id?: string;  // Discord only
  app_token?: string;       // Slack only
  bot_username?: string;    // Telegram: cached from getMe
}

export interface ImIntegrations {
  telegram?: ImIntegrationConfig;
  discord?: ImIntegrationConfig;
  slack?: ImIntegrationConfig;
}

export interface SiteSettings {
  public_access: boolean;
  ai_system_prompt: string;
  im_integrations: ImIntegrations;
}

export interface ServerStatus {
  version: string;
  content_count: number;
  active_invites: number;
  public_access: boolean;
}

// --- Data Import/Export ---

export interface ExportContentEntry {
  path: string;
  content: Record<string, unknown>;
  summary: string;
  visibility: "private" | "public";
  show_as_source: boolean;
}

export interface ExportSkill {
  name: string;
  description: string;
  prompt: string;
  skill_md_raw: string;
  scripts: SkillScript[];
}

export interface ExportMcpServer {
  name: string;
  config: Record<string, unknown>;
}

export interface ExportRole {
  name: string;
  permissions: PathPermission[];
  prompt: string;
}

export interface ExportInvite {
  label: string;
  role_name: string | null;
  prompt: string;
  greeting: string;
  max_uses: number | null;
  max_messages_per_session: number | null;
  mcp_server_names: string[];
  skill_names: string[];
}

export interface ExportSettings {
  public_access: boolean;
  ai_system_prompt: string;
}

export interface ExportAsset {
  path: string;
  visibility: "private" | "public";
}

export interface ExportManifest {
  version: number;
  exported_at: string;
  content: ExportContentEntry[];
  skills: ExportSkill[];
  mcp_servers: ExportMcpServer[];
  roles: ExportRole[];
  invites: ExportInvite[];
  settings: ExportSettings;
  assets: ExportAsset[];
}

export interface ImportSelection {
  content: boolean;
  skills: boolean;
  mcp_servers: boolean;
  roles: boolean;
  invites: boolean;
  settings: boolean;
  assets: boolean;
}

export interface CategoryResult {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
}

export interface ImportResult {
  content: CategoryResult;
  skills: CategoryResult;
  mcp_servers: CategoryResult;
  roles: CategoryResult;
  invites: CategoryResult;
  settings: CategoryResult;
  assets: CategoryResult;
}

interface ImportPreview {
  manifest: ExportManifest;
  hasAssets: boolean;
  zipPath: string;
}
