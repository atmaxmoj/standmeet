// connector-registry —— admin connectors 加新种类的 plugin 数组。
//
// 设计源 docs/design/project/admin-data.js CONNECTOR_REGISTRY (304-364)。
// 加新 connector 的工作量 = append 一条 entry 进 CONNECTOR_REGISTRY；
// ConnectorAddModal + ConnectorConfigForm 会自动渲染。GCal booking
// (memory:gcal-booking-future) 之后 = 给 calendar entry 加 oauth flow，
// 不动 component 代码。

export interface ConnectorField {
  k: string;
  label: string;
  options?: readonly string[]; // 选择器（select / chip 渲染）
  secret?: boolean;            // password input 隐藏内容
  oauth?: boolean;             // 跳转 "Authorize…" 而非 input
  default?: string;
}

export interface ConnectorCategory {
  id: string;
  label: string;
  blurb: string;
}

export interface ConnectorEntry {
  id: string;
  name: string;
  icon: string; // unicode glyph
  category: string;
  blurb: string;
  fields: readonly ConnectorField[];
  builtin?: boolean; // 内置，不能删
  docs_url?: string;
  // protocol connector (#155 kind=protocol)：选它走「建 protocol 连接器 + 存固定凭据 + 连接测试」，
  // protocolCategory = 它填的品类槽（mail/calendar）。openapi/catalog 条目不设这俩。
  protocol?: string;
  protocolCategory?: string;
  // assemble (#155)：归一装配入口（品类卡）→ AssembleView（OpenAPI 上传 或 内置协议表单）。
  assemble?: boolean;
  assembleCategory?: string;
}

export const CONNECTOR_CATEGORIES: readonly ConnectorCategory[] = [
  { id: 'comms',     label: 'communication',      blurb: 'inbox, scheduling, voice' },
  { id: 'capture',   label: 'capture',            blurb: 'where thinking lands' },
  { id: 'identity',  label: 'identity & social',  blurb: 'verified-by accounts' },
  { id: 'storage',   label: 'storage & backup',   blurb: 'where the corpus archives to' },
  { id: 'analytics', label: 'analytics & growth', blurb: 'know who is reading' },
];

export const CONNECTOR_REGISTRY: readonly ConnectorEntry[] = [
  // ── comms ──────────────────────────────────────────────────────────
  {
    id: 'email', name: 'Email', icon: '✉', category: 'comms',
    blurb: 'visitors can ping you when they hit a private redaction.',
    fields: [
      { k: 'smtp_host', label: 'SMTP host' },
      { k: 'smtp_user', label: 'SMTP user' },
      { k: 'smtp_pass', label: 'SMTP password', secret: true },
    ],
  },
  {
    // SMTP protocol connector (#155 §8-E): kind=protocol, fixed credential form (NOT spec-derived).
    id: 'smtp', name: 'SMTP', icon: '✉', category: 'comms', builtin: true,
    protocol: 'smtp', protocolCategory: 'mail',
    blurb: 'send mail through any SMTP server (the mail category, protocol kind).',
    fields: [
      { k: 'host', label: 'Host' },
      { k: 'port', label: 'Port', default: '587' },
      { k: 'username', label: 'Username' },
      { k: 'password', label: 'Password', secret: true },
      { k: 'from', label: 'From address' },
      { k: 'tls', label: 'TLS', options: ['none', 'starttls', 'tls'], default: 'starttls' },
    ],
  },
  {
    // 归一装配入口（#155）：calendar 品类 → AssembleView（贴 OpenAPI spec 装配 per-SaaS，或填内置
    // CalDAV 协议表单）。不再是写死 provider 下拉（那是 legacy，已删）。
    id: 'calendar', name: 'Calendar', icon: '◫', category: 'comms', assemble: true,
    assembleCategory: 'calendar',
    blurb: 'offers booking slots when a conversation gets serious.',
    fields: [],
  },
  {
    // mail 品类 → AssembleView（OpenAPI mail SaaS 或内置 SMTP）。
    id: 'mail', name: 'Mail', icon: '✉', category: 'comms', assemble: true,
    assembleCategory: 'mail',
    blurb: 'sends confirmations and follow-ups in the owner’s name.',
    fields: [],
  },
  {
    id: 'discord', name: 'Discord DM', icon: '⌬', category: 'comms',
    blurb: 'mirror access requests to a DM. one-way, owner-only.',
    fields: [{ k: 'webhook', label: 'Webhook URL', secret: true }],
  },
  {
    id: 'twilio', name: 'Twilio SMS', icon: '☎', category: 'comms',
    blurb: 'sms when someone hits a high-trust topic + replies allowed.',
    fields: [
      { k: 'sid', label: 'Account SID' },
      { k: 'token', label: 'Auth token', secret: true },
      { k: 'from', label: 'From number' },
    ],
  },

  // ── capture ────────────────────────────────────────────────────────
  {
    id: 'mcp', name: 'MCP push', icon: '◈', category: 'capture',
    blurb: 'where claude/chatgpt/cursor send dumps. token-scoped.',
    fields: [{ k: 'token_scope', label: 'Default token scope', options: ['read+write', 'write only'] }],
    builtin: true,
  },
  {
    id: 'obsidian', name: 'Obsidian', icon: '◆', category: 'capture',
    blurb: 'two-way sync with a local vault. plugin required.',
    fields: [
      { k: 'vault_path', label: 'Vault path' },
      { k: 'mode', label: 'Mode', options: ['two-way', 'push only', 'pull only'] },
    ],
    builtin: true,
  },
  {
    id: 'notion', name: 'Notion', icon: '▢', category: 'capture',
    blurb: 'import pages / databases as wiki entries.',
    fields: [
      { k: 'integration_token', label: 'Notion integration token', secret: true },
      { k: 'database_id', label: 'Database ID' },
    ],
  },
  {
    id: 'readwise', name: 'Readwise', icon: '➤', category: 'capture',
    blurb: 'pull highlights from articles, books, tweets.',
    fields: [{ k: 'access_token', label: 'Readwise API token', secret: true }],
  },
  {
    id: 'gmail', name: 'Gmail · drafts label', icon: '✦', category: 'capture',
    blurb: 'auto-import emails you tagged "standmeet" as raw entries.',
    fields: [
      { k: 'oauth', label: 'Authorize…', oauth: true },
      { k: 'label', label: 'Label to watch', default: 'standmeet' },
    ],
  },

  // ── identity ───────────────────────────────────────────────────────
  {
    id: 'github', name: 'GitHub', icon: '⎔', category: 'identity',
    blurb: 'pulls README + project descriptions; proves identity.',
    fields: [
      { k: 'username', label: 'Username' },
      { k: 'oauth', label: 'Authorize…', oauth: true },
    ],
    builtin: true,
  },
  {
    id: 'linkedin', name: 'LinkedIn', icon: '⏍', category: 'identity',
    blurb: 'proof-of-employment fetch + name-match check.',
    fields: [{ k: 'oauth', label: 'Authorize…', oauth: true }],
  },
  {
    id: 'twitter', name: 'X / Twitter', icon: '𝕏', category: 'identity',
    blurb: 'verified handle + pulls pinned thread as a public wiki entry.',
    fields: [
      { k: 'handle', label: 'Handle (@…)' },
      { k: 'oauth', label: 'Authorize…', oauth: true },
    ],
  },
  {
    id: 'orcid', name: 'ORCID', icon: '◉', category: 'identity',
    blurb: 'for researchers · verify ORCID iD + publications list.',
    fields: [{ k: 'orcid_id', label: 'ORCID iD' }],
  },

  // ── storage ────────────────────────────────────────────────────────
  {
    id: 's3', name: 'S3 / R2', icon: '☷', category: 'storage',
    blurb: 'daily corpus backup to your own bucket.',
    fields: [
      { k: 'endpoint', label: 'Endpoint' },
      { k: 'bucket', label: 'Bucket' },
      { k: 'access_key', label: 'Access key', secret: true },
      { k: 'secret_key', label: 'Secret key', secret: true },
    ],
  },
  {
    id: 'gdrive', name: 'Google Drive', icon: '△', category: 'storage',
    blurb: 'snapshot to a designated drive folder.',
    fields: [
      { k: 'oauth', label: 'Authorize…', oauth: true },
      { k: 'folder', label: 'Folder name', default: 'standmeet-backups' },
    ],
  },

  // ── analytics ──────────────────────────────────────────────────────
  {
    id: 'plausible', name: 'Plausible', icon: '◯', category: 'analytics',
    blurb: 'cookie-free pageviews + custom events for the public site.',
    fields: [
      { k: 'domain', label: 'Domain' },
      { k: 'api_key', label: 'Plausible API key (optional)', secret: true },
    ],
  },
  {
    id: 'umami', name: 'Umami', icon: '◐', category: 'analytics',
    blurb: 'self-hosted analytics. point at your umami instance.',
    fields: [
      { k: 'endpoint', label: 'Endpoint URL' },
      { k: 'site_id', label: 'Site ID' },
    ],
  },
  {
    id: 'webhook', name: 'Generic webhook', icon: '⚭', category: 'analytics',
    blurb: 'POST every chat-conversation event to a URL you control.',
    fields: [
      { k: 'endpoint', label: 'POST URL' },
      { k: 'secret', label: 'Signing secret (optional)', secret: true },
      { k: 'events', label: 'Events',
        options: ['all', 'private-hits only', 'sent applications only'] },
    ],
  },
];

// connectorsByCategory —— 渲 modal 按 category tab 分组用。
export function connectorsByCategory(category: string): ConnectorEntry[] {
  return CONNECTOR_REGISTRY.filter((c) => c.category === category);
}

// installedCount —— ConnectorsSection 头标 "N installed / M catalog"。
export function catalogSize(): number {
  return CONNECTOR_REGISTRY.length;
}
