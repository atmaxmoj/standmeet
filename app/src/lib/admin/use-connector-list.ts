// use-connector-list —— owner 已配的连接器列表（上传 openapi + 协议）。GET /api/admin/connectors
// → 行（按 connector_id）。create（上传 spec+binding 原文）/ remove(id) / refresh。origin 由 id
// 前缀判定（CreateUploaded/CreateProtocol 都用 "up-" → uploaded；否则内置）。catalog 预览那张
// （use-connectors 的 SEED）是另一回事，不动。

import { useCallback } from 'react';
import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { useLatestList } from '@/lib/admin/use-latest-list';

const ConnectorRowSchema = z.object({
  id: z.string(),
  category: z.string(),
  kind: z.string(),
  connected: z.boolean(),
  has_credentials: z.boolean().nullish(),
  active: z.boolean().nullish(),
});
const ListSchema = z.object({ connectors: z.array(ConnectorRowSchema).nullish() });
const CreatedSchema = z.object({ id: z.string() });

export type ConnectorRow = z.infer<typeof ConnectorRowSchema>;

// UploadInput —— 装配一个 openapi 连接器要送的东西。
//
// baseUrl —— spec 没写 servers 时 owner 手填的（F-C-22）。authScheme —— spec 没声明认证时
// owner 选的 manual 方案；不带它的话，后端派生凭据表单时在三个候选里挑不出唯一一个，
// 连接器建出来却填不了凭据。
export interface UploadInput {
  specText: string;
  // specUrl —— spec 从 URL 抓来时的来源；面板手上没有正文，由后端按它再抓一次（F-C-25）。
  specUrl?: string;
  bindingText: string;
  baseUrl?: string;
  authScheme?: string;
  // exposeAsAgentTools —— owner **明确勾选**「把这份 spec 的接口开给访客的 AI」。
  // 设计源写明这条路是 opt-in（`docs/design/connector.md` §3）：它把厂商文档里的**每一个**
  // operation 变成访客 AI 能调的工具（Cal.com v2 是 211 条），是一次对外授权，不是排版选项。
  // 一度我按「没写 binding 就自动打开」来推断 owner 的意思 —— 那是替 owner 点头。
  exposeAsAgentTools?: boolean;
}

export interface ConnectorListHook {
  connectors: readonly ConnectorRow[];
  loaded: boolean;
  loadError: boolean;
  refresh: () => void;
  create: (input: UploadInput) => Promise<string>;
  remove: (id: string) => Promise<void>;
}

// originOf —— owner 自建（上传/协议）连接器 id 以 "up-" 起头；其余是内置。
export function originOf(row: ConnectorRow): 'uploaded' | 'built-in' {
  return row.id.startsWith('up-') ? 'uploaded' : 'built-in';
}

export function useConnectorList(): ConnectorListHook {
  const {
    items: connectors, loaded, loadError, refresh,
  } = useLatestList<ConnectorRow>('/connectors', ListSchema);

  // create —— 建一个 openapi 连接器,**返回它的 id**。以前这里是 postVoid,把回执扔了 ——
  // 于是「建完之后把 owner 填的 token 存进这个连接器」根本无从下手(同 [[write-with-no-receipt]])。
  //
  // expose_as_agent_tools 原样透传 owner 的勾选,**不从 binding 空不空去推断**。
  const create = useCallback(async (input: UploadInput): Promise<string> => {
    const r = await adminAPI.post('/connectors', {
      kind: 'openapi',
      spec_text: input.specText,
      url: input.specUrl ?? '',
      binding_text: input.bindingText,
      base_url: input.baseUrl ?? '',
      auth_scheme: input.authScheme ?? '',
      expose_as_agent_tools: input.exposeAsAgentTools ?? false,
    }, CreatedSchema);
    refresh();
    return r.id;
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    await adminAPI.deleteVoid(`/connectors/${id}`);
    refresh();
  }, [refresh]);

  return { connectors, loaded, loadError, refresh, create, remove };
}
