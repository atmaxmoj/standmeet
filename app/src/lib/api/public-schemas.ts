import { z } from 'zod';

// AdminPageSchema —— shape of /api/admin/page GET/PUT. insights/projects are
// corpus pin lists (wiki id references), not free text — the home page joins
// them into cards at render time (the invariant pinned ⊆ published is
// maintained at the write site). Different from the public /api/v1/page card
// shape (PagePinCard): this stores references, that stores rendered cards.
export const AdminPageSchema = z.object({
  updated_at: z.string(), owner_id: z.string(), hero_prose: z.string(),
  hero_examples: z.array(z.string()),
  insights: z.array(z.string()),
  projects: z.array(z.string()),
  where: z.object({ location_line: z.string(), status_prose: z.string(), looking_for: z.array(z.string()), closing: z.string() }),
  contact: z.object({ chat_line: z.string(), email: z.string(), recruiter_prose: z.string(), casual_prose: z.string() }),
});
export type AdminPage = z.infer<typeof AdminPageSchema>;

// PinnableEntrySchema —— candidates for GET /page/pinnable: published wiki
// entries (id/title/path), for the admin pin manager's picker.
export const PinnableEntrySchema = z.object({
  id: z.string(), title: z.string(), path: z.string(),
});
export const PinnableListSchema = z.array(PinnableEntrySchema);
export type PinnableEntry = z.infer<typeof PinnableEntrySchema>;

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
