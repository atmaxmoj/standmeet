// draft-wire —— the ONE parser of a résumé as the backend serves it (snake_case resume_content) and its
// mapping into the models the app renders. Pure (no React), so the editor, the draft list thumbnails,
// the applications list AND the server-rendered print route all read a résumé the same way.
//
// The print route used to keep its own hand-written copy of this schema; the copy never learned
// accent, font_scale or the custom-section kind, so the PDF ignored the font size and colour the owner
// set in the editor. One parser makes that class of drift impossible.

import { z } from 'zod';

import {
  DEFAULT_LEFT_WIDTH, draftToResumeContent, normalizeLeftOrder, type DraftModel,
} from '@/lib/admin/draft-model';
import type { ResumeContent } from '@/lib/admin/resume-content';
import { paperOf } from '@/lib/admin/resume-pages';

const PeriodSchema = z.object({ start: z.string(), end: z.string().nullable().optional() });

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
  // paper_size — 'letter' | 'a4'; absent/unknown → Letter (normalised by paperOf, not rejected: one
  // odd value must not make the whole draft unreadable).
  paper_size: z.string().optional().default('letter'),
  // left_order — order of the left-rail sections; empty/old drafts → normalizeLeftOrder fills it.
  left_order: z.array(z.string()).optional().default([]),
  // left_width — left-column width in fr; absent/old → the classic default.
  left_width: z.number().optional().default(DEFAULT_LEFT_WIDTH),
});
export type ResumeContentWire = z.infer<typeof ResumeContentSchema>;

export const DraftDetailSchema = z.object({
  id: z.string(), company: z.string(), role: z.string(),
  template: z.string().optional().default(''),
  resume_content: ResumeContentSchema,
  // puck_data — the Puck editor's own state, passed through verbatim. Absent (agent-created or
  // pre-Puck draft) → the editor derives it from resume_content on open. Loosely typed on purpose:
  // the app never inspects it, it only round-trips it back to the backend on Save.
  puck_data: z.unknown().optional(),
  // The master this draft started from (absent = none) and when it expires — the composer's bar.
  based_on_master_id: z.string().optional().default(''),
  based_on_master_name: z.string().optional().default(''),
  expires_at: z.string().optional().default(''),
});
export type DraftDetail = z.infer<typeof DraftDetailSchema>;

// toDraftModel accepts template optionally: the detail fetch always carries it, but the list /
// application thumbnails build this shape without a template (their thumbnail render ignores it).
export function toDraftModel(
  d: Pick<DraftDetail, 'id' | 'company' | 'role' | 'resume_content'> & { template?: string },
): DraftModel {
  const rc = d.resume_content;
  return {
    id: d.id, company: d.company, role: d.role,
    name: rc.identity.name, summary: rc.summary,
    contact: {
      email: rc.identity.email, phone: rc.identity.phone,
      location: rc.identity.location_line, site: rc.identity.site,
    },
    skillSets: rc.skills,
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
    paperSize: paperOf(rc.paper_size),
    leftOrder: normalizeLeftOrder(rc.left_order),
    leftWidth: rc.left_width,
  };
}

// wireToResumeContent —— the backend's resume_content → what the renderer draws, through the same
// model the editor opens (so the PDF and the canvas cannot read a résumé differently).
export function wireToResumeContent(rc: ResumeContentWire): ResumeContent {
  return draftToResumeContent(toDraftModel({ id: '', company: '', role: '', resume_content: rc }));
}
