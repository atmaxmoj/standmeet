// wiki-landing —— the shape + parsing of a wiki landing payload. **Pure
// computation, no 'use client'**.
//
// It lives here rather than in scoped-reader because the server-side path
// needs it too: scoped-reader imports use-gate (a client hook module) in
// order to read the visitor token in localStorage, and a Server Component
// importing it blows up entirely ("You're importing a component that needs
// useState"). Same criterion as `lib/corpus/media.ts`: **a pure function
// shouldn't live inside a client boundary** — it has no state, no hook, no
// DOM; putting it there just because "the component that uses it is over
// there" isn't a reason.

import { z } from 'zod';

const WikiRefViewSchema = z.object({ path: z.string(), title: z.string() });

// WikiAssetSchema —— a file attached to this corpus entry. **Needs a real
// byte count**: a download button that says "3.4 MB" is what the visitor
// bases their click on — a button that just says "Download" says nothing.
const WikiAssetSchema = z.object({
  asset_id: z.string(),
  kind: z.string(),
  content_type: z.string(),
  original_filename: z.string(),
  url: z.string(),
  size_bytes: z.number(),
});
// The asset item's type isn't exported on its own: the reader now reads
// the whole `WikiLandingEntry` at once, and nobody needs the asset type
// pulled out separately. (knip watches for exactly this kind of "exported
// but nobody uses it".)

export const WikiLandingEntrySchema = z.object({
  path: z.string(),
  title: z.string(),
  body: z.string(),
  excerpt: z.string(),
  updated_at: z.string(),
  tags: z.array(z.string()).nullish().transform((v) => v ?? []),
  css_classes: z.array(z.string()).nullish().transform((v) => v ?? []),
  related: z.array(WikiRefViewSchema).nullish().transform((v) => v ?? []),
  cited_by: z.array(WikiRefViewSchema).nullish().transform((v) => v ?? []),
  sources_count: z.number(),
  // asset_urls —— maps a `standmeet-asset:<id>` reference in the body +
  // the hero image → a fetchable URL. Without it, the URI in the body
  // doesn't render at all (react-markdown's urlTransform strips
  // non-standard schemes outright), leaving the visitor with an empty
  // image slot.
  asset_urls: z.record(z.string(), z.string()).nullish().transform((v) => v ?? {}),
  // assets —— files attached to this entry. Images go into the body;
  // attachments render into a download area.
  assets: z.array(WikiAssetSchema).nullish().transform((v) => v ?? []),
  // The hero trio. All three empty = the owner didn't set a hero → nothing
  // renders up top (F-L-32).
  cover_image_asset_id: z.string().nullish().transform((v) => v ?? ''),
  cover_headline: z.string().nullish().transform((v) => v ?? ''),
  cover_hue: z.string().nullish().transform((v) => v ?? ''),
  // Multilingual: body is already the selected language's version.
  // languages empty = single-language, no switcher shown.
  lang: z.string().nullish().transform((v) => v ?? ''),
  languages: z.array(z.object({ code: z.string(), label: z.string() }))
    .nullish().transform((v) => v ?? []),
});
export type WikiLandingEntry = z.infer<typeof WikiLandingEntrySchema>;

/**
 * parseWikiLanding —— a landing payload → the shape the reader reads.
 * Wrong shape / missing → null.
 *
 * **Both entry points must go through here**: the SSR path (published,
 * anonymous) and the token-refetched path. Previously only the latter did
 * — the former took the backend's snake_case payload and used it
 * **directly** as the reader's entry, while the reader's type had hero /
 * asset fields that were camelCase and optional at the time, so type
 * checking silently passed and a published note's cover image, cover
 * headline, and inline images **all vanished** (F-L-33). One payload, two
 * shapes, and the half that was missed raised no error. Now the reader's
 * entry is the product of this one schema — there's no second shape left
 * to miss.
 */
export function parseWikiLanding(raw: unknown): WikiLandingEntry | null {
  const parsed = WikiLandingEntrySchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
