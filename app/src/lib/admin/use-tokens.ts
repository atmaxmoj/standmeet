// use-tokens —— /admin/api-mcp 的状态机。
//
// Phase C 后端已切到 Ed25519 keypair (POST/GET/DELETE /api/admin/keypairs)。
// 本 hook 内部 fetch /keypairs，按老 TokenItem 形态映射给上游 UI 用，让
// ApiSection / TokenRow / NewlyCreatedBanner 等组件不动 (C-2 重做 UI 时
// 再换语义)。"plaintext" 字段承载完整 PEM (多行)，UI 当 opaque 文本展示。
//
// zustand 重构：list cache 走 tokensStore (createResourceStore)；justCreated
// 是一次性 banner，放独立 store 字段（不要每次 mount 重 mount banner）。

import { useEffect } from 'react';

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore, useResource } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';

// keypair wire (server response shape)
const KeypairListItemSchema = z.object({
  key_id: z.string(),
  label: z.string(),
  created_at: z.string(),
  last_used_at: z.string().nullable(),
});
type KeypairListItem = z.infer<typeof KeypairListItemSchema>;

const CreatedKeypairSchema = z.object({
  key_id: z.string(),
  label: z.string(),
  private_key_pem: z.string(),
  created_at: z.string(),
});
type CreatedKeypair = z.infer<typeof CreatedKeypairSchema>;

// TokenItem —— UI 形态。id ← key_id；name ← label；其他字段同 keypair。
export interface TokenItem {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

interface CreatedToken {
  id: string;
  name: string;
  plaintext: string;
  created_at: string;
}

export interface TokensHook {
  status: ResourceStatus;
  tokens: readonly TokenItem[];
  justCreated: CreatedToken | null;
  error: string | null;
  createToken: (name: string) => Promise<void>;
  deleteToken: (id: string) => Promise<void>;
  dismissCreated: () => void;
}

interface TokensExtra {
  justCreated: CreatedToken | null;
}

export const tokensStore = createResourceStore<TokenItem[]>({
  name: 'tokens',
  fetcher: async () => {
    const rows = await adminAPI.get('/keypairs', z.array(KeypairListItemSchema));
    return rows.map(toTokenItemFromList);
  },
});

function toTokenItemFromList(k: KeypairListItem): TokenItem {
  return {
    id: k.key_id, name: k.label,
    created_at: k.created_at, last_used_at: k.last_used_at,
  };
}

// justCreated 是 UI 临时状态（一次性 banner），不属 resource shape。
// 用 module-level state + tiny subscription 跟 zustand 风格保持一致。
import { create } from 'zustand';

const justCreatedStore = create<TokensExtra & { set: (c: CreatedToken | null) => void }>(
  (set) => ({ justCreated: null, set: (c) => set({ justCreated: c }) }),
);

export function useTokens(): TokensHook {
  const r = useResource(tokensStore);
  const justCreated = justCreatedStore((s) => s.justCreated);
  const ensureLoaded = r.ensureLoaded;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  return {
    status: r.status,
    tokens: r.data ?? [],
    error: r.error,
    justCreated,
    createToken,
    deleteToken,
    dismissCreated: () => justCreatedStore.getState().set(null),
  };
}

// 抛错（不再吞）：成功路径 reveal 私钥；失败让 caller report 且保留表单（别丢 owner 刚填的 label）。
async function createToken(name: string): Promise<void> {
  const kp = await adminAPI.post('/keypairs', { label: name }, CreatedKeypairSchema);
  const created = toCreatedToken(kp);
  tokensStore.getState().mutate((prev) => [toListItem(created), ...(prev ?? [])]);
  justCreatedStore.getState().set(created);
}

async function deleteToken(id: string): Promise<void> {
  // id 字段映射的是 keypair.key_id，DELETE 走 key_id path。抛错 → caller 走 useAction 收尾。
  await adminAPI.deleteVoid(`/keypairs/${id}`);
  tokensStore.getState().mutate((prev) => (prev ?? []).filter((t) => t.id !== id));
}

function toCreatedToken(k: CreatedKeypair): CreatedToken {
  return { id: k.key_id, name: k.label, plaintext: k.private_key_pem, created_at: k.created_at };
}

function toListItem(c: CreatedToken): TokenItem {
  return { id: c.id, name: c.name, created_at: c.created_at, last_used_at: null };
}

// MCP client snippet helpers —— Phase C 切 keypair。客户端不直接 embed
// 私钥；走 creds JSON 文件 + STANDMEET_CREDS_PATH env var (跟 @youteacher
// /mcp 同形态)。
export interface MCPClient {
  id: 'claude-desktop' | 'cursor' | 'creds-template';
  label: string;
  path: string;
  snippet: (host: string) => string;
}

const credsPath = '~/.standmeet/credentials.json';

export const MCP_CLIENTS: readonly MCPClient[] = [
  {
    id: 'claude-desktop',
    label: 'Claude Desktop',
    path: '~/Library/Application Support/Claude/claude_desktop_config.json',
    snippet: (host) => `{
  "mcpServers": {
    "standmeet": {
      "command": "npx",
      "args": ["-y", "@standmeet/mcp-client@latest"],
      "env": {
        "STANDMEET_HOST": "${host}",
        "STANDMEET_CREDS_PATH": "${credsPath}"
      }
    }
  }
}`,
  },
  {
    id: 'cursor',
    label: 'Cursor',
    path: '~/.cursor/mcp.json',
    snippet: (host) => `{
  "standmeet": {
    "command": "npx",
    "args": ["-y", "@standmeet/mcp-client@latest"],
    "env": {
      "STANDMEET_HOST": "${host}",
      "STANDMEET_CREDS_PATH": "${credsPath}"
    }
  }
}`,
  },
  {
    id: 'creds-template',
    label: 'credentials.json',
    path: credsPath,
    snippet: (_host) => `{
  "keyId": "<paste keyId from the modal above>",
  "privateKeyPem": "-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n"
}`,
  },
];
