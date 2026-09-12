// use-outbound.ts —— whether the owner has an outbound channel that **can actually send**.
//
// Only two places on the panel ask this: approving a gate request (needs to
// send the code to the applicant) and account recovery (needs to send the
// phrase to the owner). Both ask the same yes/no question, so this file
// answers only that one thing: `connected`.
//
// This file used to be called `use-mail.ts`, exporting a full set of
// saveCredentials / disconnect / otp{send,verify}. **All four hit dead
// routes**: `/suppliers/mail/credentials` and `/disconnect` used the dead id
// `mail` (the real id is `smtp`, see below), and `/suppliers/mail/send-otp`
// and `/verify-otp` **didn't exist on the backend at all**. And **no
// component called any of them** — both consumers only ever read
// `.connected`. A dead interface pointing at dead routes could be wired up
// by the next person any time, so it was deleted, not kept around.
//
// Also deleted for the same reason: `MailCredsInput{host,port,username,password,from_address,from_name}`
// and the never-filled-in fields on `MailStatusSchema` — that's **the shape
// of one email and one SMTP server**, and the backend had just removed it
// from the core types, leaving no reason for it to keep living unchanged on the frontend.

import { useEffect } from 'react';

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore, useResource } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';

// OutboundStatus —— just one yes/no question: can it actually send?
const OutboundStatusSchema = z.object({
  connected: z.boolean(),
  hasCredentials: z.boolean(),
});
export type OutboundStatus = z.infer<typeof OutboundStatusSchema>;

// The canonical id of the outbound supplier is `smtp` (seam `mail`),
// **not** `mail` — hitting `/suppliers/mail/status` resolves a dead id,
// always returning connected:false, so even after the owner set up a
// supplier that could actually send mail, the approve gate and the
// recovery gate stayed locked forever (F-C-7). So this derives it from the
// **authoritative supplier list** instead: the one whose seam is
// outbound, connected, and active.
const OutboundRowSchema = z.object({
  seam: z.string(),
  has_credentials: z.boolean().nullish(),
  connected: z.boolean(),
  active: z.boolean().nullish(),
});
const SuppliersListSchema = z.object({
  suppliers: z.array(OutboundRowSchema).nullish(),
});

// outboundSeam —— which seam notifications go through. **Just this
// one string**, because the list is organized by seam; it doesn't mean
// this layer knows what SMTP or an email looks like.
const outboundSeam = 'mail';

const outboundStatusStore = createResourceStore<OutboundStatus>({
  name: 'outbound-status',
  fetcher: async () => {
    const list = await adminAPI.get('/suppliers', SuppliersListSchema);
    const rows = (list.suppliers ?? []).filter((c) => c.seam === outboundSeam);
    const live = rows.find((c) => c.connected && (c.active ?? true));
    return OutboundStatusSchema.parse({
      connected: Boolean(live),
      hasCredentials: rows.some((c) => c.has_credentials ?? false),
    });
  },
});

export interface OutboundHook {
  statusKind: ResourceStatus;
  status: OutboundStatus | null;
}

/** useOutbound —— whether the owner has an outbound channel that can actually send. */
export function useOutbound(): OutboundHook {
  const r = useResource(outboundStatusStore);
  const ensureLoaded = r.ensureLoaded;
  // Without fetching, this stays null forever, and null reads as "can't send" — the approve gate and the recovery gate would stay locked forever.
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  return { statusKind: r.status, status: r.data ?? null };
}
