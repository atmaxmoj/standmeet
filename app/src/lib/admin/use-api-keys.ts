// use-api-keys —— /admin/api-mcp 上**外发 API key** 那一块的状态机（F-K-1）。
//
// 跟隔壁 use-tokens 是两种东西，别混（[[two-mcp-surfaces]]）：
//   - use-tokens 管的是 **MCP keypair**（Ed25519，owner 自己的客户端拿去签名）
//   - 这里管的是 **外发 `smk_` key**（第三方程序拿去打 `/api/pub/v1`）
//
// 在它之前外发 key 只长在 owner-MCP 上，于是**一把泄露的 key 只有在 owner 装好并跑起一个
// MCP 客户端之后才吊销得掉**。止血的路不该要求先装工具。
//
// 明文只在铸出来那一次给一次（justCreated），之后列表里只剩 prefix —— 这一页不能变成一个
// 能薅 key 的地方。

import { useEffect, useState } from 'react';

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore, useResource } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';

const APIKeySchema = z.object({
  id: z.string(),
  label: z.string(),
  prefix: z.string(),
  status: z.string(),
  assumed_role_id: z.string(),
  rate_limit_rpm: z.number().nullable().optional(),
  last_used_at: z.string().optional(),
  created_at: z.string(),
});
export type APIKeyItem = z.infer<typeof APIKeySchema>;

// 铸出来那一次的形状：**secret 只有这里有**。
const CreatedAPIKeySchema = z.object({
  id: z.string(),
  prefix: z.string(),
  secret: z.string(),
});
export type CreatedAPIKey = z.infer<typeof CreatedAPIKeySchema>;

export interface APIKeysHook {
  status: ResourceStatus;
  keys: readonly APIKeyItem[];
  justCreated: CreatedAPIKey | null;
  error: string | null;
  createKey: (label: string, roleID: string) => Promise<void>;
  revokeKey: (id: string) => Promise<void>;
  dismissCreated: () => void;
}

const keysStore = createResourceStore<APIKeyItem[]>({
  name: 'api-keys',
  fetcher: () => adminAPI.get('/api-keys', z.array(APIKeySchema)),
});

// justCreated 是**组件本地**的一次性状态，不进 store。
//
// 这是有意的：离开这一页再回来，那把明文就该消失 —— 它只在铸出来那一刻给一次，
// 之后连产品自己都取不回。放进 store 会让它跨页面活着，而那正是"列表变成薅 key 的地方"。
export function useAPIKeys(): APIKeysHook {
  const res = useResource(keysStore);
  const [justCreated, setJustCreated] = useState<CreatedAPIKey | null>(null);
  // 首次挂载要真去拉一次 —— resource store 不会自己开始。少这一句的时候面板会渲染出来、
  // 标题也在，**只是列表永远空着**：一个"看起来好了"的形态。
  const { ensureLoaded } = res;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  return {
    status: res.status,
    keys: res.data ?? [],
    justCreated,
    error: res.error,
    createKey: async (label, roleID) => {
      const created = await adminAPI.post(
        '/api-keys', { label, assumed_role_id: roleID }, CreatedAPIKeySchema,
      );
      setJustCreated(created);
      await keysStore.getState().refresh();
    },
    revokeKey: async (id) => {
      await adminAPI.post(`/api-keys/${id}/revoke`, {}, z.unknown());
      await keysStore.getState().refresh();
    },
    dismissCreated: () => { setJustCreated(null); },
  };
}
