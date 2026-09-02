// use-tokens —— the /admin/api-mcp state machine.
//
// The Phase C backend has switched to Ed25519 keypairs
// (POST/GET/DELETE /api/admin/keypairs). This hook fetches /keypairs
// internally and maps it into the old TokenItem shape for the upstream UI, so
// components like ApiSection / TokenRow / NewlyCreatedBanner don't need to
// change (the semantics get swapped out when C-2 redoes the UI). The
// "plaintext" field carries the full PEM (multi-line); the UI displays it as opaque text.
//
// zustand refactor: the list cache goes through tokensStore
// (createResourceStore); justCreated is a one-time banner, kept in its own
// store field (so the banner doesn't remount on every mount).

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

// TokenItem —— the UI shape. id ← key_id; name ← label; other fields match keypair.
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

// justCreated is transient UI state (a one-time banner), not part of the resource shape.
// Uses module-level state + a tiny subscription to stay consistent with the zustand style.
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

// Throws (no longer swallowed): the success path reveals the private key; on
// failure the caller reports it and the form is kept (don't lose the label the owner just typed).
async function createToken(name: string): Promise<void> {
  const kp = await adminAPI.post('/keypairs', { label: name }, CreatedKeypairSchema);
  const created = toCreatedToken(kp);
  tokensStore.getState().mutate((prev) => [toListItem(created), ...(prev ?? [])]);
  justCreatedStore.getState().set(created);
}

async function deleteToken(id: string): Promise<void> {
  // The id field maps to keypair.key_id; DELETE uses the key_id path. Throws → the caller finishes up via useAction.
  await adminAPI.deleteVoid(`/keypairs/${id}`);
  tokensStore.getState().mutate((prev) => (prev ?? []).filter((t) => t.id !== id));
}

function toCreatedToken(k: CreatedKeypair): CreatedToken {
  return { id: k.key_id, name: k.label, plaintext: k.private_key_pem, created_at: k.created_at };
}

function toListItem(c: CreatedToken): TokenItem {
  return { id: c.id, name: c.name, created_at: c.created_at, last_used_at: null };
}

// MCP client snippet helpers —— Phase C switches to keypairs. The client
// doesn't embed the private key directly; it goes through a creds JSON file
// + the STANDMEET_CREDS_PATH env var (same shape as @youteacher/mcp).
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
