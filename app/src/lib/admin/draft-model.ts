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
  ResumeSkillSet,
  ResumeSocial,
} from '@/lib/admin/resume-content';
import type { PaperSize } from '@/lib/admin/resume-pages';

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
  start: string;     // YYYY-MM (free text)
  end: string;       // YYYY-MM; empty → renders "present"
  loc: string;
  bullets: readonly string[];
}

export interface DraftEducation {
  id: string;
  school: string;
  degree: string;
  start: string;
  end: string;
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
  kind: string; // '' = a label+value section; 'divider' = a horizontal rule
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
  /** Skill groups as the owner wrote them (category + items). Kept grouped end to end: flattening
   *  them here once made every Save collapse the categories into one. */
  skillSets: readonly ResumeSkillSet[];
  experience: readonly DraftExperience[];
  education: readonly DraftEducation[];
  social: readonly DraftSocial[];
  custom: readonly DraftCustom[];
  coverLetter: string;
  /** Which Typst layout the committed PDF uses ('' = default classic). Picked in the composer. */
  template: string;
  /** Owner-chosen accent colour (#RRGGBB); '' = the template's default vermillion. */
  accent: string;
  /** Owner-chosen font-size multiplier for the whole résumé (1 = the template default). */
  fontScale: number;
  /** Letter (default) or A4 — the PDF's page size and the editor's sheets. */
  paperSize: PaperSize;
}

// (The typst template's left rail — leftOrder / leftWidth, a draggable column divider — went with
// typst: the Puck résumé is one ATS-friendly column, and the knobs had stopped doing anything.)

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

// applyResumeContentToDraft —— merge a ResumeContent (e.g. the output of the Puck editor's
// fromPuckData) back into a DraftModel, preserving the base's non-résumé fields (id / company / role
// / template). The inverse of draftToResumeContent; the Puck editor is the producer.
export function applyResumeContentToDraft(base: DraftModel, rc: ResumeContent): DraftModel {
  return {
    ...base,
    name: rc.identity.name,
    summary: rc.summary,
    contact: {
      email: rc.identity.email, phone: rc.identity.phone ?? '',
      location: rc.identity.locationLine, site: rc.identity.site ?? '',
    },
    skillSets: rc.skills.map((s) => ({ category: s.category, items: [...s.items] })),
    experience: rc.works.map((w, i) => ({
      id: base.experience[i]?.id ?? `e-${i}`, org: w.company, role: w.title,
      start: w.period.start, end: w.period.end ?? '', loc: w.location, bullets: [...w.bullets],
    })),
    education: rc.educations.map((e, i) => ({
      id: base.education[i]?.id ?? `ed-${i}`, school: e.school, degree: e.degree,
      start: e.period.start, end: e.period.end ?? '',
    })),
    social: (rc.social ?? []).map((s, i) => ({ id: base.social[i]?.id ?? `s-${i}`, kind: s.kind, handle: s.handle })),
    custom: (rc.custom ?? []).map((c, i) => ({
      id: base.custom[i]?.id ?? `c-${i}`, label: c.label, value: c.value, kind: c.kind ?? '',
    })),
    coverLetter: rc.coverLetter ?? '',
    accent: rc.accent ?? '',
    fontScale: rc.fontScale ?? 1,
    paperSize: rc.paperSize ?? 'letter',
  };
}

// (On-canvas field editing — the ✎ pencils — was removed: editing is the left form panel, the canvas
// is preview + drag-reorder only. EDITABLE_FIELDS / readField / applyFieldEdit / isEditableField went
// with it.)

// draftToResumeContent —— adapter from the composer's edit-friendly
// DraftModel to the ResumeContent shape the Puck renderer consumes. Skill
// groups pass through as the owner wrote them.
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
      period: mkPeriod(e.start, e.end),
      bullets: [...e.bullets].filter((b) => b.trim() !== ''),
    })),
    educations: m.education.map((e) => ({
      school: e.school,
      degree: e.degree,
      period: mkPeriod(e.start, e.end),
    })),
    skills: m.skillSets.map((s) => ({ category: s.category, items: [...s.items] })),
    social: m.social
      .filter((s) => s.handle.trim() !== '')
      .map((s): ResumeSocial => ({ kind: s.kind, label: s.kind, handle: s.handle })),
    custom: m.custom
      .filter((c) => c.kind === 'divider' || (c.label.trim() !== '' && c.value.trim() !== ''))
      .map((c): ResumeCustom => ({ label: c.label, value: c.value, kind: c.kind })),
    accent: m.accent,
    fontScale: m.fontScale,
    paperSize: m.paperSize,
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
      period: mkPeriod(e.start, e.end), title: e.role, company: e.org,
      location: e.loc, bullets: [...e.bullets],
    })),
    educations: m.education.map((e) => ({
      period: mkPeriod(e.start, e.end), school: e.school, degree: e.degree,
    })),
    skills: m.skillSets.map((s) => ({ category: s.category, items: [...s.items] })),
    social: m.social.map((s) => ({ kind: s.kind, label: s.kind, handle: s.handle })),
    custom: m.custom.map((c) => ({ label: c.label, value: c.value, kind: c.kind })),
    accent: m.accent,
    font_scale: m.fontScale,
    paper_size: m.paperSize,
  };
}

export function draftToJobContext(m: DraftModel): JobContext {
  return { role: m.role, company: m.company };
}

// mkPeriod —— the composer's two date inputs → ResumePeriod. Empty end → null, which the template
// renders as "present". No parsing: start and end are separate fields now (a single "range" string
// could never express `end`, so an ended role always printed "present" — the composer's period was
// lossy where the résumé content and the Typst template both carry start+end).
function mkPeriod(start: string, end: string): { start: string; end: string | null } {
  const e = end.trim();
  return { start: start.trim(), end: e === '' || e.toLowerCase() === 'present' ? null : e };
}
