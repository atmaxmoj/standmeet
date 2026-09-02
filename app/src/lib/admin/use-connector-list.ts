// use-connector-list —— the list of connectors the owner has configured
// (uploaded openapi + protocol). GET /api/admin/connectors → rows (keyed by
// connector_id). create (uploads the spec+binding text) / remove(id) /
// refresh. origin is decided by the id prefix (CreateUploaded/CreateProtocol
// both use "up-" → uploaded; otherwise built-in). The catalog preview card
// (use-connectors's SEED) is a separate thing, left untouched.

import { useCallback } from 'react';
import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { useLatestList } from '@/lib/admin/use-latest-list';

const ConnectorRowSchema = z.object({
  id: z.string(),
  category: z.string(),
  kind: z.string(),
  // title —— the name the vendor gave this API themselves. A connector bound
  // to a category contract doesn't need it (the name is just the category);
  // for one that isn't bound, category is an empty string — this is its only name (F-C-56).
  title: z.string().nullish(),
  connected: z.boolean(),
  has_credentials: z.boolean().nullish(),
  active: z.boolean().nullish(),
});
const ListSchema = z.object({ connectors: z.array(ConnectorRowSchema).nullish() });
const CreatedSchema = z.object({ id: z.string() });

export type ConnectorRow = z.infer<typeof ConnectorRowSchema>;

// UploadInput —— what's sent to assemble one openapi connector.
//
// baseUrl —— filled in by hand by the owner when the spec has no servers
// entry (F-C-22). authScheme —— the manual scheme the owner picks when the
// spec declares no auth; without it, the backend deriving the credentials
// form can't pick a unique one among three candidates, and the connector gets created with no way to fill in credentials.
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
  // path is opt-in (`docs/design/connector.md` §3): it turns **every**
  // operation in the vendor's docs into a tool the visitor AI can call
  // (Cal.com v2 has 211), which is a grant of external access, not a
  // formatting option. At one point I inferred the owner's intent as "auto-on
  // when binding isn't written" — that was nodding on the owner's behalf.
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

// originOf —— an owner-created (uploaded/protocol) connector's id starts with "up-"; everything else is built-in.
export function originOf(row: ConnectorRow): 'uploaded' | 'built-in' {
  return row.id.startsWith('up-') ? 'uploaded' : 'built-in';
}

export function useConnectorList(): ConnectorListHook {
  const {
    items: connectors, loaded, loadError, refresh,
  } = useLatestList<ConnectorRow>('/connectors', ListSchema);

  // create —— creates an openapi connector, **returns its id**. This used to
  // be postVoid, discarding the receipt — leaving "store the token the owner
  // typed into this connector after it's created" with no way to proceed (same as [[write-with-no-receipt]]).
  //
  // expose_as_agent_tools is passed through exactly as the owner checked it, **never inferred from whether binding is empty**.
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
