// draft-model —— the shape of the owner draft ResumeComposer edits + its
// derived value (match%).
//
// Design source: docs/design/project/admin.js buildDraftModel + ResumeComposer (8
// panel post-2026-05-28: header / summary / skills / experience /
// education / social / custom / cover).
//
// Key invariants:
//   - the draft is a working copy on the owner client; "save" = the
//     setLastSaved indicator.
//   - send → confirm modal → applications.commit (MCP) writes the
//     application row.
//   - all 8 of the composer's panels' data lives in this one DraftModel;
//     setters go through immutable patches (avoids complicating zustand
//     devtools time travel).
//   - `company` + `role` are job context (which company, what role applying
//     for), not the owner's work history — the header strip's second line renders these two.
//   - `name` + `contact.*` are owner identity, expected to stay stable
//     across drafts (the owner's master profile; synced from settings later).

import type {
  JobContext,
} from '@/components/admin/resume-page/ResumePage';
import type {
  ResumeContent,
  ResumeCustom,
  ResumeSocial,
} from '@/lib/admin/resume-content';

export interface DraftContact {
  email: string;
  phone: string;
  location: string;
  site: string;
}

export interface DraftExperience {
  id: string;
  org: string;
  role: string;
  range: string;     // YYYY-MM — YYYY-MM | 'present'
  loc: string;
  bullets: readonly string[];
}

export interface DraftEducation {
  id: string;
  school: string;
  degree: string;
  range: string;
}

export interface DraftSocial {
  id: string;
  kind: string;      // linkedin | github | twitter | mastodon | bluesky | website | scholar | medium | substack | other
  handle: string;    // url or @handle
}

export interface DraftCustom {
  id: string;
  label: string;
  value: string;
}

export interface DraftModel {
  id: string;
  /** Recipient company — header strip "for ACME". */
  company: string;
  /** Role applied for — header strip "STAFF ENGINEER · FOR ACME". */
  role: string;
  name: string;
  summary: string;
  contact: DraftContact;
  skills: readonly string[];
  experience: readonly DraftExperience[];
  education: readonly DraftEducation[];
  social: readonly DraftSocial[];
  custom: readonly DraftCustom[];
  coverLetter: string;
  /** Which Typst layout the committed PDF uses ('' = default classic). Picked in the composer. */
  template: string;
}

// **There used to be a `mockDraft()` here** — a design-time placeholder
// resume, sitting under the owner's real name, claiming a Stanford PhD and a
// stint at Google Brain. Once the backend was wired up (#52) the composer
// switched to real data, but the thumbnail on the drafts card was still
// rendering it: two completely different drafts drawing the same fictional
// résumé (F-E-20).
//
// Deleted, not shrunk. Fake data that "looks like a real resume" sitting in
// a job-search product will sooner or later get rendered somewhere else too
// — and the more convincing it looks, the less likely anyone is to spot it
// as fake on sight. A place with missing data now renders empty (F-E-21: an
// empty section doesn't even print its heading), and empty beats fabricated.

// The `match X / 100` gauge on the composer's top bar was **removed** (owner: "完全不知道怎么
// 计算的，不要了"). It was never a real match score — only a keyword overlap between the résumé and
// the role+company string, dressed up as a percentage. A number that looks like a measurement but
// isn't is worse than no number ([[names-that-lie]]); real ML scoring already happens in job-loop's
// resume.draft. `confidenceScore`/`useMatchPct` and their stopword list went with it.

// patchModel —— an immutable shallow patch across the whole draft.
export function patchModel(m: DraftModel, p: Partial<DraftModel>): DraftModel {
  return { ...m, ...p };
}

export function patchExperience(
  m: DraftModel, id: string, p: Partial<DraftExperience>,
): DraftModel {
  return {
    ...m,
    experience: m.experience.map((e) => e.id === id ? { ...e, ...p } : e),
  };
}

export function patchEducation(
  m: DraftModel, id: string, p: Partial<DraftEducation>,
): DraftModel {
  return {
    ...m,
    education: m.education.map((e) => e.id === id ? { ...e, ...p } : e),
  };
}

export function patchSocial(
  m: DraftModel, id: string, p: Partial<DraftSocial>,
): DraftModel {
  return {
    ...m,
    social: m.social.map((s) => s.id === id ? { ...s, ...p } : s),
  };
}

export function patchCustom(
  m: DraftModel, id: string, p: Partial<DraftCustom>,
): DraftModel {
  return {
    ...m,
    custom: m.custom.map((c) => c.id === id ? { ...c, ...p } : c),
  };
}

// draftToResumeContent —— adapter from the composer's edit-friendly
// DraftModel to the print-side ResumeContent shape ResumePage consumes.
// Splits the flat skill list into one anonymous category (ResumePage's
// left rail flattens all categories into a bullet list anyway, so a
// single category preserves order without forcing per-skill grouping in
// the UI yet).
export function draftToResumeContent(m: DraftModel): ResumeContent {
  return {
    identity: {
      name: m.name,
      email: m.contact.email,
      phone: m.contact.phone,
      locationLine: m.contact.location,
      site: m.contact.site,
    },
    summary: m.summary,
    coverLetter: m.coverLetter,
    works: m.experience.map((e) => ({
      title: e.role,
      company: e.org,
      location: e.loc,
      period: parseRange(e.range),
      bullets: [...e.bullets].filter((b) => b.trim() !== ''),
    })),
    educations: m.education.map((e) => ({
      school: e.school,
      degree: e.degree,
      period: parseRange(e.range),
    })),
    skills: [{ category: '', items: [...m.skills] }],
    social: m.social
      .filter((s) => s.handle.trim() !== '')
      .map((s): ResumeSocial => ({ kind: s.kind, label: s.kind, handle: s.handle })),
    custom: m.custom
      .filter((c) => c.label.trim() !== '' && c.value.trim() !== '')
      .map((c): ResumeCustom => ({ label: c.label, value: c.value })),
  };
}

// draftToAPIContent —— the snake_case resume_content the backend persists (matches
// jobsmodel.ResumeContent / ResumeContentSchema). Distinct from draftToResumeContent (camelCase,
// for the client-side ResumePage): the save (PATCH /drafts/{id}) writes this shape, and it must
// keep empty social/custom rows the owner half-filled so nothing is silently dropped on save —
// the render-side filtering (draftToResumeContent) happens at render, not at persist.
export function draftToAPIContent(m: DraftModel): Record<string, unknown> {
  return {
    identity: {
      name: m.name, email: m.contact.email, phone: m.contact.phone,
      location_line: m.contact.location, site: m.contact.site, links: [],
    },
    summary: m.summary,
    cover_letter: m.coverLetter,
    works: m.experience.map((e) => ({
      period: parseRange(e.range), title: e.role, company: e.org,
      location: e.loc, bullets: [...e.bullets],
    })),
    educations: m.education.map((e) => ({
      period: parseRange(e.range), school: e.school, degree: e.degree,
    })),
    skills: [{ category: '', items: [...m.skills] }],
    social: m.social.map((s) => ({ kind: s.kind, label: s.kind, handle: s.handle })),
    custom: m.custom.map((c) => ({ label: c.label, value: c.value })),
  };
}

export function draftToJobContext(m: DraftModel): JobContext {
  return { role: m.role, company: m.company };
}

// parseRange —— "YYYY-MM — YYYY-MM | present" → { start, end }.
// Tolerates extra spaces and either em-dash or hyphen. Empty / unparseable
// → empty start (ResumePage's formatPeriod renders "—" gracefully).
function parseRange(raw: string): { start: string; end: string | null } {
  const cleaned = raw.replace(/—/g, '-').replace(/\s+/g, ' ').trim();
  const parts = cleaned.split(/\s-\s/).map((s) => s.trim());
  const start = parts[0] ?? '';
  const rawEnd = parts[1] ?? '';
  return { start, end: rawEnd === '' || rawEnd.toLowerCase() === 'present' ? null : rawEnd };
}
