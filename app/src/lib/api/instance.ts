// instance.ts —— fetches instance metadata (v1 single-owner instance: claimed +
// handle + a setup_token that's only present while unclaimed).
//
// The root route /'s server component uses setup_token for a server-side
// redirect to /setup?t=<token>, so an operator who opens the domain right after
// first deploy lands in the claim flow automatically.
// Once claimed, setup_token is never returned again.

import { z } from 'zod';

import { safeJson } from '@/lib/api/typed-json';

const InstanceInfoSchema = z.object({
  claimed: z.boolean(),
  handle: z.string(),
  // name —— the owner's full name (used for by-lines, e.g. wiki metadata
  // "by Sijie Wang").
  name: z.string().optional().default(''),
  setup_token: z.string().optional(),
  captcha_site_key: z.string().optional(),
  // can_deliver_codes —— the owner has a connected mail connector (can send code
  // emails). /gate uses this to decide whether to show the "request access"
  // block at all. Defaults to false (don't show it if it can't send).
  can_deliver_codes: z.boolean().optional().default(false),
});
export type InstanceInfo = z.infer<typeof InstanceInfoSchema>;

const FALLBACK: InstanceInfo = { claimed: false, handle: '', name: '', can_deliver_codes: false };

export async function fetchInstance(): Promise<InstanceInfo> {
  const backend = process.env['BACKEND_URL'] ?? 'http://backend:8000';
  const res = await fetch(`${backend}/api/v1/instance`, { cache: 'no-store' });
  if (!res.ok) return FALLBACK;
  return safeJson(res, InstanceInfoSchema);
}
