// use-connector-catalog —— the built-in connector catalog (manifests
// assembled in from outside). GET /api/admin/connectors/catalog → connectable
// built-in cards (google-calendar / smtp / …). Kept separate from
// use-connector-list (owner-created): built-ins don't go into List (List's
// reuse-by-category callers would otherwise pick up built-ins by mistake).

import { z } from 'zod';

import { useLatestList } from '@/lib/admin/use-latest-list';

// OwnerOpFieldSchema / OwnerOpSchema —— the owner operations a connector
// declares in its own manifest; the backend has already derived its
// input_schema into flat fields (see connector.OwnerOp.Fields). The frontend
// doesn't parse JSON Schema: what an action looks like is decided by the
// **declaration**, and this just renders it as given.
const OwnerOpFieldSchema = z.object({
  key: z.string(),
  description: z.string().nullish(),
  // type —— the scalar type from the declaration. The control is chosen by
  // it, and the value is sent back by it too: send a string for a numeric
  // field, and the op's own schema fails to unmarshal at the very first step (F-C-17).
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
  // title —— the vendor name carried by an uploaded connector (F-C-56). Built-in entries in the catalog don't have this: their name is just the category.
  title: z.string().nullish(),
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
