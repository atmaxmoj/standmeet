// use-connector-catalog —— 内置连接器目录（外置装配进来的 manifest）。GET /api/admin/connectors/
// catalog → 可连接的内置卡（google-calendar / smtp / …）。跟 use-connector-list（owner 已建）分开：
// 内置不进 List（List 的 reuse-by-category 调用方会误抓内置）。

import { z } from 'zod';

import { useLatestList } from '@/lib/admin/use-latest-list';

// OwnerOpFieldSchema / OwnerOpSchema —— 连接器自己在 manifest 里声明的 owner 操作,
// 后端已把它的 input_schema 派生成扁平字段(见 connector.OwnerOp.Fields)。前端不解
// JSON Schema:一个动作长什么样是**声明**说了算,这里照着渲。
const OwnerOpFieldSchema = z.object({
  key: z.string(),
  description: z.string().nullish(),
  // type —— 声明里的标量类型。控件按它选,值也按它送回去:数字字段送字符串的话,
  // op 自己的 schema 第一步 unmarshal 就失败(F-C-17)。
  type: z.string().nullish(),
  required: z.boolean().nullish(),
});
const OwnerOpSchema = z.object({
  name: z.string(),
  description: z.string().nullish(),
  fields: z.array(OwnerOpFieldSchema).nullish(),
});

const CatalogEntrySchema = z.object({
  id: z.string(),
  category: z.string(),
  kind: z.string(),
  auth_scheme: z.string().nullish(),
  owner_ops: z.array(OwnerOpSchema).nullish(),
});

export type OwnerOp = z.infer<typeof OwnerOpSchema>;
export type OwnerOpField = z.infer<typeof OwnerOpFieldSchema>;
const CatalogSchema = z.object({ connectors: z.array(CatalogEntrySchema).nullish() });

export type CatalogEntry = z.infer<typeof CatalogEntrySchema>;

export interface ConnectorCatalogHook {
  entries: readonly CatalogEntry[];
  loaded: boolean;
  loadError: boolean;
  refresh: () => void;
}

export function useConnectorCatalog(): ConnectorCatalogHook {
  const { items: entries, loaded, loadError, refresh } = useLatestList<CatalogEntry>(
    '/connectors/catalog', CatalogSchema,
  );
  return { entries, loaded, loadError, refresh };
}
