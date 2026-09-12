// use-supplier-list —— the list of suppliers the owner has configured
// (uploaded openapi + protocol). GET /api/admin/suppliers → rows (keyed by
// block id). create (uploads the spec+binding text) / remove(id) /
// refresh. origin is decided by the id prefix (CreateUploaded/CreateProtocol
// both use "up-" → uploaded; otherwise built-in).

import { useCallback } from 'react';
import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { useLatestList } from '@/lib/admin/use-latest-list';

const SupplierRowSchema = z.object({
  id: z.string(),
  seam: z.string(),
  kind: z.string(),
  // title —— the name the vendor gave this API themselves. A supplier bound
  // to a seam contract doesn't need it (the name is just the seam);
  // for one that isn't bound, seam is an empty string — this is its only name (F-C-56).
  title: z.string().nullish(),
  connected: z.boolean(),
  has_credentials: z.boolean().nullish(),
  active: z.boolean().nullish(),
});
const ListSchema = z.object({ suppliers: z.array(SupplierRowSchema).nullish() });
const CreatedSchema = z.object({ id: z.string() });

export type SupplierRow = z.infer<typeof SupplierRowSchema>;

// UploadInput —— what's sent to assemble one openapi supplier.
//
// baseUrl —— filled in by hand by the owner when the spec has no servers
// entry (F-C-22). authScheme —— the manual scheme the owner picks when the
// spec declares no auth; without it, the backend deriving the credentials
// form can't pick a unique one among three candidates, and the supplier gets created with no way to fill in credentials.
export interface UploadInput {
  specText: string;
  // specUrl —— the source when the spec was fetched from a URL; the panel
  // has no body on hand, and the backend refetches by this (F-C-25).
  specUrl?: string;
  bindingText: string;
  baseUrl?: string;
  authScheme?: string;
  // exposeAsAgentTools —— the owner **explicitly checked** "expose this
  // spec's endpoints to the visitor's AI". The design source states this
  // path is opt-in: it turns **every** operation in the vendor's docs into a
  // tool the visitor AI can call (Cal.com v2 has 211), which is a grant of
  // external access, not a formatting option. At one point I inferred the
  // owner's intent as "auto-on when binding isn't written" — that was nodding
  // on the owner's behalf.
  exposeAsAgentTools?: boolean;
}

export interface SupplierListHook {
  suppliers: readonly SupplierRow[];
  loaded: boolean;
  loadError: boolean;
  refresh: () => void;
  create: (input: UploadInput) => Promise<string>;
  remove: (id: string) => Promise<void>;
}

// originOf —— an owner-created (uploaded/protocol) supplier's id starts with "up-"; everything else is built-in.
export function originOf(row: SupplierRow): 'uploaded' | 'built-in' {
  return row.id.startsWith('up-') ? 'uploaded' : 'built-in';
}

export function useSupplierList(): SupplierListHook {
  const {
    items: suppliers, loaded, loadError, refresh,
  } = useLatestList<SupplierRow>('/suppliers', ListSchema);

  // create —— creates an openapi supplier, **returns its id**. This used to
  // be postVoid, discarding the receipt — leaving "store the token the owner
  // typed into this supplier after it's created" with no way to proceed (same as [[write-with-no-receipt]]).
  //
  // expose_as_agent_tools is passed through exactly as the owner checked it, **never inferred from whether binding is empty**.
  const create = useCallback(async (input: UploadInput): Promise<string> => {
    const r = await adminAPI.post('/suppliers', {
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
    await adminAPI.deleteVoid(`/suppliers/${id}`);
    refresh();
  }, [refresh]);

  return { suppliers, loaded, loadError, refresh, create, remove };
}
