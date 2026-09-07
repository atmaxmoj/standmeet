// draft-detail —— #52: fetch GET /api/admin/drafts/{id} and map the real
// resume_content (+ job context) into the DraftModel the ResumeComposer edits,
// replacing the mockDraft placeholder.

import { useEffect, useState } from 'react';

import { z } from 'zod';

import {
  DEFAULT_LEFT_WIDTH, normalizeLeftOrder, type DraftModel,
} from '@/lib/admin/draft-model';
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
  custom: z.array(z.object({
    label: z.string(), value: z.string(), kind: z.string().optional().default(''),
  })).optional().default([]),
  accent: z.string().optional().default(''),
  // font_scale — the whole-résumé font-size multiplier; absent/old drafts → 1 (template default).
  font_scale: z.number().optional().default(1),
  // left_order — order of the left-rail sections; empty/old drafts → normalizeLeftOrder fills it.
  left_order: z.array(z.string()).optional().default([]),
  // left_width — left-column width in fr; absent/old → the classic default.
  left_width: z.number().optional().default(DEFAULT_LEFT_WIDTH),
});

const DraftDetailSchema = z.object({
  id: z.string(), company: z.string(), role: z.string(),
  template: z.string().optional().default(''),
  resume_content: ResumeContentSchema,
  // puck_data — the Puck editor's own state, passed through verbatim. Absent (agent-created or
  // pre-Puck draft) → the editor derives it from resume_content on open. Loosely typed on purpose:
  // the app never inspects it, it only round-trips it back to the backend on Save.
  puck_data: z.unknown().optional(),
});
export type DraftDetail = z.infer<typeof DraftDetailSchema>;

interface DetailState {
  model: DraftModel | null;
  // puckData — the raw Puck state to restore, or null when the draft has none yet (derive on open).
  puckData: unknown;
  error: string | null;
}

export function useDraftDetail(id: string | null): DetailState {
  const [state, setState] = useState<DetailState>({ model: null, puckData: null, error: null });
  useEffect(() => {
    if (id === null) {
      setState({ model: null, puckData: null, error: null });
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
    setState({ model: toDraftModel(detail), puckData: detail.puck_data ?? null, error: null });
  } catch (e) {
    setState({ model: null, puckData: null, error: e instanceof Error ? e.message : 'load draft failed' });
  }
}

// toDraftModel accepts template optionally: the detail fetch always carries it, but the list /
// application thumbnails build this shape without a template (their thumbnail render ignores it).
export function toDraftModel(
  d: Omit<DraftDetail, 'template'> & { template?: string },
): DraftModel {
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
      start: w.period.start, end: w.period.end ?? '', loc: w.location, bullets: w.bullets,
    })),
    education: rc.educations.map((e, i) => ({
      id: `ed-${i}`, school: e.school, degree: e.degree,
      start: e.period.start, end: e.period.end ?? '',
    })),
    social: rc.social.map((s, i) => ({ id: `s-${i}`, kind: s.kind, handle: s.handle })),
    custom: rc.custom.map((c, i) => ({ id: `c-${i}`, label: c.label, value: c.value, kind: c.kind })),
    coverLetter: rc.cover_letter,
    template: d.template ?? '',
    accent: rc.accent,
    fontScale: rc.font_scale,
    leftOrder: normalizeLeftOrder(rc.left_order),
    leftWidth: rc.left_width,
  };
}
