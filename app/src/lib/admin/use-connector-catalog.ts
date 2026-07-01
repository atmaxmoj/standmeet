// use-connector-catalog —— 内置连接器目录（外置装配进来的 manifest）。GET /api/admin/connectors/
// catalog → 可连接的内置卡（google-calendar / smtp / …）。跟 use-connector-list（owner 已建）分开：
// 内置不进 List（List 的 reuse-by-category 调用方会误抓内置）。

import { z } from 'zod';

import { useLatestList } from '@/lib/admin/use-latest-list';

const CatalogEntrySchema = z.object({
  id: z.string(),
  category: z.string(),
  kind: z.string(),
  auth_scheme: z.string().nullish(),
});
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
