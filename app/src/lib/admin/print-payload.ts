// print-payload.ts —— wire shape served by GET /internal/print-session/<token>
// (backend printsess.Payload). The résumé inside is parsed by the SAME schema the editor uses
// (draft-wire) — this file used to carry its own copy, which silently dropped accent and font_scale.
//
// Kept out of the page.tsx so the page stays presentation-only (no
// branching, no normalization). Wire shape validated with zod at the
// network boundary (consistent-type-assertions rule).

import { z } from 'zod';

import { ResumeContentSchema } from '@/lib/admin/draft-wire';

const PrintPayloadWireSchema = z.object({
  application_id: z.string(),
  resume_content: ResumeContentSchema,
  job_snapshot: z.object({
    title: z.string(),
    company: z.string(),
  }),
  qr_url: z.string(),
  v: z.number(),
});

export type PrintPayloadWire = z.infer<typeof PrintPayloadWireSchema>;

export async function fetchPrintPayload(token: string): Promise<PrintPayloadWire | null> {
  const base = process.env.BACKEND_URL ?? 'http://backend:8000';
  const url = `${base}/internal/print-session/${encodeURIComponent(token)}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) return null;
  const raw: unknown = await res.json();
  const parsed = PrintPayloadWireSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
