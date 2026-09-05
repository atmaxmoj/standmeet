// use-embeds —— state for /admin/embeds. An embed exposes a code as a
// <standmeet-chat> widget on someone else's site; the origin allow-list lives
// on the embed (embed plan 2026-09-01).
//
// Same zustand boilerplate as codes/microsites: createResourceStore + flat actions.

'use client';

import { useEffect, useState } from 'react';

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore, useResource } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';

const EmbedSchema = z.object({
  id: z.string(),
  code_id: z.string(),
  label: z.string(),
  // allowed_origins: the backend has NOT NULL DEFAULT '[]', normally sending
  // an array. nullish guards against an old backend that omits the field and
  // crashing the whole list ([[zod-unknown-is-not-optional]]). Empty array = no origin restriction.
  allowed_origins: z.array(z.string()).nullish().transform((v) => v ?? []),
  // key_id —— this embed's JWT kid (the identifier for its anti-theft credential). The widget's snippet signs with this + the private key.
  key_id: z.string().nullish().transform((v) => v ?? ''),
  created_at: z.string(),
});
export type EmbedView = z.infer<typeof EmbedSchema>;

// CreatedEmbedSchema —— the receipt for creating an embed: one field beyond
// a list row, a **shown-once** private key PEM.
// It goes into the widget's snippet (not the code); refreshing the list can
// never retrieve it again, so create hands it over right there and then.
const CreatedEmbedSchema = EmbedSchema.extend({ private_key: z.string() });
export type CreatedEmbed = z.infer<typeof CreatedEmbedSchema>;

export interface CreateEmbedInput {
  code_id: string;
  label: string;
  allowed_origins: string[];
}

export interface UpdateEmbedInput {
  label: string;
  allowed_origins: string[];
}

export interface EmbedsHook {
  status: ResourceStatus;
  embeds: readonly EmbedView[];
  error: string | null;
  refresh: () => Promise<void>;
  // createEmbed returns **the receipt**: it carries the shown-once private key, and the section uses it to reveal the snippet right there.
  createEmbed: (input: CreateEmbedInput) => Promise<CreatedEmbed>;
  updateEmbed: (id: string, input: UpdateEmbedInput) => Promise<void>;
  removeEmbed: (id: string) => Promise<void>;
}

export const embedsStore = createResourceStore<EmbedView[]>({
  name: 'embeds',
  fetcher: () => adminAPI.get('/embeds/', z.array(EmbedSchema)),
});

export function useEmbeds(): EmbedsHook {
  const r = useResource(embedsStore);
  const ensureLoaded = r.ensureLoaded;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  return {
    status: r.status,
    embeds: r.data ?? [],
    error: r.error,
    refresh: embedsStore.getState().refresh,
    createEmbed,
    updateEmbed,
    removeEmbed,
  };
}

// Mutations always throw, and the caller finishes up with useAction/report
// (success toast / failure keeps the form open) — if it were swallowed into
// false, "wasn't created" and "was created but the allow-list didn't take
// effect" would be indistinguishable on screen.
async function createEmbed(input: CreateEmbedInput): Promise<CreatedEmbed> {
  const created = await adminAPI.post('/embeds/', input, CreatedEmbedSchema);
  embedsStore.getState().mutate((prev) => [created, ...(prev ?? [])]);
  return created;
}

async function updateEmbed(id: string, input: UpdateEmbedInput): Promise<void> {
  const updated = await adminAPI.patch(`/embeds/${id}`, input, EmbedSchema);
  embedsStore.getState().mutate((prev) =>
    (prev ?? []).map((e) => e.id === updated.id ? updated : e));
}

async function removeEmbed(id: string): Promise<void> {
  await adminAPI.deleteVoid(`/embeds/${id}`);
  embedsStore.getState().mutate((prev) => (prev ?? []).filter((e) => e.id !== id));
}

// EmbedFormHook —— local form state for the create/edit modal. Lives in lib,
// not the component: the presentation layer bans `if` / caps branching at 3,
// and these few `?? ''` for "use the existing value when editing, blank
// otherwise" already fill that budget (same reasoning as use-code-form).
export interface EmbedFormHook {
  editing: boolean;
  codeID: string;
  label: string;
  origins: string;
  setCodeID: (v: string) => void;
  setLabel: (v: string) => void;
  setOrigins: (v: string) => void;
}

export function useEmbedForm(existing: EmbedView | null): EmbedFormHook {
  const [codeID, setCodeID] = useState(existing?.code_id ?? '');
  const [label, setLabel] = useState(existing?.label ?? '');
  const [origins, setOrigins] = useState((existing?.allowed_origins ?? []).join('\n'));
  return {
    editing: existing !== null,
    codeID, label, origins,
    setCodeID, setLabel, setOrigins,
  };
}

// parseOrigins —— the textarea has one origin per line. Trims whitespace,
// drops blank lines; does no protocol validation (the backend matches the
// exact string, whatever the owner pastes is what's used) — this only
// clears out "invisible blank lines" so the allow-list doesn't end up with an empty string that can never match.
export function parseOrigins(text: string): string[] {
  return text.split('\n').map((s) => s.trim()).filter((s) => s !== '');
}

// dispatchEmbedSave —— editing decides whether this goes through update or create. Branching moved to lib so the modal's complexity stays ≤ 3.
export async function dispatchEmbedSave(
  existing: EmbedView | null,
  form: EmbedFormHook,
  onCreate: (codeID: string, label: string, origins: string[]) => Promise<void>,
  onUpdate: (id: string, label: string, origins: string[]) => Promise<void>,
): Promise<void> {
  const origins = parseOrigins(form.origins);
  if (existing === null) {
    await onCreate(form.codeID, form.label, origins);
    return;
  }
  await onUpdate(existing.id, form.label, origins);
}

// embedModalText —— the modal's header/button copy, computed once by
// editing. The presentation layer therefore never has an `editing ? … : …`.
export function embedModalText(
  t: (k: string) => string, editing: boolean,
): { kicker: string; title: string; save: string } {
  return editing
    ? { kicker: t('editKicker'), title: t('editTitle'), save: t('saveEdit') }
    : { kicker: t('createKicker'), title: t('createTitle'), save: t('save') };
}

// pemToKeyB64 —— squashes the PEM private key (multi-line, with
// -----BEGIN-----/-----END----- headers) down to single-line base64 DER: exactly
// the middle section of the PEM. That's the base64 the widget's WebCrypto
// importKey('pkcs8', ...) expects (a multi-line value can't fit as a snippet attribute).
export function pemToKeyB64(pem: string): string {
  return pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
}

// widgetSnippet —— the two lines the owner copies and pastes into someone
// else's site. **Anti-theft: no plaintext code included.**
//
// The address is computed at runtime (the owner's instance is on their own
// domain). It carries the **per-embed credential** (embed id + kid + private
// key); the widget signs a JWT on the spot and the server looks up the code
// from it — the plaintext code never enters this public HTML. The private
// key is given exactly once, at creation, so this full snippet can only ever
// be assembled at creation time ([[embed-credential-never-carries-the-code]]).
export function widgetSnippet(
  origin: string, embedID: string, keyID: string, privateKeyPem: string,
): string {
  return [
    `<script src="${origin}/embed.js"></script>`,
    `<standmeet-chat base-url="${origin}"`,
    `  embed="${embedID}" kid="${keyID}" key="${pemToKeyB64(privateKeyPem)}"></standmeet-chat>`,
  ].join('\n');
}
