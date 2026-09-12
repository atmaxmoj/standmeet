// use-block-config —— one block's settings, as the block itself declares them.
//
// `docs/design/plugin/frontend.md` §2 calls this the load-bearing piece: without it the
// block list is a directory of links to hand-written forms and nothing is gained. The
// contract is narrow on purpose — a key, a type, a label, a range — because a type, an
// enum and a range are all a form needs, and anything richer would be a second place
// each block's knowledge has to be written down.
//
// Fetched per block rather than held in a shared store: the owner opens one block's
// settings at a time, and a cache keyed by "the block that happens to be open" is a
// cache that serves the previous block's fields for a frame.

'use client';

import { useCallback, useState } from 'react';
import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';

// ConfigFieldSchema —— the declaration plus what it is currently set to.
//
// `value` and `default` are JSON literals of whatever type the field declared, so they
// stay `unknown` here and are narrowed at the input that renders them. Typing them as
// string would quietly stringify a number and send `"7"` back where `7` was declared.
const ConfigFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.string(),
  description: z.string().optional(),
  value: z.unknown(),
  default: z.unknown(),
  min: z.number().optional(),
  max: z.number().optional(),
  overridden: z.boolean(),
});
export type ConfigField = z.infer<typeof ConfigFieldSchema>;

const ConfigSchema = z.object({
  block_id: z.string(),
  fields: z.array(ConfigFieldSchema),
});

export interface BlockConfigHook {
  fields: readonly ConfigField[];
  load: (id: string) => Promise<void>;
  save: (id: string, values: Record<string, unknown>) => Promise<void>;
}

export function useBlockConfig(): BlockConfigHook {
  const [fields, setFields] = useState<ConfigField[]>([]);
  const load = useCallback(async (id: string) => {
    const got = await adminAPI.get(
      `/blocks/${encodeURIComponent(id)}/config`, ConfigSchema,
    );
    setFields(got.fields);
  }, []);
  const save = useCallback(async (id: string, values: Record<string, unknown>) => {
    await adminAPI.patchVoid(`/blocks/${encodeURIComponent(id)}/config`, { values });
    // Re-read rather than trust the write: a generic "saved" proves nothing about
    // whether THIS value survived the round trip, and the panel's whole job is to show
    // what the block will actually run with.
    const got = await adminAPI.get(
      `/blocks/${encodeURIComponent(id)}/config`, ConfigSchema,
    );
    setFields(got.fields);
  }, []);
  return { fields, load, save };
}

// editedValues —— the fields the owner actually touched, in the declared types.
//
// Only what changed is sent. Sending every field would rewrite untouched ones as
// explicit overrides, and `overridden` is a real distinction: a field the owner never
// set follows the block's default forever, including when the block ships a new one.
// Saving the whole form would silently freeze today's defaults into the owner's config.
export function editedValues(
  fields: readonly ConfigField[], edits: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const raw = edits[f.key];
    out[f.key] = raw === undefined ? undefined : fromInputValue(f.type, raw);
  }
  for (const key of Object.keys(out)) {
    out[key] === undefined && delete out[key];
  }
  return out;
}

// inputType —— the declared type → the HTML input that fits it.
//
// The whole mapping, and it is meant to stay this short. A block declaring a type this
// does not know gets a text box, which is the honest fallback: the owner can still see
// and set the value, and the block's own validation still applies. The alternative —
// refusing to render an unknown type — would make adding a field type a frontend
// release, which is the cost this design exists to remove.
export function inputType(declared: string): string {
  switch (declared) {
    case 'int':
    case 'number':
      return 'number';
    case 'bool':
      return 'checkbox';
    case 'time':
      return 'time';
    default:
      return 'text';
  }
}

// asInputValue —— a JSON literal as the string an <input> shows.
//
// Strings arrive quoted from the declaration (`'"09:00"'` is a JSON string), and showing
// the quotes would have the owner delete them by hand every time.
export function asInputValue(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v === null || v === undefined) return '';
  return JSON.stringify(v);
}

// fromInputValue —— the string an <input> produced, back to the declared type.
//
// A number field must send `7`, not `"7"`: the block declared an int, and the host
// validates against that declaration. Round-tripping through the wrong JSON type is the
// quiet way a save "succeeds" and the value never takes effect.
export function fromInputValue(declared: string, raw: string): unknown {
  if (inputType(declared) === 'number') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
  }
  if (declared === 'bool') return raw === 'true';
  return raw;
}
