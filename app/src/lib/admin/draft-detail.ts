// draft-detail —— #52: fetch GET /api/admin/drafts/{id} and map the real
// resume_content (+ job context) into the DraftModel the ResumeComposer edits,
// replacing the mockDraft placeholder.

import { useEffect, useState } from 'react';

import { z } from 'zod';

import type { DraftModel } from '@/lib/admin/draft-model';
import { safeJson } from '@/lib/api/typed-json';

const PeriodSchema = z.object({ start: z.string(), end: z.string().nullable().optional() });

// ResumeContentSchema / toDraftModel are both **exported**: the list path
// (thumbnail) reads the same `resume_content`, which used to render a
// hardcoded fake resume (F-E-20). If each site wrote its own mapping, the
// card and the composer would drift into rendering two different things —
// and that "two different things" is exactly the shape of that defect.
export const ResumeContentSchema = z.object({
  identity: z.object({
    name: z.string(), email: z.string(), phone: z.string(),
    location_line: z.string(), site: z.string().optional().default(''),
  }),
  summary: z.string(),
  cover_letter: z.string().optional().default(''),
  works: z.array(z.object({
    period: PeriodSchema, title: z.string(), company: z.string(),
    location: z.string(), bullets: z.array(z.string()),
  })).optional().default([]),
  educations: z.array(z.object({
    period: PeriodSchema, school: z.string(), degree: z.string(),
  })).optional().default([]),
  skills: z.array(z.object({ category: z.string(), items: z.array(z.string()) }))
    .optional().default([]),
  social: z.array(z.object({ kind: z.string(), label: z.string(), handle: z.string() }))
    .optional().default([]),
  custom: z.array(z.object({ label: z.string(), value: z.string() })).optional().default([]),
});

const DraftDetailSchema = z.object({
  id: z.string(), company: z.string(), role: z.string(),
  resume_content: ResumeContentSchema,
});
export type DraftDetail = z.infer<typeof DraftDetailSchema>;

interface DetailState {
  model: DraftModel | null;
  error: string | null;
}

export function useDraftDetail(id: string | null): DetailState {
  const [state, setState] = useState<DetailState>({ model: null, error: null });
  useEffect(() => {
    if (id === null) {
      setState({ model: null, error: null });
      return;
    }
    void load(id, setState);
  }, [id]);
  return state;
}

async function load(id: string, setState: (s: DetailState) => void): Promise<void> {
  try {
    const res = await fetch(`/api/admin/drafts/${id}`, { credentials: 'include' });
    if (!res.ok) throw new Error(`draft detail: ${res.status}`);
    const detail = await safeJson(res, DraftDetailSchema);
    setState({ model: toDraftModel(detail), error: null });
  } catch (e) {
    setState({ model: null, error: e instanceof Error ? e.message : 'load draft failed' });
  }
}

export function toDraftModel(d: DraftDetail): DraftModel {
  const rc = d.resume_content;
  return {
    id: d.id, company: d.company, role: d.role,
    name: rc.identity.name, summary: rc.summary,
    contact: {
      email: rc.identity.email, phone: rc.identity.phone,
      location: rc.identity.location_line, site: rc.identity.site,
    },
    skills: rc.skills.flatMap((s) => s.items),
    experience: rc.works.map((w, i) => ({
      id: `e-${i}`, org: w.company, role: w.title,
      range: fmtPeriod(w.period), loc: w.location, bullets: w.bullets,
    })),
    education: rc.educations.map((e, i) => ({
      id: `ed-${i}`, school: e.school, degree: e.degree, range: fmtPeriod(e.period),
    })),
    social: rc.social.map((s, i) => ({ id: `s-${i}`, kind: s.kind, handle: s.handle })),
    custom: rc.custom.map((c, i) => ({ id: `c-${i}`, label: c.label, value: c.value })),
    coverLetter: rc.cover_letter,
  };
}

function fmtPeriod(p: { start: string; end?: string | null }): string {
  return p.end ? `${p.start} — ${p.end}` : `${p.start} — present`;
}
