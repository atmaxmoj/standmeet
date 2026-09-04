import { z } from 'zod';

// ─── writings (public reader page) ────────────────────────────────────────
// Moved over from `public.ts`: that file hit max-lines, and the gate was
// pointing the right direction — schemas belong here. Only shapes live in
// this file; fetching still lives in public.ts.

// BacklinkRef —— one "linked from" entry on /writings/<slug>. Collected by the
// backend at render time; the source writing must be published.
const BacklinkRefSchema = z.object({ slug: z.string(), title: z.string() });
export type BacklinkRef = z.infer<typeof BacklinkRefSchema>;

export const WritingViewSchema = z.object({
  id: z.string(), slug: z.string(), title: z.string(), excerpt: z.string(),
  body_md: z.string(), cover_headline: z.string(),
  cover_hue: z.enum(['amber', 'violet', 'acid']),
  cover_image_asset_id: z.string().nullish().transform((v) => v ?? undefined),
  tags: z.array(z.string()), visibility: z.enum(['public', 'private']),
  cross_refs: z.array(z.string()), path: z.string(), read_minutes: z.number(),
  locked_body: z.string().nullish().transform((v) => v ?? undefined),
  published_at: z.string().nullish().transform((v) => v ?? undefined),
  asset_urls: z.record(z.string(), z.string()).nullish().transform((v) => v ?? {}),
  backlinks: z.array(BacklinkRefSchema).nullish().transform((v) => v ?? []),
  // The server has already picked which side to serve; these two only answer
  // "what else is there" (for the switcher).
  //
  // **`.nullish()` is not `.optional()`** (F-R-5): a Go nil slice encodes as
  // `null`, but `.optional()` only accepts the **key being absent** — it
  // doesn't accept `null`, so the whole parse fails, and a zod mismatch fails
  // the **entire** parse, not just turns this one field into undefined
  // ([[zod-unknown-is-not-optional]]). The consequence isn't a missing
  // language switcher, it's the whole `/writings` page 500ing. The
  // `.optional()` calls above this line are neighbors of the same trap, fixed
  // together: their values also come from Go fields that can be nil.
  lang: z.string().nullish(),
  languages: z.array(z.object({ code: z.string(), label: z.string() })).nullish(),
});
export type WritingView = z.infer<typeof WritingViewSchema>;
