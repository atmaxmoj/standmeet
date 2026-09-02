// use-connector-upload —— #155 area G upload orchestration: paste a spec
// (+optional binding) to assemble an openapi connector. A name clash (one
// already exists for the same category) → confirm overwrite first; confirm →
// delete old, create new (overwrite, not stacked). Category is extracted
// from the binding text (regex, no YAML parser run on the frontend). Logic lives here, presentation only renders.
//
// **Assembly is three steps, not one** (F-C-21): create the connector → get
// its id → store the credentials the owner filled into the same form under
// that id. Skip the third step and the token field has nowhere to go — invisible in the UI.

import { useCallback, useState } from 'react';

import { adminAPI } from '@/lib/api/admin';
import type { ConnectorListHook } from '@/lib/admin/use-connector-list';
import { useReportError } from '@/lib/ui/use-report-error';

// AssembleInput —— everything collected for one assembly attempt. All three
// fields besides spec can be empty: when the owner has a spec with full
// declarations, binding / baseUrl / authScheme don't need to be filled in.
export interface AssembleInput {
  spec: string;
  // url —— the source when the spec was fetched from a URL. The body only
  // ever existed during that one backend fetch; assembly relies on this to fetch it again (F-C-25).
  url: string;
  binding: string;
  baseUrl: string;
  authScheme: string;
  exposeAsAgentTools: boolean;
  credentials: Record<string, string>;
  // scopes —— the oauth2 scopes checked. Stored alongside the credentials; miss it and the authorize redirect is missing scopes.
  scopes: string[];
}

// isAssemblable —— **can anyone actually use** what gets assembled. Either
// path holds on its own:
//   binding → fills a category slot, the unified cap uses it;
//   exposeAsAgentTools → endpoints exposed directly to the visitor's AI (owner explicitly checked it, opt-in per design source §3).
// Neither → what gets created is inert, nothing can call it. The rule lives
// here, not in the component: this is assembly semantics, not a layout judgment on some surface.
export function isAssemblable(input: AssembleInput): boolean {
  return input.binding.trim() !== '' || input.exposeAsAgentTools;
}

// ASSEMBLE_FAILED —— the fallback message to the owner when assembly doesn't succeed. If the backend gave a human sentence, that one is used instead.
const ASSEMBLE_FAILED = 'The connector could not be assembled. Check the spec and try again.';

// failureText —— translates an exception into a sentence that can sit in the modal.
function failureText(err: unknown): string {
  return err instanceof Error && err.message !== '' ? err.message : ASSEMBLE_FAILED;
}

// AssembleState —— the result of one assembly attempt, **bundled into one thing to pass down**.
// Splitting id and error into two props would mean threading them through 4
// files, 6 places; adding a third field and missing one of those spots
// wouldn't error, it would just quietly display less — exactly the [[move-the-capability-move-its-edges]] class.
export interface AssembleState {
  id: string | null;
  error: string;
}

interface Pending { input: AssembleInput; category: string }

export interface ConnectorUploadHook {
  pending: Pending | null;
  // createdID —— the id of the connector that was just assembled. Assembly
  // isn't the end of it for the owner: credentials still need filling in and
  // Connect still needs clicking, and both of those have always been
  // ConnectorCard's responsibility. Without this id the owner would land on
  // a list row that **can't be connected to** (ConnectorList's row only has
  // category/status/delete, no Connect) — exactly the F-C-21 shape of "positive feedback the whole way, no exit at the end".
  createdID: string | null;
  // resetCreated —— clears "the one just assembled". **Reopening "add
  // connector" must be a clean slate**: without this, the ingest form would
  // keep yielding to last time's card, and the spec input would never
  // reappear (no way to install a second connector). createdID belongs to one modal session, not to this page.
  resetCreated: () => void;
  // state —— the assembled id + the failure sentence. **A failure must land
  // in the modal**: relying only on a page-level toast fails, because the
  // modal covers the whole page and the owner sees nothing — that's exactly how F-C-26 happened.
  state: AssembleState;
  upload: (input: AssembleInput) => void;
  confirmOverwrite: () => void;
  cancelOverwrite: () => void;
}

// bindingCategory —— extracts category from the binding YAML text (`category: calendar`).
function bindingCategory(binding: string): string {
  return binding.match(/^\s*category:\s*["']?([\w.-]+)/m)?.[1] ?? '';
}

// hasValue —— only saves when at least one non-empty credential field was
// filled in. POSTing while everything is empty would write "nothing filled
// in" as if it were a real save, and afterward the owner would see "configured" when it's actually empty.
function hasValue(creds: Record<string, string>): boolean {
  return Object.values(creds).some((v) => v.trim() !== '');
}

export function useConnectorUpload(list: ConnectorListHook): ConnectorUploadHook {
  const [pending, setPending] = useState<Pending | null>(null);
  const [createdID, setCreatedID] = useState<string | null>(null);
  const [error, setError] = useState('');
  const report = useReportError();

  // assemble —— creates + stores credentials. A failure at any step gets
  // reported: assembly failing with the UI staying silent is the worst outcome on this surface.
  const assemble = useCallback(async (input: AssembleInput) => {
    const id = await list.create({
      specText: input.spec, specUrl: input.url,
      bindingText: input.binding,
      baseUrl: input.baseUrl, authScheme: input.authScheme,
      exposeAsAgentTools: input.exposeAsAgentTools,
    });
    setCreatedID(id);
    // The body is a **flat** field-name → value map + scopes (same shape as
    // use-connector-card's saveCreds; that's the only battle-tested writer
    // on this path, and a shape mismatch would silently store credentials as empty).
    if (hasValue(input.credentials)) {
      await adminAPI.postVoid(`/connectors/${id}/credentials`, {
        ...input.credentials, scopes: input.scopes,
      });
    }
    list.refresh();
  }, [list]);

  // fail —— a failure takes **two paths**: the sentence in the modal (the
  // owner is currently looking at the modal) + a page-level toast (keeping
  // the original behavior). Toast alone would leave the owner unable to see
  // anything, since the modal covers the whole page — exactly F-C-26.
  const fail = useCallback((err: unknown) => {
    setError(failureText(err));
    report(err);
  }, [report]);

  const upload = useCallback((input: AssembleInput) => {
    setError(''); // A new attempt first clears the previous failure, or the old message would still hang there after it's fixed
    const category = bindingCategory(input.binding);
    const exists = category !== '' && list.connectors.some((c) => c.category === category);
    exists
      ? setPending({ input, category })
      : void assemble(input).catch(fail);
  }, [assemble, list.connectors, fail]);

  const confirmOverwrite = useCallback(() => {
    const p = pending;
    const old = p === null ? undefined : list.connectors.find((c) => c.category === p.category);
    void (old === undefined ? Promise.resolve() : list.remove(old.id))
      .then(() => (p === null ? undefined : assemble(p.input)))
      .catch(fail) // A failure at either delete-old or create-new step → reflected both in the modal + toast (the owner must know the overwrite didn't take effect).
      .finally(() => setPending(null)); // The confirmation is dismissed either way: failure shouldn't leave the dialog stuck.
  }, [pending, list, assemble, fail]);

  const cancelOverwrite = useCallback(() => setPending(null), []);

  // resetCreated —— clears the slate when "add connector" is opened again: neither the previous id nor the previous failure should carry into the next round.
  const resetCreated = useCallback(() => { setCreatedID(null); setError(''); }, []);

  return {
    pending, createdID, resetCreated,
    state: { id: createdID, error },
    upload, confirmOverwrite, cancelOverwrite,
  };
}
