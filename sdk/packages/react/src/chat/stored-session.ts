// stored-session —— the issued visitor session, as this browser keeps it.
//
// One key (VISITOR_SESSION_STORAGE_KEY), written by whoever redeems a code (the /gate submit, the
// name picker) and read by every chat surface — the app room, a microsite's agent, the embed. The
// page is a rendering of the code, so all of them must take over the same session; each side
// writing its own literal would disconnect them silently.

import { z } from 'zod';
import { VISITOR_SESSION_STORAGE_KEY, type PublicSessionResponse } from '@standmeet/sdk-core';

import { safeJsonString } from './typed-json.js';

// Block state + tool spec also persisted (was missing before — D-5 pivot
// regression where reuseStored returned partial state without block states,
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
const BlockStateSchema = z.object({
  id: z.string(),
  enabled: z.boolean(),
  quota_remaining: z.number().optional(),
  policy_summary: z.string().optional(),
  // extra —— extra state for the block (#134: an externalized MCP
  // app's ui:// card html / resource_uri hangs under ui). Must be kept —
  // Zod strips unknown keys by default, and missing this would make
  // reuseStored drop the sandbox card's html, so the frontend can't render
  // the card.
  extra: z.unknown().optional(),
});
// DockButtonSchema —— #109/#110 dock button persistence: on a second entry
// with a reused session, the buttons are still there.
const DockButtonSchema = z.object({
  block_id: z.string(),
  title: z.string(),
  trigger: z.string(),
});
const StoredVisitorSessionSchema = z.object({
  session_token: z.string(),
  conversation_id: z.string(),
  byoai: z.boolean(),
  // microsite_slug —— which page this code lands you on when scanned.
  // **The single place the landing decision is stored**: there are two
  // paths to claim a code (/gate submit, the name picker), and both go
  // through this same persist, so neither can miss it. Empty string =
  // default chat. Old blobs lack this field → default ''.
  microsite_slug: z.string().default(''),
  // slug —— the code's own landing path (`/c/<slug>`). Persisted here for the
  // same reason as microsite_slug: all three landing paths (name picker, /gate
  // submit, re-open) read it from the one stored session, so none drifts.
  slug: z.string().default(''),
  blocks: z.array(BlockStateSchema).optional(),
  tool_specs: z.array(ToolSpecSchema).optional(),
  system_prompt_part_ids: z.array(z.string()).optional(),
  system_prompt_persona: z.string().optional(),
  // H.13.d: the initial ghost queue for code-mode is persisted too; on a
  // second entry with a reused session, the owner's suggested ghosts are
  // still visible.
  ghosts: z.array(z.string()).nullish().transform((v) => v ?? undefined), // F-D-1 class: ghosts can be null
  dock_buttons: z.array(DockButtonSchema).optional(),
});
export type StoredVisitorSession = z.infer<typeof StoredVisitorSessionSchema>;

export function persistSession(sess: PublicSessionResponse, byoai: boolean): void {
  if (typeof window === 'undefined') return;
  // PublicSessionResponse uses readonly arrays; zod-inferred Stored shape
  // uses mutable. Spread into fresh mutable arrays so the type-check passes
  // without unsafe casts; JSON.stringify treats both the same anyway.
  const data: StoredVisitorSession = {
    session_token: sess.session_token,
    conversation_id: sess.conversation_id,
    byoai,
    microsite_slug: sess.microsite_slug ?? '',
    slug: sess.slug ?? '',
    blocks: sess.blocks ? [...sess.blocks] : undefined,
    tool_specs: sess.tool_specs ? [...sess.tool_specs] : undefined,
    system_prompt_part_ids: sess.system_prompt_part_ids
      ? [...sess.system_prompt_part_ids] : undefined,
    system_prompt_persona: sess.system_prompt_persona,
    ghosts: sess.ghosts
      ? [...sess.ghosts] : undefined,
    dock_buttons: sess.dock_buttons ? [...sess.dock_buttons] : undefined,
  };
  window.localStorage.setItem(VISITOR_SESSION_STORAGE_KEY, JSON.stringify(data));
}

export function loadStoredSession(): StoredVisitorSession | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(VISITOR_SESSION_STORAGE_KEY);
  return raw ? safeJsonString(raw, StoredVisitorSessionSchema) : null;
}

// clearStoredSession —— removes the chat auth credentials (session_token +
// conversation_id). Called together with useVisitorSessionStore.clear()
// when the session expires (401), so a dead token doesn't keep hitting the
// backend.
export function clearStoredSession(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(VISITOR_SESSION_STORAGE_KEY);
}
