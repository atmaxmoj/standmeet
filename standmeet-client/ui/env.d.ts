/// <reference types="vite/client" />

interface StandMeetConfig {
  server: {
    url: string;
    token: string;
    web_url?: string;
  };
}

interface ContentEntry {
  id: string;
  path: string;
  content: Record<string, unknown>;
  summary: string;
  content_type: string;
  visibility: "private" | "public";
  created_at: string;
  updated_at: string;
}

interface ContentListItem {
  id: string;
  path: string;
  summary: string;
  content_type: string;
  visibility: "private" | "public";
  updated_at: string;
}

interface AssetListItem {
  id: string;
  path: string;
  filename: string;
  size: number;
  mime_type: string;
  visibility: "private" | "public";
  updated_at: string;
}

interface Asset {
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

interface PathPermission {
  action: "allow" | "deny";
  path_pattern: string;
  order?: number;
}

interface Role {
  id: string;
  name: string;
  permissions: PathPermission[];
  prompt: string;
  created_at: string;
}

interface McpServer {
  id: string;
  name: string;
  config: Record<string, unknown>;
  created_at: string;
}

interface Skill {
  id: string;
  name: string;
  description: string;
  prompt: string;
  is_builtin: boolean;
  created_at: string;
}

interface InviteCode {
  id: string;
  code: string;
  label: string;
  is_active: boolean;
  max_uses: number | null;
  use_count: number;
  expires_at: string | null;
  role_id: string | null;
  page_id: string | null;
  prompt: string;
  mcp_server_ids: string[];
  skill_ids: string[];
  created_at: string;
}

interface PageMeta {
  title: string;
  description: string;
  favicon_asset_path: string | null;
  og_image_asset_path: string | null;
  custom_head: string;
}

interface PageListItem {
  id: string;
  name: string;
  description: string;
  status: string;
  role_id: string | null;
  created_at: string;
  updated_at: string;
}

interface Page {
  id: string;
  name: string;
  description: string;
  status: string;
  source_files: Record<string, string>;
  must_use: string[];
  dont_use: string[];
  package_constraints: string;
  meta: PageMeta;
  build_log: string;
  role_id: string | null;
  created_at: string;
  updated_at: string;
}

interface GlobalPackage {
  name: string;
  version: string;
}

interface StorageUsage {
  used_bytes: number;
  total_bytes: number;
}

interface ChatLog {
  id: string;
  session_id: string;
  user_message: string;
  assistant_message: string;
  created_at: string;
}

interface SiteSettings {
  public_access: boolean;
  ai_system_prompt: string;
}

interface ServerStatus {
  version: string;
  content_count: number;
  active_invites: number;
  public_access: boolean;
  storage_used_bytes: number;
  storage_total_bytes: number;
}

interface NpmPackageInfo {
  name: string;
  version: string;
  description: string;
}

interface StandMeetAPI {
  config: {
    load: () => Promise<StandMeetConfig | null>;
    save: (config: StandMeetConfig) => Promise<boolean>;
    isConfigured: () => Promise<boolean>;
  };
  content: {
    list: (prefix?: string) => Promise<ContentListItem[]>;
    read: (path: string) => Promise<ContentEntry>;
    create: (
      path: string,
      content: Record<string, unknown>,
      summary?: string,
      visibility?: "private" | "public",
    ) => Promise<ContentEntry>;
    update: (
      path: string,
      content: Record<string, unknown>,
      summary?: string,
      visibility?: "private" | "public",
    ) => Promise<ContentEntry>;
    delete: (path: string) => Promise<void>;
  };
  role: {
    create: (name: string, permissions: PathPermission[]) => Promise<Role>;
    list: () => Promise<Role[]>;
    get: (id: string) => Promise<Role>;
    update: (
      id: string,
      data: { name?: string; permissions?: PathPermission[] },
    ) => Promise<Role>;
    delete: (id: string) => Promise<void>;
  };
  invite: {
    create: (params: {
      label: string;
      role_id?: string;
      max_uses?: number;
      expires_in_hours?: number;
      prompt?: string;
      mcp_server_ids?: string[];
      skill_ids?: string[];
    }) => Promise<InviteCode>;
    list: () => Promise<InviteCode[]>;
    update: (code: string, data: { role_id?: string | null; prompt?: string; mcp_server_ids?: string[]; skill_ids?: string[] }) => Promise<InviteCode>;
    revoke: (code: string) => Promise<InviteCode>;
    delete: (code: string) => Promise<void>;
    chatLogs: (code: string) => Promise<{ logs: ChatLog[]; summaries: Record<string, string> }>;
    deleteChatLog: (code: string, logId: string) => Promise<void>;
    clearChatLogs: (code: string) => Promise<void>;
    saveSummary: (code: string, sessionId: string, summary: string) => Promise<void>;
  };
  mcpServer: {
    create: (name: string, config: Record<string, unknown>) => Promise<McpServer>;
    list: () => Promise<McpServer[]>;
    get: (id: string) => Promise<McpServer>;
    update: (id: string, data: { name?: string; config?: Record<string, unknown> }) => Promise<McpServer>;
    delete: (id: string) => Promise<void>;
  };
  skill: {
    create: (name: string, description: string, prompt: string) => Promise<Skill>;
    list: () => Promise<Skill[]>;
    get: (id: string) => Promise<Skill>;
    update: (id: string, data: { name?: string; description?: string; prompt?: string }) => Promise<Skill>;
    delete: (id: string) => Promise<void>;
    importUrl: (url: string) => Promise<Skill>;
  };
  asset: {
    list: (prefix?: string) => Promise<AssetListItem[]>;
    get: (path: string) => Promise<Asset>;
    upload: (assetPath: string, visibility?: string) => Promise<Asset | null>;
    uploadDirect: (filePath: string, assetPath: string, visibility?: string) => Promise<Asset>;
    updateVisibility: (path: string, visibility: string) => Promise<Asset>;
    delete: (path: string) => Promise<void>;
  };
  settings: {
    get: () => Promise<SiteSettings>;
    update: (settings: Partial<SiteSettings>) => Promise<SiteSettings>;
  };
  status: {
    get: () => Promise<ServerStatus>;
  };
  page: {
    list: () => Promise<PageListItem[]>;
    get: (id: string) => Promise<Page>;
    create: (data: {
      name: string;
      description?: string;
      source_files?: Record<string, string>;
      must_use?: string[];
      dont_use?: string[];
      package_constraints?: string;
      meta?: Partial<PageMeta>;
      role_id?: string | null;
    }) => Promise<Page>;
    update: (id: string, data: Partial<{
      name: string;
      description: string;
      source_files: Record<string, string>;
      must_use: string[];
      dont_use: string[];
      package_constraints: string;
      meta: Partial<PageMeta>;
      role_id: string | null;
    }>) => Promise<Page>;
    delete: (id: string) => Promise<void>;
    build: (id: string) => Promise<{ status: string; id: string }>;
    buildLog: (id: string) => Promise<{ build_log: string; status: string }>;
    activate: (id: string) => Promise<{ activated: string }>;
  };
  storage: {
    usage: () => Promise<StorageUsage>;
  };
  package: {
    list: () => Promise<GlobalPackage[]>;
    install: (name: string) => Promise<GlobalPackage>;
    uninstall: (name: string) => Promise<void>;
  };
  data: {
    exportToFile: () => Promise<string | null>;
    exportCategoryToFile: (category: string) => Promise<string | null>;
    importCategoryFromFile: (category: string) => Promise<import("../src/types").CategoryResult | null>;
    loadImportFile: () => Promise<{
      manifest: import("../src/types").ExportManifest;
      hasAssets: boolean;
      zipPath: string;
    } | null>;
    executeImport: (
      filePath: string,
      selected: import("../src/types").ImportSelection,
    ) => Promise<import("../src/types").ImportResult>;
    exportDirect: () => Promise<{
      manifest: import("../src/types").ExportManifest;
      json: string;
    }>;
    importDirect: (
      json: string,
      selected: import("../src/types").ImportSelection,
    ) => Promise<import("../src/types").ImportResult>;
    exportCategoryDirect: (category: string) => Promise<unknown>;
    importCategoryDirect: (category: string, data: unknown) => Promise<import("../src/types").CategoryResult>;
    saveJsonToFile: (data: unknown, defaultName: string) => Promise<string | null>;
  };
  npm: {
    search(query: string): Promise<NpmPackageInfo[]>;
    readme(name: string): Promise<{ readme: string; description: string; homepage: string } | null>;
  };
  mcp: {
    connectClaudeCode: () => Promise<string>;
    connectClaudeDesktop: () => Promise<string>;
    checkClaudeCode: () => Promise<{ path: string; stale: boolean } | null>;
    checkClaudeDesktop: () => Promise<{ path: string; stale: boolean } | null>;
  };
  getFilePath: (file: File) => string;
  onMenuNew: (callback: () => void) => () => void;
}

declare global {
  interface Window {
    standmeet: StandMeetAPI;
  }
}

export {};
