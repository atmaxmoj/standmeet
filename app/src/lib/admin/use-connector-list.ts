// use-connector-list —— owner 已配的连接器列表（上传 openapi + 协议）。GET /api/admin/connectors
// → 行（按 connector_id）。create（上传 spec+binding 原文）/ remove(id) / refresh。origin 由 id
// 前缀判定（CreateUploaded/CreateProtocol 都用 "up-" → uploaded；否则内置）。catalog 预览那张
// （use-connectors 的 SEED）是另一回事，不动。

import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';

const ConnectorRowSchema = z.object({
  id: z.string(),
  category: z.string(),
  kind: z.string(),
  connected: z.boolean(),
  has_credentials: z.boolean().nullish(),
  active: z.boolean().nullish(),
});
const ListSchema = z.object({ connectors: z.array(ConnectorRowSchema).nullish() });

export type ConnectorRow = z.infer<typeof ConnectorRowSchema>;

export interface UploadInput { specText: string; bindingText: string }

export interface ConnectorListHook {
  connectors: readonly ConnectorRow[];
  loaded: boolean;
  refresh: () => void;
  create: (input: UploadInput) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

// originOf —— owner 自建（上传/协议）连接器 id 以 "up-" 起头；其余是内置。
export function originOf(row: ConnectorRow): 'uploaded' | 'built-in' {
  return row.id.startsWith('up-') ? 'uploaded' : 'built-in';
}

export function useConnectorList(): ConnectorListHook {
  const [connectors, setConnectors] = useState<ConnectorRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(() => {
    void adminAPI.get('/connectors', ListSchema)
      .then((r) => { setConnectors(r.connectors ?? []); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const create = useCallback(async (input: UploadInput) => {
    await adminAPI.postVoid('/connectors', {
      kind: 'openapi', spec_text: input.specText, binding_text: input.bindingText,
    });
    refresh();
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    await adminAPI.deleteVoid(`/connectors/${id}`);
    refresh();
  }, [refresh]);

  return { connectors, loaded, refresh, create, remove };
}
