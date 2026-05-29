// print-payload.ts —— wire shape served by GET /internal/print-session/<token>
// (backend printsess.Payload) + adapter into the frontend ResumeContent
// the React component consumes.
//
// Kept out of the page.tsx so the page stays presentation-only (no
// branching, no normalization). Wire shape validated with zod at the
// network boundary (consistent-type-assertions rule).

import { z } from 'zod';

import type { ResumeContent } from '@/lib/admin/resume-content';

const PeriodSchema = z.object({
  start: z.string(),
  end: z.string().nullable().optional(),
});

const ResumeContentWireSchema = z.object({
  identity: z.object({
    name: z.string(),
    email: z.string(),
    phone: z.string().optional(),
    location_line: z.string(),
    site: z.string().optional(),
  }),
  summary: z.string(),
  cover_letter: z.string().optional(),
  works: z.array(z.object({
    title: z.string(),
    company: z.string(),
    location: z.string(),
    period: PeriodSchema,
    bullets: z.array(z.string()).optional(),
  })).optional(),
  educations: z.array(z.object({
    school: z.string(),
    degree: z.string(),
    period: PeriodSchema,
  })).optional(),
  skills: z.array(z.object({
    category: z.string(),
    items: z.array(z.string()).optional(),
  })).optional(),
  social: z.array(z.object({
    kind: z.string(),
    label: z.string().optional(),
    handle: z.string(),
  })).optional(),
  custom: z.array(z.object({
    label: z.string(),
    value: z.string(),
  })).optional(),
});

const PrintPayloadWireSchema = z.object({
  application_id: z.string(),
  resume_content: ResumeContentWireSchema,
  job_snapshot: z.object({
    title: z.string(),
    company: z.string(),
  }),
  qr_url: z.string(),
  v: z.number(),
});

export type PrintPayloadWire = z.infer<typeof PrintPayloadWireSchema>;
type ResumeContentWire = z.infer<typeof ResumeContentWireSchema>;

export async function fetchPrintPayload(token: string): Promise<PrintPayloadWire | null> {
  const base = process.env.BACKEND_URL ?? 'http://backend:8000';
  const url = `${base}/internal/print-session/${encodeURIComponent(token)}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) return null;
  const raw: unknown = await res.json();
  const parsed = PrintPayloadWireSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function toResumeContent(w: ResumeContentWire): ResumeContent {
  return {
    identity: {
      name: w.identity.name,
      email: w.identity.email,
      phone: w.identity.phone,
      locationLine: w.identity.location_line,
      site: w.identity.site,
    },
    summary: w.summary,
    coverLetter: w.cover_letter,
    works: (w.works ?? []).map((work) => ({
      title: work.title,
      company: work.company,
      location: work.location,
      period: work.period,
      bullets: work.bullets ?? [],
    })),
    educations: (w.educations ?? []).map((e) => ({
      school: e.school,
      degree: e.degree,
      period: e.period,
    })),
    skills: (w.skills ?? []).map((s) => ({
      category: s.category,
      items: s.items ?? [],
    })),
    social: w.social,
    custom: w.custom,
  };
}
