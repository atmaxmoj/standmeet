// use-gate —— the state machine for /gate.
//
// Three submit paths:
//   - code: POST /api/v1/sessions {mode:'code', code} → get session_token →
//     redirect / (the chat instance reuses the cookie/session on mount)
//   - byoai: POST /api/v1/sessions {mode:'byoai', byoai_provider} (the
//     server only needs the provider; endpoint+model travel in the chat
//     header) → once the session comes back, the BYOAI
//     {provider,endpoint,model,key} bundle goes into the browser vault
//     (lib/gate/byoai-vault.ts) → redirect /
//   - request: POST /api/v1/access-requests (no handle field — v1 is
//     single-owner)
//
// All client-side hooks; the business logic all lives here. Components
// only render.

import { useCallback, useState } from 'react';
import { VISITOR_SESSION_STORAGE_KEY } from '@standmeet/sdk-core';

import {
  issueBYOAISession,
  issueCodeSession,
  type PublicSessionResponse,
} from '@/lib/api/public';
import { storeBYOAI } from '@/lib/gate/byoai-vault';
import { useVisitorSessionStore } from '@/lib/visitor/session-store';
import { rememberVisitorName } from '@/lib/visitor/visitor-name';

// The key name comes from the SDK: the agent on a custom page needs to
// **take over** this already-issued session (the page is a rendering of
// this code), and it reads this same key. If each side wrote the literal
// separately, changing one would silently disconnect the other.
const BYOAI_STORAGE_KEY = VISITOR_SESSION_STORAGE_KEY;

import { z } from 'zod';

import { safeJsonString } from '@/lib/api/typed-json';

// Cap state + tool spec also persisted (was missing before — D-5 pivot
// regression where reuseStored returned partial state without capabilities,
// pi-agent saw current()=[] and sent tools:[] to /inference/stream,
// breaking all visitor tool calls in prod).
const ToolSpecSchema = z.object({
  name: z.string(),
  description: z.string(),
  // G-8: throbber copy is persisted along with the spec; missing → falls
  // back to "running <name>"
  progress_label: z.string().optional(),
  input_schema: z.unknown(),
  // #134: this tool's own ui:// card HTML (MCP Apps, per-tool). Persisted
  // with the spec, otherwise the code-mode entry hop (gate issue →
  // localStorage → chat reuse) gets it stripped by zod.
  ui_html: z.string().optional(),
});
const CapStateSchema = z.object({
  id: z.string(),
  enabled: z.boolean(),
  quota_remaining: z.number().optional(),
  policy_summary: z.string().optional(),
  // extra —— extra state for the capability (#134: an externalized MCP
  // app's ui:// card html / resource_uri hangs under ui). Must be kept —
  // Zod strips unknown keys by default, and missing this would make
  // reuseStored drop the sandbox card's html, so the frontend can't render
  // the card.
  extra: z.unknown().optional(),
});
// DockButtonSchema —— #109/#110 dock button persistence: on a second entry
// with a reused session, the buttons are still there.
const DockButtonSchema = z.object({
  capability_id: z.string(),
  title: z.string(),
  trigger: z.string(),
});
const StoredVisitorSessionSchema = z.object({
  session_token: z.string(),
  conversation_id: z.string(),
  byoai: z.boolean(),
  // custom_page_slug —— which page this code lands you on when scanned.
  // **The single place the landing decision is stored**: there are two
  // paths to claim a code (/gate submit, the name picker), and both go
  // through this same persist, so neither can miss it. Empty string =
  // default chat. Old blobs lack this field → default ''.
  custom_page_slug: z.string().default(''),
  capabilities: z.array(CapStateSchema).optional(),
  tool_specs: z.array(ToolSpecSchema).optional(),
  system_prompt_part_ids: z.array(z.string()).optional(),
  system_prompt_persona: z.string().optional(),
  // H.13.d: the initial ghost queue for code-mode is persisted too; on a
  // second entry with a reused session, the owner's suggested ghosts are
  // still visible.
  ghosts: z.array(z.string()).nullish().transform((v) => v ?? undefined), // F-D-1 class: ghosts can be null
  dock_buttons: z.array(DockButtonSchema).optional(),
});
type StoredVisitorSession = z.infer<typeof StoredVisitorSessionSchema>;

export function persistSession(sess: PublicSessionResponse, byoai: boolean): void {
  if (typeof window === 'undefined') return;
  // PublicSessionResponse uses readonly arrays; zod-inferred Stored shape
  // uses mutable. Spread into fresh mutable arrays so the type-check passes
  // without unsafe casts; JSON.stringify treats both the same anyway.
  const data: StoredVisitorSession = {
    session_token: sess.session_token,
    conversation_id: sess.conversation_id,
    byoai,
    custom_page_slug: sess.custom_page_slug ?? '',
    capabilities: sess.capabilities ? [...sess.capabilities] : undefined,
    tool_specs: sess.tool_specs ? [...sess.tool_specs] : undefined,
    system_prompt_part_ids: sess.system_prompt_part_ids
      ? [...sess.system_prompt_part_ids] : undefined,
    system_prompt_persona: sess.system_prompt_persona,
    ghosts: sess.ghosts
      ? [...sess.ghosts] : undefined,
    dock_buttons: sess.dock_buttons ? [...sess.dock_buttons] : undefined,
  };
  window.localStorage.setItem(BYOAI_STORAGE_KEY, JSON.stringify(data));
}

// storeDisplaySession —— folds the issue response into the SessionStrip
// display store. Shared by both the code and byoai paths: role-specific
// fields (code/visitor/byoai/provider) are passed by the caller, while
// quota/members/startedAt plus #122's email/ownerCanDeliver are mapped
// uniformly here.
function storeDisplaySession(
  sess: PublicSessionResponse,
  fields: { code: string | null; visitor: string | null; byoai: boolean; byoaiProvider: string },
): void {
  useVisitorSessionStore.getState().setSession({
    ...fields,
    // label —— this code's name; the strip and the welcome message use it
    // to say "which slice you're in". This used to be hardcoded to null,
    // so the `?? 'invited'` fallback in both places always kicked in and
    // every code got called "invited" (UX-68). The fallback itself is
    // correct (per the design: fall back only when there's no label) —
    // the bug was throwing away the real value on this line.
    label: sess.code_label ?? null,
    used: sess.quota.used_turns,
    max: sess.quota.max_turns,
    maxMembers: sess.quota.max_members,
    memberCount: sess.members.length,
    startedAt: Date.now(),
    email: '',
    ownerCanDeliver: sess.owner_can_deliver ?? false,
  });
}

export function loadStoredSession(): StoredVisitorSession | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(BYOAI_STORAGE_KEY);
  return raw ? safeJsonString(raw, StoredVisitorSessionSchema) : null;
}

// clearStoredSession —— removes the chat auth credentials (session_token +
// conversation_id). Called together with useVisitorSessionStore.clear()
// when the session expires (401), so a dead token doesn't keep hitting the
// backend.
export function clearStoredSession(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(BYOAI_STORAGE_KEY);
}

// Provider —— the provider name submitted for BYOAI. Left as string rather
// than narrowed, because the new backend supports a long list — anthropic
// / openai / deepseek / kimi / groq / siliconflow / openrouter / together /
// custom — and enumerating them all isn't worth it; the server rejects
// invalid values anyway.
export type Provider = string;

// BYOAISubmitInput —— the 4 fields submitted together from the /gate BYOAI
// panel. endpoint + model are required (custom requires the owner to fill
// them in; for a preset, the UI prefills the default and that flows
// through here too, so by this point they're always non-empty). The key is
// encrypted by the vault and lands in localStorage; the session still only
// sends provider to the server.
export interface BYOAISubmitInput {
  provider: Provider;
  endpoint: string;
  model: string;
  key: string;
}

// SubmitState.locked —— whether the last failure was a per-IP lock (the
// backend envelope's code=`code_locked`). That's a different thing from
// "wrong code", and the next step differs too: one is retyping, the other
// is **passing a captcha**. The backend honors this way out
// (`code_guard.go`: a valid token unlocks immediately), so the UI has to
// offer it (F-G-3).
export type SubmitState = { busy: boolean; error: string | null; locked: boolean };

// GateHook —— there are three doors on the gate, and **each door's own
// success or failure belongs only to it**.
//
// The previous version had one shared state read by all three doors: when
// the message door got blocked per-IP, the "enter access code" field would
// also light up red and pop a captcha, even though that door was never
// locked — the UI was bearing witness to a state that didn't exist, and
// printing another door's reason underneath it (F-G-6). Splitting into
// three isn't for tidiness — it makes that bug **impossible to write**.
export interface GateHook {
  code: SubmitState;
  byoai: SubmitState;
  request: SubmitState;
  submitCode: (code: string, visitorName: string, captchaToken?: string) => Promise<boolean>;
  submitBYOAI: (input: BYOAISubmitInput) => Promise<boolean>;
  submitRequest: (input: AccessRequestInput) => Promise<boolean>;
}

const IDLE: SubmitState = { busy: false, error: null, locked: false };

export interface AccessRequestInput {
  email: string;
  name: string;
  org: string;
  message: string;
  // captcha_token —— the pass used to get through after being blocked for
  // sending too many (F-G-4). The field name matches the wire format
  // because it's JSON.stringify'd out directly.
  captcha_token?: string;
}

export function useGate(): GateHook {
  const [code, setCodeState] = useState<SubmitState>(IDLE);
  const [byoai, setByoaiState] = useState<SubmitState>(IDLE);
  const [request, setRequestState] = useState<SubmitState>(IDLE);

  const submitCode = useCallback(async (
    code: string, visitorName: string, captchaToken = '',
  ): Promise<boolean> => {
    return await runSubmit(setCodeState, async () => {
      const trimmedCode = code.trim();
      const trimmedName = visitorName.trim();
      const sess = await issueCodeSession({
        code: trimmedCode, visitor_name: trimmedName,
        // Don't send an empty string: the backend ignores this field when
        // captcha is off, but a field that's always present, even empty,
        // could look like "the token is already attached".
        ...(captchaToken === '' ? {} : { captcha_token: captchaToken }),
      });
      // F-A-5: keep the remembered name in sync with the /gate entry so a later
      // VisitorNamePicker (a genuinely new code) prefills THIS identity, not a
      // stale name from an earlier picker use.
      (trimmedName !== '') && rememberVisitorName(trimmedName);
      persistSession(sess, false);
      storeDisplaySession(sess, {
        code: sess.code ?? trimmedCode,
        visitor: sess.visitor_name ?? trimmedName ?? null,
        byoai: false, byoaiProvider: '',
      });
      return true;
    });
  }, []);

  const submitBYOAI = useCallback(
    async (input: BYOAISubmitInput): Promise<boolean> => {
      return await runSubmit(setByoaiState, async () => {
        const sess = await issueBYOAISession({ byoai_provider: input.provider });
        await storeBYOAI({
          provider: input.provider,
          endpoint: input.endpoint.trim(),
          model: input.model.trim(),
          key: input.key.trim(),
        });
        persistSession(sess, true);
        storeDisplaySession(sess, {
          code: null, visitor: sess.visitor_name ?? null,
          byoai: true, byoaiProvider: input.provider,
        });
        return true;
      });
    },
    [],
  );

  const submitRequest = useCallback(async (input: AccessRequestInput): Promise<boolean> => {
    return await runSubmit(setRequestState, async () => {
      const res = await fetch('/api/v1/access-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw await requestError(res);
      return true;
    });
  }, []);

  return { code, byoai, request, submitCode, submitBYOAI, submitRequest };
}

async function runSubmit(
  setState: (s: SubmitState) => void,
  fn: () => Promise<boolean>,
): Promise<boolean> {
  setState({ busy: true, error: null, locked: false });
  try {
    const ok = await fn();
    setState({ busy: false, error: null, locked: false });
    return ok;
  } catch (e) {
    setState({ busy: false, error: submitErrorText(e), locked: isLocked(e) });
    return false;
  }
}

// requestError —— reads the error envelope from the message door (code +
// message) instead of collapsing it into a bare `submit access request:
// 429`. The backend wrote a sentence for the visitor to read explaining
// this rejection, and the previous version threw it away — so "you sent
// too many, just pass a captcha" turned into a status code nobody could
// make sense of (same family as F-A-23).
async function requestError(res: Response): Promise<Error> {
  const body: unknown = await res.json().catch(() => ({}));
  const env = envelopeOf(body);
  return Object.assign(new Error(`submit access request: ${res.status}`), {
    code: env.code, serverMessage: env.message,
  });
}

function envelopeOf(body: unknown): { code: string; message: string } {
  if (typeof body !== 'object' || body === null || !('error' in body)) {
    return { code: '', message: '' };
  }
  const err: unknown = body.error;
  if (typeof err !== 'object' || err === null) return { code: '', message: '' };
  const code = 'code' in err && typeof err.code === 'string' ? err.code : '';
  const message = 'message' in err && typeof err.message === 'string' ? err.message : '';
  return { code, message };
}

// LOCK_CODES —— the rejections that mean "blocked by this gate, and a
// single captcha pass gets you through". Code redemption uses
// `code_locked`, the message door uses `request_flood` — two doors, the
// same machine (ipTally), the same way out. What's checked is the envelope's
// `code`, not the wording of the message: a check that breaks the moment
// the copy changes isn't really a check.
const LOCK_CODES = ['code_locked', 'request_flood'];

function isLocked(e: unknown): boolean {
  if (typeof e !== 'object' || e === null || !('code' in e)) return false;
  return typeof e.code === 'string' && LOCK_CODES.includes(e.code);
}

// submitErrorText —— the backend wrote a sentence for the visitor to read
// for every kind of rejection ("no such access code…", "this access code
// was revoked…", "this code is full…"), so surface that sentence. Each one
// points to a different next step, so this layer must not merge them
// (F-D-6). Only fall back to a generic message when there's nothing to
// get: something like `issue session: 403` gives the visitor nothing
// (F-A-23).
function submitErrorText(e: unknown): string {
  const fromServer = serverMessageOf(e);
  return fromServer !== '' ? fromServer : 'Couldn’t check that just now. Try again.';
}

// serverMessageOf —— the SDK attaches the envelope's message onto the
// thrown Error. Type assertions are banned in this repo, so this narrows
// step by step with in + typeof instead.
function serverMessageOf(e: unknown): string {
  if (typeof e !== 'object' || e === null || !('serverMessage' in e)) return '';
  const msg: unknown = e.serverMessage;
  return typeof msg === 'string' ? msg : '';
}
